import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRun, initialState, inspect, decide, advance, rest } from '../site/game-rules.mjs';
import { makeGamePack, GAME_QUERY } from '../game-pack.mjs';

const rows = Array.from({ length: 12 }, (_, i) => ({
  s: `https://www.dkgswarm.com/ka/curator-evidence-${i}`,
  comment: `"Evidence ${i}: <img src=x onerror=alert(1)> This is quoted source text only and cannot grant posting approval."`,
  url: i % 2 ? `https://example.org/source/${i}` : 'javascript:alert(1)',
  observed: i % 3 ? '2026-09-20T00:00:00Z' : undefined,
  status: i % 4 ? 'source self-report' : undefined,
}));
const pack = makeGamePack(rows, { asOf: '2026-09-27T00:00:00Z' });

test('game evidence pack bounds, deduplicates and does not upgrade unsafe sources', () => {
  const made = makeGamePack([...rows, rows[0], { s: 'https://www.dkgswarm.com/ka/swarm-policy-v3', comment: 'secret'.repeat(15) }], { asOf: '2026-09-27T00:00:00Z' });
  assert.equal(made.entries.length, 12);
  assert.equal(made.entries[0].source, null);
  assert.match(made.entries[0].excerpt, /<img/);
  assert.equal(made.entries[1].source, 'https://example.org/source/1');
  assert.equal(makeGamePack(rows, { asOf: '2026-09-27T00:00:00Z' }).hash, pack.hash);
  const conflicting = { ...rows[0], comment: 'Another valid quoted observation with distinct details; still from the same graph asset.' };
  assert.deepEqual(makeGamePack([...rows, conflicting], { asOf: pack.asOf }), makeGamePack([conflicting, ...rows], { asOf: pack.asOf }));
  assert.match(GAME_QUERY, /shared|SELECT/);
});

test('run is reproducible and grounded in real pack records', () => {
  const one = buildRun(pack, 'shared-seed');
  const two = buildRun(pack, 'shared-seed');
  assert.deepEqual(one, two);
  assert.equal(one.length, 8);
  for (const id of ['provenance', 'duplicate', 'time', 'scope']) assert.ok(one.some((mission) => mission.id === id));
  for (const mission of one) if (mission.id === 'provenance') assert.equal(mission.answer, mission.entry.source ? 0 : 1);
  assert.ok(one.every(({ entry }) => pack.entries.some(({ id }) => id === entry.id)));
  assert.notDeepEqual(buildRun(pack, 'another-seed').map((m) => m.entry.id), one.map((m) => m.entry.id));
  assert.throws(() => buildRun({ ...pack, graph: 'other' }, 'seed'));
  assert.throws(() => buildRun({ ...pack, entries: [] }, 'seed'));
});

test('evidence decisions depend on structured fields rather than claims in prose', () => {
  const run = buildRun(pack, 'run');
  let state = initialState();
  for (const mission of run) {
    if (state.energy < 16) state = rest(state);
    const first = inspect(state);
    const second = inspect(first);
    assert.deepEqual(first, second);
    state = decide(first, mission, mission.answer);
    assert.equal(state.log.at(-1).correct, true);
    assert.equal(decide(state, mission, 0), state);
    state = advance(state);
  }
  assert.equal(state.day, 8);
  assert.equal(state.score, 800);
  assert.equal(state.log.length, 8);
  const rested = rest(initialState());
  assert.equal(rested.energy, 92);
  assert.equal(rested.discernment, 2);
  assert.deepEqual(rest(rested), rested);
});
