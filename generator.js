// Scenarios, questions and distractors. Pure: all randomness comes from `rng`.
import {
  norm, sdiff, fmt, interception, interceptText, holding, holdText,
  ENTRIES, EITHER_PAIRS, entryInitial,
} from './rules.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1)); // inclusive
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
function shuffle(rng, arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// |Δ| ranges per band, keeping 2° away from 15/30/70 and away from 0/180.
export const BANDS = {
  correction: [2, 12],
  '45': [17, 28],
  '90/45': [32, 68],
  overstation: [72, 175],
};

// settings: { types: ['intercept','hold'], display: 'numbers'|'instruments'|'mixed', instruments: ['rmi','hsi','dicdi'] }
export function makeScenario(rng, settings, id) {
  const kind = pick(rng, settings.types);
  const display = pickDisplay(rng, settings);
  const flag = pick(rng, ['TO', 'FROM']);
  if (kind === 'intercept') {
    const dir = pick(rng, ['inbound', 'outbound']);
    const band = pick(rng, dir === 'inbound' ? ['correction', '45', '90/45'] : Object.keys(BANDS));
    const [lo, hi] = BANDS[band];
    const radial = int(rng, 0, 359);
    const pos = norm(radial + (rng() < 0.5 ? -1 : 1) * int(rng, lo, hi));
    return {
      id, kind, display, flag, radial, dir, pos,
      phrasing: pick(rng, ['radial', 'q']),
      dist: int(rng, 30, 120) / 10,
      hdg: int(rng, 0, 359),
      gs: pick(rng, [90, 100, 110, 120, 140]),
    };
  }
  const inbound = int(rng, 0, 359);
  const turn = pick(rng, ['std', 'nonstd']);
  // ~20% land in a ±5° either zone.
  const d = rng() < 0.2 ? pick(rng, [110, 180, 290]) + int(rng, -5, 5) : int(rng, 0, 359);
  const trk = turn === 'std' ? norm(inbound + d) : norm(inbound - d);
  return {
    id, kind, display, flag, inbound, turn, trk,
    nav: pick(rng, ['NDB', 'VOR']),
    hdg: norm(trk + int(rng, -40, 40)),
  };
}

function pickDisplay(rng, { display, instruments }) {
  if (display === 'numbers' || instruments.length === 0) return 'numbers';
  if (display === 'instruments') return pick(rng, instruments);
  return pick(rng, ['numbers', ...instruments]);
}

export function solve(s) {
  return s.kind === 'intercept'
    ? interception({ radial: s.radial, dir: s.dir, pos: s.pos })
    : holding({ inbound: s.inbound, turn: s.turn, trk: s.trk });
}

// ---------- question text ----------

export function promptText(s) {
  if (s.kind === 'intercept') {
    const target = s.phrasing === 'q'
      ? (s.dir === 'inbound' ? `QDM ${fmt(s.radial + 180)}°` : `QDR ${fmt(s.radial)}°`)
      : `radial ${fmt(s.radial)}° flying ${s.dir}`;
    const where = s.display === 'numbers'
      ? (s.phrasing === 'q' ? `Your QDM is ${fmt(s.pos + 180)}°, ` : `You are on radial ${fmt(s.pos)}°, `)
      : 'You are at the position shown, ';
    return `${where}${s.dist.toFixed(1)} NM from the station, HDG ${fmt(s.hdg)}°, GS ${s.gs} kt. ` +
      `You have to intercept ${target}. What is the type of interception, initial track and interception track? (No wind)`;
  }
  const where = s.display === 'numbers' ? ` Your track to the ${s.nav} is ${fmt(s.trk)}°.` : '';
  return `You have to join a ${s.turn === 'std' ? 'STD' : 'Non-STD'} holding over the ${s.nav}, inbound track ${fmt(s.inbound)}°.` +
    `${where} What is your entry type and initial track?`;
}

// ---------- distractors ----------

function interceptPool(s, correct) {
  const P = s.pos;
  const pool = [];
  const add = (text, mistake) => pool.push({ text, mistake });
  const T = s.dir === 'inbound' ? norm(s.radial + 180) : s.radial;
  const k0 = Math.sign(sdiff(T, correct.intercept)) || 1; // side the correct answer turns to
  const a = Math.abs(sdiff(s.radial, P));
  const corrAngle = Math.min(2 * a, 30);
  const offs = { correction: [corrAngle, corrAngle], '45': [45, 45], '90/45': [90, 45] };
  for (const base of [T, norm(T + 180)]) {
    for (const k of [k0, -k0]) {
      for (const type of ['correction', '45', '90/45']) {
        const [i, x] = offs[type];
        const opt = { type, initial: norm(base + k * i), intercept: norm(base + k * x) };
        const m = [];
        if (base !== T) m.push('reciprocal (radial ↔ QDM mix-up)');
        if (k !== k0 && correct.type !== 'overstation') m.push('wrong side of the radial');
        if (type !== correct.type) m.push('wrong interception type');
        add(interceptText(opt), m.join(', ') || 'wrong side of the radial');
      }
    }
  }
  if (correct.type === 'correction') {
    const t = norm(T + k0 * a);
    add(interceptText({ type: 'correction', initial: t, intercept: t }), 'correction angle not doubled');
  }
  if (correct.type === 'overstation') {
    const wrong = norm(2 * s.radial - correct.intercept);
    add(interceptText({ ...correct, intercept: wrong }), 'over-station interception on the wrong side');
  }
  if (s.display !== 'numbers') {
    const flipped = { ...s, pos: norm(P + 180) };
    try {
      add(interceptText(solve(flipped)), 'TO/FROM (needle head/tail) read backwards');
    } catch { /* flipped position is out of scope for inbound; skip */ }
  }
  return pool;
}

function holdPool(s, correct) {
  const pool = [];
  const add = (text, mistake) => pool.push({ text, mistake });
  const O = norm(s.inbound + 180);
  if (correct.entry === 'teardrop') {
    add(holdText({ ...correct, initial: norm(s.turn === 'std' ? O + 30 : O - 30) }), 'teardrop on the wrong side');
  }
  for (const turn of ['std', 'nonstd']) {
    const mirrored = turn !== s.turn;
    const h = holding({ inbound: s.inbound, turn, trk: s.trk });
    if (mirrored) add(holdText(h), 'STD / Non-STD mirrored');
    for (const entry of ENTRIES) {
      const initial = entryInitial(entry, { inbound: s.inbound, turn, trk: s.trk });
      const m = [];
      if (entry !== correct.entry) m.push('wrong sector');
      if (mirrored) m.push('STD / Non-STD mirrored');
      add(holdText({ entry, turn, initial, trk: s.trk, outbound: O }), m.join(', ') || 'wrong sector');
    }
  }
  if (s.display !== 'numbers') {
    add(holdText(holding({ inbound: s.inbound, turn: s.turn, trk: norm(s.trk + 180) })), 'TO/FROM (needle head/tail) read backwards');
  }
  for (const pair of EITHER_PAIRS) add(holdText({ either: pair }), correct.either ? 'wrong boundary' : 'not near a sector boundary (±5°)');
  return pool;
}

// Build a multiple-choice question from a scenario. Options are shuffled by `rng`.
export function buildQuestion(s, rng) {
  const result = solve(s);
  const correctText = result.kind === 'intercept' ? interceptText(result) : holdText(result);
  const pool = result.kind === 'intercept' ? interceptPool(s, result) : holdPool(s, result);
  const seen = new Set([correctText]);
  const distinct = [];
  for (const o of pool) {
    if (seen.has(o.text)) continue;
    seen.add(o.text);
    distinct.push(o);
  }
  // Single-mistake options first (most instructive), then the rest, randomised within each group.
  const single = shuffle(rng, distinct.filter((o) => !o.mistake.includes(',')));
  const multi = shuffle(rng, distinct.filter((o) => o.mistake.includes(',')));
  const distractors = [...single, ...multi].slice(0, 4);
  const options = shuffle(rng, [{ text: correctText, mistake: null }, ...distractors]);
  return {
    scenario: s,
    prompt: promptText(s),
    options,
    correctIndex: options.findIndex((o) => o.mistake === null),
    steps: [...readingSteps(s), ...result.steps],
    statKey: result.kind === 'intercept' ? result.type : 'holding',
  };
}

// What the instruments show for a scenario. P = your radial.
export function instrumentState(s) {
  const P = s.kind === 'intercept' ? s.pos : norm(s.trk + 180);
  const qdm = norm(P + 180);
  return { P, hdg: s.hdg, qdm, obs: s.flag === 'FROM' ? P : qdm, flag: s.flag, nav: s.kind === 'hold' ? s.nav : 'VOR' };
}

// First worked step in instrument modes: what the instrument says.
export function readingSteps(s) {
  if (s.display === 'numbers') return [];
  const { P, qdm, obs } = instrumentState(s);
  if (s.display === 'rmi') {
    return [`RMI: heading ${fmt(s.hdg)}°, needle head QDM ${fmt(qdm)}°, tail QDR ${fmt(P)}° → you are on R-${fmt(P)}`];
  }
  const what = s.display === 'hsi' ? 'HSI' : 'CDI';
  return [s.flag === 'FROM'
    ? `${what}: course ${fmt(obs)}° centred with FROM flag → you are on R-${fmt(P)}, heading ${fmt(s.hdg)}°`
    : `${what}: course ${fmt(obs)}° centred with TO flag → QDM ${fmt(obs)}°, you are on R-${fmt(P)}, heading ${fmt(s.hdg)}°`];
}
