import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');

test('public site has no playable game or game promotion', () => {
  for (const file of ['site/play.html', 'site/play.js', 'site/play.css', 'site/game-rules.js', 'site/trail-rules.js', 'game-pack.mjs']) {
    assert.equal(fs.existsSync(new URL(file, root)), false, file);
  }
  for (const file of ['site/index.html', 'site/contexts.html', 'site/join.html', 'site/donate.html', 'site/memory.html', 'README.md']) {
    assert.doesNotMatch(read(file), /\/play\.html|\/game\/|Swarm of Truth|Play game|game-intro/i, file);
  }
});

test('MCP has no game tools or evidence-pack endpoint', () => {
  const server = read('server.mjs');
  assert.doesNotMatch(server, /start_swarm_game|finish_swarm_game|start_swarm_trail|finish_swarm_trail|game-pack|gamePackCache/);
  assert.match(server, /app\.get\("\/api\/swarm\/memory"/);
});
