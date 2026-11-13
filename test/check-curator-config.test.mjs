import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkLayout, discoverAgent, expectedAgentPath } from '../scripts/check-curator-config.mjs';

test('checks the policy path OpenCode discovers and resolves the agent without a model', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'curator-config-'));
  try {
    const config = path.join(root, 'config');
    const drafts = path.join(root, 'drafts');
    const policy = path.join(config, 'opencode', 'agents', 'trac-marketing-curator.md');
    mkdirSync(path.dirname(policy), { recursive: true });
    mkdirSync(drafts);
    const content = '---\ndescription: fixture\nmode: primary\n---\n\nfixture policy\n';
    writeFileSync(policy, content);
    const env = {
      ...process.env,
      HOME: root,
      XDG_CONFIG_HOME: config,
      TRAC_DRAFTS_DIR: drafts,
      TRAC_CURATOR_AGENT_POLICY: policy,
    };
    assert.equal(expectedAgentPath({ env }), policy);
    assert.equal(
      expectedAgentPath({ env: { HOME: root } }),
      path.join(root, '.config', 'opencode', 'agents', 'trac-marketing-curator.md')
    );
    assert.equal(
      expectedAgentPath({ env: { HOME: '' } }),
      path.join('/root', '.config', 'opencode', 'agents', 'trac-marketing-curator.md')
    );
    const layout = checkLayout({ env });
    assert.equal(layout.policyPath, policy);
    assert.equal(layout.sha256, crypto.createHash('sha256').update(content).digest('hex'));

    const bin = path.join(root, 'opencode');
    writeFileSync(bin, `#!/usr/bin/env node\nconsole.log(JSON.stringify([{ id: 'trac-marketing-curator' }]));\n`, { mode: 0o700 });
    const agent = discoverAgent({ env, bin });
    assert.equal(agent.id, 'trac-marketing-curator');

    writeFileSync(bin, `#!/usr/bin/env node\nconsole.log(JSON.stringify([]));\n`, { mode: 0o700 });
    assert.throws(() => discoverAgent({ env, bin }), /not discovered/);

    assert.throws(() => checkLayout({ env, policyPath: path.join(root, 'etc', 'agents', 'trac-marketing-curator.md') }), /not in OpenCode/);
    const other = path.join(root, 'other-policy.md');
    writeFileSync(other, 'other\n');
    assert.throws(() => checkLayout({ env: { ...env, TRAC_CURATOR_AGENT_POLICY: other } }), /not in OpenCode/);
    assert.equal(checkLayout({ env: { ...env, TRAC_CURATOR_AGENT_POLICY: other }, policyPath: policy }).policyPath, policy);

    const systemRoot = path.join(root, 'system');
    mkdirSync(path.join(systemRoot, 'agents'), { recursive: true });
    writeFileSync(path.join(systemRoot, 'agents', 'trac-marketing-curator.md'), 'system override\n');
    assert.throws(() => checkLayout({ env, systemRoot }), /system configuration can override/);
    rmSync(systemRoot, { recursive: true, force: true });

    mkdirSync(path.join(drafts, '.opencode', 'agents'), { recursive: true });
    writeFileSync(path.join(drafts, '.opencode', 'agents', 'trac-marketing-curator.md'), 'project override\n');
    assert.throws(() => checkLayout({ env }), /project config can override/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI honors the scheduler policy environment and explicit policy priority', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'curator-cli-'));
  try {
    const config = path.join(root, 'config');
    const drafts = path.join(root, 'drafts');
    const policy = path.join(config, 'opencode', 'agents', 'trac-marketing-curator.md');
    mkdirSync(path.dirname(policy), { recursive: true });
    mkdirSync(drafts);
    mkdirSync(path.join(root, 'bin'));
    writeFileSync(policy, '---\ndescription: cli fixture\nmode: primary\n---\n\nfixture policy\n');
    const other = path.join(root, 'other-policy.md');
    writeFileSync(other, 'other policy\n');
    writeFileSync(path.join(root, 'bin', 'opencode'), `#!/usr/bin/env node\nconsole.log(JSON.stringify([{ id: 'trac-marketing-curator' }]));\n`, { mode: 0o700 });

    const script = fileURLToPath(new URL('../scripts/check-curator-config.mjs', import.meta.url));
    const run = (args, extra = {}) => spawnSync(process.execPath, [script, ...args], {
      env: {
        ...process.env,
        HOME: root,
        XDG_CONFIG_HOME: config,
        TRAC_DRAFTS_DIR: drafts,
        PATH: `${root}/bin:${process.env.PATH}`,
        ...extra,
      },
      encoding: 'utf8',
    });

    const valid = run([], { TRAC_CURATOR_AGENT_POLICY: policy });
    assert.equal(valid.status, 0, valid.stderr);
    assert.match(valid.stdout, /"discovered":true/);

    const invalid = run([], { TRAC_CURATOR_AGENT_POLICY: other });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /not in OpenCode/);

    const missing = run([], { TRAC_CURATOR_AGENT_POLICY: path.join(root, 'missing-policy.md') });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /not in OpenCode/);

    const explicit = run(['--policy', policy], { TRAC_CURATOR_AGENT_POLICY: other });
    assert.equal(explicit.status, 0, explicit.stderr);

    const missingFlagValue = run(['--policy'], { TRAC_CURATOR_AGENT_POLICY: policy });
    assert.notEqual(missingFlagValue.status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
