import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, save, record, defaults } from '../store.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
};
const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

test('round trip', () => {
  const st = memory();
  const d = load(st);
  d.settings.timer = 90;
  save(d, st);
  assert.equal(load(st).settings.timer, 90);
});

test('blocked storage → defaults, save does not throw', () => {
  assert.deepEqual(load(broken), defaults());
  assert.doesNotThrow(() => save(defaults(), broken));
});

test('corrupt or unknown version → defaults', () => {
  const st = memory();
  st.setItem('basicir.v1', '{not json');
  assert.deepEqual(load(st), defaults());
  st.setItem('basicir.v1', JSON.stringify({ version: 99 }));
  assert.deepEqual(load(st), defaults());
});

test('record: stats, mistakes added on wrong, removed on right', () => {
  const d = defaults();
  const s = { id: 'a' };
  record(d, { statKey: '45', correct: false, ms: 1000, scenario: s });
  record(d, { statKey: '45', correct: false, ms: 1000, scenario: s });
  assert.equal(d.mistakes.length, 1);
  assert.deepEqual(d.stats['45'], { correct: 0, total: 2, ms: 2000 });
  record(d, { statKey: '45', correct: true, ms: 500, scenario: s });
  assert.equal(d.mistakes.length, 0);
  assert.equal(d.stats['45'].correct, 1);
});

test('null stats/mistakes in saved data → usable defaults', () => {
  const st = memory();
  st.setItem('basicir.v1', '{"version":1,"stats":null,"mistakes":null}');
  const d = load(st);
  assert.deepEqual(d.stats, {});
  assert.deepEqual(d.mistakes, []);
  assert.doesNotThrow(() => record(d, { statKey: '45', correct: false, ms: 1, scenario: { id: 'a' } }));
});

test('malformed stored settings fall back to defaults', () => {
  const st = memory();
  st.setItem('basicir.v1', JSON.stringify({ version: 1, settings: { instruments: null, display: 'bogus', types: ['hold', 'x'], timer: 9999, length: 7 } }));
  const s = load(st).settings;
  assert.deepEqual(s.instruments, defaults().settings.instruments);
  assert.equal(s.display, 'numbers');
  assert.deepEqual(s.types, ['hold']);
  assert.equal(s.timer, 45);
  assert.equal(s.length, 20);
});

test('malformed mistakes entries are dropped', () => {
  const st = memory();
  st.setItem('basicir.v1', JSON.stringify({ version: 1, mistakes: [null, 5, { kind: 'hold', id: 'a' }] }));
  assert.deepEqual(load(st).mistakes, [{ kind: 'hold', id: 'a' }]);
});
