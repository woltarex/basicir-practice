// Scenarios, questions and distractors. Pure: all randomness comes from `rng`.
import {
  norm, sdiff, fmt, interception, interceptText, holding, holdText,
  ENTRIES, EITHER_PAIRS, entryInitial, cdiReading,
} from './rules.js';
import { defaults } from './store.js';

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

const DEFAULT_FILTERS = defaults().settings.filters;
const INBOUND_BANDS = ['correction', '45', '90/45']; // inbound has no over-station band
const only = (all, chosen) => all.filter((x) => chosen.includes(x)); // keeps the canonical draw order
const bandsFor = (dir, bands) => only(dir === 'inbound' ? INBOUND_BANDS : Object.keys(BANDS), bands);
const filtersOf = (settings) => ({ ...DEFAULT_FILTERS, ...settings.filters });

// settings: { types, display, instruments, filters? } — see store.js defaults().
export function makeScenario(rng, settings, id, stats = null) {
  const f = filtersOf(settings);
  // Adaptive: pick the stat key first (weighted toward weak spots), then build a scenario for it.
  const key = settings.adaptive && stats ? pickWeighted(rng, eligibleKeys(settings), stats) : null;
  const kind = key ? (key === 'holding' ? 'hold' : 'intercept') : pick(rng, settings.types);
  const bands = key && key !== 'holding' ? [key] : f.bands;
  // HSI and DI+CDI only show VOR holds, so NDB-only holds stay on the RMI or numbers.
  const vorOk = kind === 'intercept' || f.navs.includes('VOR');
  const display = pickDisplay(rng, vorOk ? settings : { ...settings, instruments: only(['rmi'], settings.instruments) });
  const flag = pick(rng, ['TO', 'FROM']);
  if (kind === 'intercept') {
    const dir = pick(rng, only(['inbound', 'outbound'], f.dirs).filter((d) => bandsFor(d, bands).length));
    const band = pick(rng, bandsFor(dir, bands));
    const [lo, hi] = BANDS[band];
    const radial = int(rng, 0, 359);
    const pos = norm(radial + (rng() < 0.5 ? -1 : 1) * int(rng, lo, hi));
    return withObs(rng, settings, {
      id, kind, display, flag, radial, dir, pos,
      phrasing: pick(rng, only(['radial', 'q'], f.phrasings)),
      dist: int(rng, 30, 120) / 10,
      hdg: int(rng, 0, 359),
      gs: pick(rng, [90, 100, 110, 120, 140]),
    });
  }
  const inbound = int(rng, 0, 359);
  const turn = pick(rng, only(['std', 'nonstd'], f.turns));
  // ~20% (or ~80% with boundaryFocus) land in a ±5° either zone.
  const d = rng() < (f.boundaryFocus ? 0.8 : 0.2) ? pick(rng, [110, 180, 290]) + int(rng, -5, 5) : int(rng, 0, 359);
  const trk = turn === 'std' ? norm(inbound + d) : norm(inbound - d);
  return withObs(rng, settings, {
    id, kind, display, flag, inbound, turn, trk,
    nav: display === 'rmi' || display === 'numbers' ? pick(rng, only(['NDB', 'VOR'], f.navs)) : 'VOR',
    hdg: trk,
  });
}

// cdiMode on HSI / DI+CDI: 'deflected' sets the OBS 1–4 whole dots (2° each) off your radial (FROM)
// or QDM (TO), keeping the flag; 'interactive' starts from a random OBS the user turns to centre.
function withObs(rng, settings, s) {
  const mode = settings.cdiMode ?? 'centered';
  if (mode === 'centered' || (s.display !== 'hsi' && s.display !== 'dicdi')) return s;
  const { P, qdm } = instrumentState(s);
  s.obs = mode === 'interactive'
    ? int(rng, 0, 359)
    : norm((s.flag === 'FROM' ? P : qdm) + (rng() < 0.5 ? -1 : 1) * pick(rng, [2, 4, 6, 8]));
  return s;
}

function pickDisplay(rng, { display, instruments }) {
  if (display === 'numbers' || instruments.length === 0) return 'numbers';
  if (display === 'instruments') return pick(rng, instruments);
  return pick(rng, ['numbers', ...instruments]);
}

// Why the current settings cannot start a session ('' when they can).
export function setupError(s) {
  const f = filtersOf(s);
  if (s.types.length === 0) return 'Pick at least one exercise.';
  if (s.display !== 'numbers' && s.instruments.length === 0) return 'Pick at least one instrument, or switch to Numbers.';
  if (s.types.includes('intercept')) {
    if (!f.bands.length) return 'Pick at least one interception band.';
    if (!f.dirs.length) return 'Pick inbound, outbound or both.';
    if (!f.phrasings.length) return 'Pick at least one phrasing (radial or QDM / QDR).';
    if (!f.dirs.some((d) => bandsFor(d, f.bands).length)) return 'Inbound interception has no over-station band.';
  }
  if (s.types.includes('hold')) {
    if (!f.turns.length) return 'Pick STD, Non-STD or both.';
    if (!f.navs.length) return 'Pick VOR, NDB or both.';
    if (s.display === 'instruments' && !f.navs.includes('VOR') && !s.instruments.includes('rmi')) {
      return 'NDB holdings require RMI or Numbers display.';
    }
  }
  return '';
}

