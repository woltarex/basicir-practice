import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, makeScenario, buildQuestion, BANDS } from '../generator.js';
import { sdiff } from '../rules.js';

const ALL = { types: ['intercept', 'hold'], display: 'mixed', instruments: ['rmi', 'hsi', 'dicdi'] };

test('mulberry32 is deterministic', () => {
  const a = mulberry32(42), b = mulberry32(42);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
});

test('same seed → same question', () => {
  const q1 = buildQuestion(makeScenario(mulberry32(7), ALL, 'x'), mulberry32(8));
  const q2 = buildQuestion(makeScenario(mulberry32(7), ALL, 'x'), mulberry32(8));
  assert.deepEqual(q1, q2);
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
