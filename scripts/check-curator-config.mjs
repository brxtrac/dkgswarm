import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// OpenCode discovers Markdown agents from its global config directory. This check proves the
// policy file the scheduler hashes is the one OpenCode will select; it never calls a model.
export function configRoot(env = process.env) {
  const base = env.XDG_CONFIG_HOME || (env.HOME ? path.join(env.HOME, '.config') : '');
  if (!base) throw new Error('HOME or XDG_CONFIG_HOME is required');
  return path.join(path.resolve(base), 'opencode');
}

export function expectedAgentPath({ agentName = 'trac-marketing-curator', env = process.env } = {}) {
  return path.join(configRoot(env), 'agents', `${agentName}.md`);
}

function projectOverrides(cwd, agentName) {
  const found = [];
  let directory = path.resolve(cwd);
  for (;;) {
    for (const candidate of [
      path.join(directory, 'opencode.json'),
      path.join(directory, 'opencode.jsonc'),
      path.join(directory, '.opencode', 'opencode.json'),
      path.join(directory, '.opencode', 'opencode.jsonc'),
      path.join(directory, '.opencode', 'agents', `${agentName}.md`),
    ]) {
      if (fs.existsSync(candidate)) found.push(candidate);
    }
    if (directory === path.dirname(directory)) break;
    directory = path.dirname(directory);
  }
  return found;
}

export function checkLayout({
  policyPath,
  agentName = 'trac-marketing-curator',
  env = process.env,
  cwd = env.TRAC_DRAFTS_DIR || process.cwd(),
  systemRoot = '/etc/opencode',
} = {}) {
  const expected = expectedAgentPath({ agentName, env });
  const actual = path.resolve(policyPath || expected);
  if (actual !== expected) {
    throw new Error(`policy is not in OpenCode's discovered agents directory: ${actual} != ${expected}`);
  }
  if (!fs.existsSync(actual)) throw new Error(`agent policy does not exist: ${actual}`);
  const systemPolicy = path.join(systemRoot, 'agents', `${agentName}.md`);
  if (fs.existsSync(systemPolicy)) {
    throw new Error(`system agent overrides the configured policy: ${systemPolicy}`);
  }
  const overrides = projectOverrides(cwd, agentName);
  if (overrides.length) {
    throw new Error(`project config can override the selected agent: ${overrides.join(', ')}`);
  }
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(actual)).digest('hex');
  return { policyPath: actual, sha256 };
}

export function discoverAgent({
  agentName = 'trac-marketing-curator',
  env = process.env,
  cwd = env.TRAC_DRAFTS_DIR || process.cwd(),
  bin = 'opencode',
} = {}) {
  const result = spawnSync(bin, ['debug', 'agents', '--standalone'], {
    env, cwd, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`OpenCode agent discovery failed: ${result.stderr || result.status}`);
  let agents;
  try { agents = JSON.parse(result.stdout); } catch { throw new Error('OpenCode agent discovery returned invalid JSON'); }
  if (!Array.isArray(agents)) throw new Error('OpenCode agent discovery returned an invalid list');
  const agent = agents.find((item) => item?.id === agentName);
  if (!agent) throw new Error(`agent is not discovered by OpenCode: ${agentName}`);
  return agent;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const agentName = process.env.TRAC_CURATOR_AGENT || 'trac-marketing-curator';
  const layout = checkLayout({ agentName });
  discoverAgent({ agentName });
  console.log(JSON.stringify({ agent: agentName, policy: layout.policyPath, policySha256: layout.sha256, discovered: true }));
}
