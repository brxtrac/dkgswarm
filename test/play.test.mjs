import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('Signal Desk completes six decisions, keeps best locally, and treats graph data as text', async () => {
  const elements = new Map();
  function element() {
    return {
      textContent: '', hidden: false, children: [], style: {}, firstChild: { textContent: '' },
      classList: { add() {} }, focus() {},
      addEventListener(type, callback) { this[type] = callback; },
      append(...nodes) { this.children.push(...nodes); },
      replaceChildren(...nodes) { this.children = nodes; },
      click() { this.click?.(); },
    };
  }
  const ids = ['start-screen', 'question-screen', 'result-screen', 'start', 'replay', 'next', 'score',
    'decision-count', 'round-indicator', 'progress-fill', 'best', 'signal-type', 'scenario', 'context',
    'options', 'feedback', 'result-title', 'result-detail', 'final-score', 'personal-best',
    'live-status', 'live-title', 'live-entry'];
  for (const id of ids) elements.set(id, element());
  const storage = new Map();
  const context = vm.createContext({
    document: { getElementById: (id) => elements.get(id), createElement: element },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    fetch: async () => ({ ok: true, json: async () => ({ entries: [{ title: '<img src=x onerror=alert(1)>' }] }) }),
    AbortSignal,
  });
  vm.runInContext(fs.readFileSync(new URL('../site/play.js', import.meta.url), 'utf8'), context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.get('live-title').textContent, '<img src=x onerror=alert(1)>');
  assert.deepEqual(elements.get('live-title').children, []);
  elements.get('start').click();
  for (let round = 0; round < 6; round++) {
    assert.equal(elements.get('options').children.length, 3);
    elements.get('options').children[round === 0 ? 0 : [0, 2, 1, 2, 0][round - 1]].click();
    assert.equal(elements.get('feedback').hidden, false);
    elements.get('next').click();
  }
  assert.equal(elements.get('result-screen').hidden, false);
  assert.equal(elements.get('final-score').textContent, '500');
  assert.equal(storage.get('dkgswarm-signal-desk-best-v1'), '500');
  elements.get('replay').click();
  assert.equal(elements.get('score').textContent, '000');
  assert.equal(elements.get('best').textContent, '500');
});
