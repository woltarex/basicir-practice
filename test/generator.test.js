import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, makeScenario, buildQuestion, BANDS, emphasisParts, setupError, statWeight, pickWeighted, eligibleKeys, summarize } from '../generator.js';
import { sdiff, interceptBand, holding } from '../rules.js';
import { defaults } from '../store.js';

const ALL = { types: ['intercept', 'hold'], display: 'mixed', instruments: ['rmi', 'hsi', 'dicdi'] };

test('mulberry32 is deterministic', () => {
  const a = mulberry32(42), b = mulberry32(42);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
});

test('same seed → same question', () => {
  const q1 = buildQuestion(makeScenario(mulberry32(7), ALL, 'x'), mulberry32(8));
  const q2 = buildQuestion(makeScenario(mulberry32(7), ALL, 'x'), mulberry32(8));
  assert.deepEqual(q1, q2);
  const s = makeScenario(mulberry32(7), ALL, 'x');
  assert.deepEqual(buildQuestion(JSON.parse(JSON.stringify(s)), mulberry32(8)), buildQuestion(s, mulberry32(8)));
});

test('10,000 questions: one correct answer, 4–5 distinct options, labelled distractors', () => {
  const rng = mulberry32(1);
  for (let i = 0; i < 10000; i++) {
    const q = buildQuestion(makeScenario(rng, ALL, String(i)), rng);
    const texts = q.options.map((o) => o.text);
    assert.equal(new Set(texts).size, texts.length, `duplicate options: ${texts}`);
    assert.ok(q.options.length >= 4 && q.options.length <= 5, `option count ${q.options.length}`);
    assert.equal(q.options.filter((o) => o.mistake === null).length, 1);
    assert.equal(q.options[q.correctIndex].mistake, null);
    for (const o of q.options) if (o.mistake !== null) assert.ok(o.mistake.length > 0);
    assert.ok(q.steps.length >= 3);
  }
});

test('interception Δ never within 2° of a threshold, and inbound never beyond 70°', () => {
  const rng = mulberry32(2);
  for (let i = 0; i < 10000; i++) {
    const s = makeScenario(rng, { ...ALL, types: ['intercept'] }, String(i));
    const a = Math.abs(sdiff(s.radial, s.pos));
    for (const t of [15, 30, 70]) assert.ok(Math.abs(a - t) > 1, `Δ=${a}`);
    if (s.dir === 'inbound') assert.ok(a <= 68);
    assert.ok(a >= BANDS.correction[0]);
  }
});

test('about 20% of holding questions are "either" questions', () => {
  const rng = mulberry32(3);
  let either = 0;
  const n = 5000;
  for (let i = 0; i < n; i++) {
    const q = buildQuestion(makeScenario(rng, { ...ALL, types: ['hold'] }, String(i)), rng);
    if (q.options[q.correctIndex].text.startsWith('Either')) either++;
  }
  // 20% targeted + ~6% of uniform draws landing in a zone
  assert.ok(either / n > 0.18 && either / n < 0.35, `either share ${either / n}`);
});

test('numbers mode never shows instrument readings', () => {
  const rng = mulberry32(4);
  for (let i = 0; i < 200; i++) {
    const q = buildQuestion(makeScenario(rng, { ...ALL, display: 'numbers' }, String(i)), rng);
    assert.equal(q.scenario.display, 'numbers');
    assert.ok(!q.steps[0].startsWith('RMI') && !q.steps[0].startsWith('HSI'));
  }
});

test('either-zone: single entries from the pair are labelled with the ±5° rule', () => {
  const s = { id: 'z', kind: 'hold', display: 'numbers', flag: 'TO', inbound: 0, turn: 'std', trk: 112, nav: 'VOR', hdg: 112 };
  let seen = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const q = buildQuestion(s, mulberry32(seed));
    assert.equal(q.options[q.correctIndex].text, 'Either Special direct or Teardrop');
    for (const o of q.options) {
      if (o.text.startsWith('Teardrop') || o.text.startsWith('Special direct')) {
        seen++;
        assert.match(o.mistake, /±5°/);
      }
    }
  }
  assert.ok(seen > 0, 'no Teardrop/Special direct single option appeared');
});

test('holding instruments show heading = track to fix; HSI/DI+CDI never show an NDB', () => {
  const rng = mulberry32(7);
  const set = { types: ['hold'], display: 'instruments', instruments: ['rmi', 'hsi', 'dicdi'] };
  for (let i = 0; i < 2000; i++) {
    const s = makeScenario(rng, set, `h${i}`);
    assert.equal(s.hdg, s.trk);
    if (s.display === 'hsi' || s.display === 'dicdi') assert.equal(s.nav, 'VOR');
  }
});

