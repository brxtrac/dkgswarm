import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
