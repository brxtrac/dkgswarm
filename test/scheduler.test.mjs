import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scheduler/scheduled-curator.mjs', import.meta.url));

test('scheduler runs bounded inventory, refuses changed policy, and never repeats a model session', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'marketing-worker-'));
  try {
    mkdirSync(`${root}/bin`);
    copyFileSync(script, `${root}/worker.mjs`);
    writeFileSync(`${root}/curator-stub.mjs`, `import { readFileSync } from 'node:fs';
console.log(readFileSync('${root}/inventory.json', 'utf8'));
`);
    mkdirSync(`${root}/config/opencode/agents`, { recursive: true });
    writeFileSync(`${root}/config/opencode/agents/trac-marketing-curator.md`, 'synthetic curator policy\n');
    writeFileSync(`${root}/bin/opencode`, `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync('${root}/calls', process.argv[2] + '\\n');
if (process.argv[2] === 'api' && process.argv[4] === '/api/session') {
  const body = JSON.parse(process.argv.at(-1));
  console.log(JSON.stringify({ data: { id: 'ses_synthetic', metadata: body.metadata, location: body.location } }));
} else if (process.argv[2] === 'api') {
  console.log(JSON.stringify({ data: {} }));
} else {
  console.log(JSON.stringify({ type: 'text', part: { text: 'synthetic complete' } }));
}
`, { mode: 0o700 });

    const env = {
      ...process.env,
      PATH: `${root}/bin:${process.env.PATH}`,
      TRAC_DRAFTS_DIR: root,
      TRAC_CURATOR_SCRIPT: `${root}/curator-stub.mjs`,
      XDG_CONFIG_HOME: `${root}/config`,
    };
    const run = (extra = {}) => spawnSync(process.execPath, [`${root}/worker.mjs`], { env: { ...env, ...extra }, encoding: 'utf8' });
    const calls = () => existsSync(`${root}/calls`) ? readFileSync(`${root}/calls`, 'utf8') : '';
    const inventory = (candidates, extra = {}) => writeFileSync(`${root}/inventory.json`, JSON.stringify({ graph: 'trac-marketing', candidates, communityDrafts: [], ...extra }));

    inventory([]);
    assert.equal(run().status, 0);
    assert.equal(calls(), '');

    inventory([{ id: 'synthetic' }]);
    const first = run();
    assert.equal(first.status, 0, `${first.stderr}\n${first.stdout}`);
    assert.equal(run().status, 0);
    assert.equal(calls(), 'api\nrun\napi\napi\n');
    const state = JSON.parse(readFileSync(`${root}/data/curator-state.json`));
    assert.equal(state.status, 'complete');

    writeFileSync(`${root}/data/curator-state.json`, JSON.stringify({ ...state, status: 'running' }));
    assert.equal(run().status, 0);
    assert.equal(calls(), 'api\nrun\napi\napi\n');

    writeFileSync(`${root}/data/curator-state.json`, JSON.stringify({ ...state, policyHash: 'changed' }));
    assert.equal(run().status, 1);
    assert.equal(calls(), 'api\nrun\napi\napi\n');

    writeFileSync(`${root}/data/curator-state.json`, JSON.stringify({ ...state, status: 'failed', failures: 1, nextAttemptAt: Date.now() + 600000 }));
    assert.equal(run().status, 0);
    assert.equal(run().status, 0);

    writeFileSync(`${root}/data/curator-state.json`, JSON.stringify({ ...state, status: 'failed', failures: 3, nextAttemptAt: 0, quarantined: true }));
    assert.equal(run().status, 0);
    assert.equal(calls(), 'api\nrun\napi\napi\n');

    inventory([{ id: 'synthetic' }], { graph: 'other-graph' });
    assert.equal(run().status, 1);
    assert.equal(calls(), 'api\nrun\napi\napi\n');

    writeFileSync(`${root}/inventory.json`, 'not-json');
    assert.equal(run().status, 1);
    assert.equal(calls(), 'api\nrun\napi\napi\n');

    inventory([{ id: 'synthetic' }]);
    assert.equal(run({ TRAC_CURATOR_AGENT_POLICY: `${root}/missing-policy.md` }).status, 1);
    assert.equal(calls(), 'api\nrun\napi\napi\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