test('emphasisParts bolds the leading phrase and every 3-digit track, and keeps the text', () => {
  const t = '90°/45°, initial track 260°, interception track 215°';
  const p = emphasisParts(t);
  assert.equal(p.map((x) => x.text).join(''), t);
  assert.deepEqual(p.filter((x) => x.bold).map((x) => x.text), ['90°/45°', '260°', '215°']);
  assert.deepEqual(emphasisParts('Either Teardrop or Parallel'), [{ text: 'Either Teardrop or Parallel', bold: true }]);
  const o = emphasisParts('Track to station (270°), then over-station interception track 170°');
  assert.deepEqual(o.filter((x) => x.bold).map((x) => x.text), ['Track to station ', '270°', '170°']);
  // Every generated option survives the split unchanged.
  const rng = mulberry32(9);
  for (let i = 0; i < 2000; i++) {
    for (const opt of buildQuestion(makeScenario(rng, ALL, String(i)), rng).options) {
      assert.equal(emphasisParts(opt.text).map((x) => x.text).join(''), opt.text);
    }
  }
});

const F = defaults().settings.filters;
const subsets = (xs) => Array.from({ length: 2 ** xs.length - 1 }, (_, m) => xs.filter((_, i) => ((m + 1) >> i) & 1));

test('omitted filters behave exactly like the defaults (v1 seeds unchanged)', () => {
  for (let i = 0; i < 300; i++) {
    assert.deepEqual(makeScenario(mulberry32(i), ALL, 'x'), makeScenario(mulberry32(i), { ...ALL, filters: F }, 'x'));
  }
});

test('interception filters: every valid combination yields only matching scenarios', () => {
  const rng = mulberry32(31);
  let combos = 0;
  for (const bands of subsets(F.bands)) for (const dirs of subsets(F.dirs)) for (const phrasings of subsets(F.phrasings)) {
    const settings = { ...ALL, types: ['intercept'], filters: { ...F, bands, dirs, phrasings } };
    if (setupError(settings)) continue;
    combos++;
    for (let i = 0; i < 300; i++) {
      const s = makeScenario(rng, settings, String(i));
      assert.ok(bands.includes(interceptBand(Math.abs(sdiff(s.radial, s.pos)))), `${bands} got Δ ${sdiff(s.radial, s.pos)}`);
      assert.ok(dirs.includes(s.dir));
      assert.ok(phrasings.includes(s.phrasing));
    }
  }
  assert.equal(combos, 15 * 3 * 3 - 3); // only inbound-only + over-station-only is impossible (× 3 phrasings)
});

test('holding filters: turns and navaids respected; NDB holds stay on the RMI or numbers', () => {
  const rng = mulberry32(32);
  for (const turns of subsets(F.turns)) for (const navs of subsets(F.navs)) for (const boundaryFocus of [false, true]) {
    const settings = { types: ['hold'], display: 'mixed', instruments: ['rmi', 'hsi', 'dicdi'], filters: { ...F, turns, navs, boundaryFocus } };
    assert.equal(setupError(settings), '');
    for (let i = 0; i < 2000; i++) {
      const s = makeScenario(rng, settings, String(i));
      assert.ok(turns.includes(s.turn));
      assert.ok(navs.includes(s.nav), `${navs} got ${s.nav}`);
      if (s.nav === 'NDB') assert.ok(s.display === 'rmi' || s.display === 'numbers', s.display);
      assert.equal(s.hdg, s.trk);
    }
  }
});

test('boundaryFocus puts about 80% of holds in a ±5° either zone', () => {
  const rng = mulberry32(33);
  const settings = { types: ['hold'], display: 'numbers', instruments: [], filters: { ...F, boundaryFocus: true } };
  let either = 0;
  const n = 4000;
  for (let i = 0; i < n; i++) if (holding(makeScenario(rng, settings, String(i))).either) either++;
  assert.ok(either / n > 0.76 && either / n < 0.88, `either share ${either / n}`);
});

