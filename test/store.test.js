import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, save, record, defaults, recordSession, clearMistakes, resetStats } from '../store.js';

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

test('v1 data migrates to v2 keeping settings, stats and mistakes', () => {
  const st = memory();
  st.setItem('basicir.v1', JSON.stringify({
    version: 1,
    settings: { types: ['hold'], display: 'mixed', instruments: ['rmi', 'hsi'], timer: 90, length: 10 },
    stats: { '45': { correct: 1, total: 2, ms: 3000 } },
    mistakes: [{ kind: 'hold', id: 'a' }],
  }));
  const d = load(st);
  assert.equal(d.version, 2);
  assert.deepEqual(d.settings.types, ['hold']);
  assert.equal(d.settings.display, 'mixed');
  assert.equal(d.settings.timer, 90);
  assert.equal(d.settings.theme, 'system');
  assert.equal(d.settings.answerMode, 'mc');
  assert.equal(d.settings.cdiMode, 'centered');
  assert.equal(d.settings.adaptive, false);
  assert.deepEqual(d.settings.filters, defaults().settings.filters);
  assert.deepEqual(d.stats, { '45': { correct: 1, total: 2, ms: 3000 } });
  assert.deepEqual(d.mistakes, [{ kind: 'hold', id: 'a' }]);
  assert.deepEqual(d.history, []);
  save(d, st);
  assert.equal(JSON.parse(st.getItem('basicir.v2')).version, 2);
});

test('v2 wins over v1; corrupt v2 falls back to v1', () => {
  const st = memory();
  st.setItem('basicir.v1', JSON.stringify({ version: 1, settings: { timer: 90 } }));
  st.setItem('basicir.v2', JSON.stringify({ version: 2, settings: { timer: 20 } }));
  assert.equal(load(st).settings.timer, 20);
  st.setItem('basicir.v2', '{not json');
  assert.equal(load(st).settings.timer, 90);
});

test('invalid v2 fields fall back one by one without wiping stats', () => {
  const st = memory();
  st.setItem('basicir.v2', JSON.stringify({
    version: 2,
    settings: {
      theme: 'neon', answerMode: 'x', cdiMode: 5, adaptive: 'yes',
      filters: { bands: ['45', 'bogus'], dirs: null, boundaryFocus: 1 },
    },
    stats: { '45': { correct: 1, total: 1, ms: 10 } },
    history: [{ at: 1, right: 1, total: 2, avgMs: 500, review: false }, null, { at: 'x' }],
  }));
  const d = load(st);
  const def = defaults().settings;
  assert.equal(d.settings.theme, 'system');
  assert.equal(d.settings.answerMode, 'mc');
  assert.equal(d.settings.cdiMode, 'centered');
  assert.equal(d.settings.adaptive, false);
  assert.deepEqual(d.settings.filters.bands, ['45']);
  assert.deepEqual(d.settings.filters.dirs, def.filters.dirs);
  assert.equal(d.settings.filters.boundaryFocus, false);
  assert.deepEqual(d.stats, { '45': { correct: 1, total: 1, ms: 10 } });
  assert.equal(d.history.length, 1);
});

test('recordSession keeps the last 30 sessions', () => {
  const d = defaults();
  for (let i = 0; i < 35; i++) recordSession(d, { at: i, right: 1, total: 1, avgMs: 1, review: false });
  assert.equal(d.history.length, 30);
  assert.equal(d.history[0].at, 5);
  assert.equal(d.history.at(-1).at, 34);
});

test('clearMistakes and resetStats', () => {
  const d = defaults();
  d.mistakes.push({ kind: 'hold', id: 'a' });
  d.stats['45'] = { correct: 1, total: 1, ms: 1 };
  d.history.push({ at: 1, right: 1, total: 1, avgMs: 1 });
  d.settings.timer = 90;
  clearMistakes(d);
  assert.deepEqual(d.mistakes, []);
  assert.equal(d.stats['45'].total, 1);
  resetStats(d);
  assert.deepEqual(d.stats, {});
  assert.deepEqual(d.history, []);
  assert.equal(d.settings.timer, 90);
});

test('malformed stats entries are dropped', () => {
  const st = memory();
  st.setItem('basicir.v2', JSON.stringify({
    version: 2,
    stats: { '45': 5, '90/45': { correct: 'x', total: 1, ms: 1 }, holding: { correct: 1, total: 2, ms: 3 } },
  }));
  assert.deepEqual(load(st).stats, { holding: { correct: 1, total: 2, ms: 3 } });
});