// Stat keys (see buildQuestion's statKey) that the current types and filters can produce.
export function eligibleKeys(settings) {
  const f = filtersOf(settings);
  const keys = settings.types.includes('intercept')
    ? ['correction', '45', '90/45', 'overstation'].filter((b) => f.bands.includes(b) && f.dirs.some((d) => bandsFor(d, [b]).length))
    : [];
  return settings.types.includes('hold') ? [...keys, 'holding'] : keys;
}

// How much to drill a stat key: unseen first, then by error rate and slowness; never below 0.5.
export function statWeight(st) {
  if (!st || !(st.total > 0)) return 3;
  const acc = st.correct / st.total; // 0..1
  const avgSec = st.ms / st.total / 1000;
  const errorTerm = (1 - acc) * 4; // 0..4
  const speedTerm = Math.min(avgSec / 30, 1.5); // 0..1.5
  return 0.5 + errorTerm + speedTerm;
}

// All-time totals; weakest = the answered key the adaptive drill would weight most.
export function summarize(stats) {
  const seen = Object.entries(stats).filter(([, v]) => v && v.total > 0);
  const t = { correct: 0, total: 0, ms: 0 };
  for (const [, v] of seen) { t.correct += v.correct; t.total += v.total; t.ms += v.ms; }
  const weakest = seen.length ? seen.reduce((a, b) => (statWeight(b[1]) > statWeight(a[1]) ? b : a))[0] : null;
  return { ...t, weakest };
}

export function pickWeighted(rng, keys, stats) {
  const w = keys.map((k) => statWeight(stats[k]));
  let x = rng() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < keys.length; i++) if ((x -= w[i]) < 0) return keys[i];
  return keys.at(-1);
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
    `${where} What is your entry type and initial track? (No wind)`;
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
      if (correct.either && !mirrored && correct.either.includes(entry)) m.push('inside ±5° of a sector boundary the answer is "Either …" — not a single entry');
      else if (entry !== correct.entry) m.push('wrong sector');
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
    result,
  };
}

// What the instruments show for a scenario. P = your radial.
// Without s.obs the CDI is centred on the scenario's flag (v1); with s.obs it reads cdiReading.
export function instrumentState(s) {
  const P = s.kind === 'intercept' ? s.pos : norm(s.trk + 180);
  const qdm = norm(P + 180);
  const centred = s.obs == null;
  const obs = centred ? (s.flag === 'FROM' ? P : qdm) : norm(s.obs);
  const { flag, deflection } = centred ? { flag: s.flag, deflection: 0 } : cdiReading(obs, P);
  return { P, hdg: s.hdg, qdm, obs, flag, deflection, nav: s.kind === 'hold' ? s.nav : 'VOR' };
}

// First worked step in instrument modes: what the instrument says.
export function readingSteps(s) {
  if (s.display === 'numbers') return [];
  const { P, qdm, obs, flag, deflection } = instrumentState(s);
  if (s.display === 'rmi') {
    return [`RMI: heading ${fmt(s.hdg)}°, needle head QDM ${fmt(qdm)}°, tail QDR ${fmt(P)}° → you are on R-${fmt(P)}`];
  }
  const what = s.display === 'hsi' ? 'HSI' : 'CDI';
  const you = `you are on R-${fmt(P)}, heading ${fmt(s.hdg)}°`;
  if (flag === 'OFF' || Math.abs(deflection) > 10) {
    return [`${what}: ${flag === 'OFF' ? 'OFF flag' : 'needle full scale'} at OBS ${fmt(obs)}° → ` +
      `turn the OBS until the needle centres: FROM ${fmt(P)}° or TO ${fmt(qdm)}° → ${you}`];
  }
  if (deflection !== 0) {
    const dots = Math.abs(deflection) / 2;
    const needle = `needle ${dots} dot${dots === 1 ? '' : 's'} ${deflection > 0 ? 'right' : 'left'} (${deflection > 0 ? '+' : '−'}${Math.abs(deflection)}°)`;
    return [flag === 'FROM'
      ? `${what}: OBS ${fmt(obs)}° with FROM flag, ${needle} → ${you}`
      : `${what}: OBS ${fmt(obs)}° with TO flag, ${needle} → QDM ${fmt(qdm)}°, ${you}`];
  }
  return [flag === 'FROM'
    ? `${what}: course ${fmt(obs)}° centred with FROM flag → ${you}`
    : `${what}: course ${fmt(obs)}° centred with TO flag → QDM ${fmt(obs)}°, ${you}`];
}

// Option label → [{ text, bold }]: the leading phrase (up to the first comma or bracket) and every
// 3-digit track are bold. The app renders these as DOM nodes, never as HTML.
export function emphasisParts(text) {
  const cut = text.search(/[,(]/);
  const lead = cut === -1 ? text : text.slice(0, cut);
  const rest = cut === -1 ? '' : text.slice(cut);
  const parts = [{ text: lead, bold: true }];
  let last = 0;
  for (const m of rest.matchAll(/\b\d{3}°/g)) {
    if (m.index > last) parts.push({ text: rest.slice(last, m.index), bold: false });
    parts.push({ text: m[0], bold: true });
    last = m.index + m[0].length;
  }
  if (last < rest.length) parts.push({ text: rest.slice(last), bold: false });
  return parts;
}