test('setupError covers empty and impossible filter choices', () => {
  assert.equal(setupError(ALL), '');
  assert.equal(setupError({ ...ALL, filters: { ...F, dirs: ['inbound'], bands: ['overstation'] } }), 'Inbound interception has no over-station band.');
  assert.match(setupError({ ...ALL, filters: { ...F, bands: [] } }), /band/);
  assert.match(setupError({ ...ALL, filters: { ...F, dirs: [] } }), /inbound/i);
  assert.match(setupError({ ...ALL, filters: { ...F, phrasings: [] } }), /phrasing/);
  assert.equal(setupError({ ...ALL, types: ['hold'], filters: { ...F, bands: [] } }), ''); // interception off → its filters ignored
  assert.match(setupError({ ...ALL, types: ['hold'], filters: { ...F, turns: [] } }), /STD/);
  assert.match(setupError({ ...ALL, types: ['hold'], filters: { ...F, navs: [] } }), /VOR/);
  assert.equal(
    setupError({ types: ['hold'], display: 'instruments', instruments: ['hsi', 'dicdi'], filters: { ...F, navs: ['NDB'] } }),
    'NDB holdings require RMI or Numbers display.');
  assert.equal(setupError({ types: ['hold'], display: 'instruments', instruments: ['rmi', 'hsi'], filters: { ...F, navs: ['NDB'] } }), '');
  assert.equal(setupError({ ...ALL, types: [] }), 'Pick at least one exercise.');
});

test('statWeight: unseen 3, mastered near the 0.5 floor, errors and slowness raise it', () => {
  assert.equal(statWeight(undefined), 3);
  assert.equal(statWeight({ correct: 0, total: 0, ms: 0 }), 3);
  const mastered = statWeight({ correct: 10, total: 10, ms: 30000 }); // 3 s each
  assert.ok(Math.abs(mastered - 0.6) < 1e-9);
  assert.ok(statWeight({ correct: 0, total: 10, ms: 30000 }) > statWeight({ correct: 5, total: 10, ms: 30000 }));
  assert.ok(statWeight({ correct: 10, total: 10, ms: 600000 }) > mastered);
  assert.ok(statWeight({ correct: 10, total: 10, ms: 0 }) >= 0.5);
});

test('pickWeighted favours weak keys but every key still appears', () => {
  const rng = mulberry32(41);
  const keys = ['correction', '45', 'holding'];
  const stats = { correction: { correct: 0, total: 10, ms: 100000 }, '45': { correct: 10, total: 10, ms: 30000 }, holding: { correct: 10, total: 10, ms: 30000 } };
  const n = {};
  for (let i = 0; i < 10000; i++) { const k = pickWeighted(rng, keys, stats); n[k] = (n[k] ?? 0) + 1; }
  assert.ok(n.correction > n['45'] * 3);
  assert.ok(n['45'] > 0 && n.holding > 0);
});

test('eligibleKeys follow types and filters', () => {
  assert.deepEqual(eligibleKeys(ALL), ['correction', '45', '90/45', 'overstation', 'holding']);
  assert.deepEqual(eligibleKeys({ ...ALL, types: ['hold'] }), ['holding']);
  assert.deepEqual(eligibleKeys({ ...ALL, types: ['intercept'], filters: { ...F, bands: ['45', 'overstation'], dirs: ['inbound'] } }), ['45']);
});

test('adaptive makeScenario drills the weakest key and respects filters', () => {
  const rng = mulberry32(42);
  const good = { correct: 10, total: 10, ms: 100000 };
  const stats = { correction: good, '45': good, '90/45': good, holding: good, overstation: { correct: 0, total: 10, ms: 100000 } };
  const settings = { ...ALL, adaptive: true };
  let over = 0;
  for (let i = 0; i < 3000; i++) {
    const s = makeScenario(rng, settings, String(i), stats);
    if (s.kind === 'intercept' && interceptBand(Math.abs(sdiff(s.radial, s.pos))) === 'overstation') {
      over++;
      assert.equal(s.dir, 'outbound');
    }
  }
  assert.ok(over / 3000 > 0.45, `over-station share ${over / 3000}`);
  const only45 = { ...settings, filters: { ...F, bands: ['45'] } };
  for (let i = 0; i < 500; i++) {
    const s = makeScenario(rng, only45, String(i), stats);
    if (s.kind === 'intercept') assert.equal(interceptBand(Math.abs(sdiff(s.radial, s.pos))), '45');
  }
});

test('summarize totals all stats and names the weakest seen key', () => {
  assert.deepEqual(summarize({}), { correct: 0, total: 0, ms: 0, weakest: null });
  const s = summarize({
    '45': { correct: 9, total: 10, ms: 50000 },
    holding: { correct: 2, total: 10, ms: 50000 },
    correction: { correct: 0, total: 0, ms: 0 },
  });
  assert.deepEqual(s, { correct: 11, total: 20, ms: 100000, weakest: 'holding' });
});
