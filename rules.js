// Pure rule engine. All angles are integer degrees in [0, 360).

export const norm = (x) => ((Math.round(x) % 360) + 360) % 360;

// Signed smallest difference going from `from` to `to`, in (-180, 180].
export function sdiff(from, to) {
  const d = norm(to - from);
  return d > 180 ? d - 360 : d;
}

export const fmt = (x) => String(norm(x)).padStart(3, '0');

// ---------- Interception ----------

export const INTERCEPT_TYPES = ['correction', '45', '90/45', 'overstation'];

export function interceptBand(absDelta) {
  if (absDelta < 15) return 'correction';
  if (absDelta <= 30) return '45';
  if (absDelta <= 70) return '90/45';
  return 'overstation';
}

// radial: required radial FROM the station. dir: 'inbound' | 'outbound'. pos: actual radial.
export function interception({ radial, dir, pos }) {
  const R = norm(radial);
  const P = norm(pos);
  const T = dir === 'inbound' ? norm(R + 180) : R;
  const delta = sdiff(R, P);
  const a = Math.abs(delta);
  const side = Math.sign(delta) || 1; // +1: you are clockwise of R
  // Turn toward the radial: inbound adds, outbound subtracts.
  const k = dir === 'inbound' ? side : -side;
  const type = interceptBand(a);
  const steps = [
    dir === 'inbound'
      ? `Required track = ${fmt(R)} + 180 = ${fmt(T)}° (inbound)`
      : `Required track = radial = ${fmt(T)}° (outbound)`,
    `You are on R-${fmt(P)} → Δ = ${a}° (${side > 0 ? 'clockwise' : 'anticlockwise'} of R-${fmt(R)})`,
  ];

  if (type === 'correction') {
    const angle = Math.min(2 * a, 30);
    const track = norm(T + k * angle);
    steps.push(`Δ < 15° → correction, angle = 2 × ${a} = ${2 * a}°${2 * a > 30 ? ' → capped at 30°' : ''}`);
    steps.push(`Track = ${fmt(T)} ${k > 0 ? '+' : '−'} ${angle} = ${fmt(track)}° (initial = interception)`);
    return { kind: 'intercept', type, initial: track, intercept: track, steps };
  }
  if (type === '45') {
    const track = norm(T + k * 45);
    steps.push(`15° ≤ Δ ≤ 30° → 45° intercept`);
    steps.push(`Track = ${fmt(T)} ${k > 0 ? '+' : '−'} 45 = ${fmt(track)}° (initial = interception)`);
    return { kind: 'intercept', type, initial: track, intercept: track, steps };
  }
  if (type === '90/45') {
    const initial = norm(T + k * 90);
    const intercept = norm(T + k * 45);
    steps.push(`30° < Δ ≤ 70° → 90°/45° intercept`);
    steps.push(`Initial track = ${fmt(T)} ${k > 0 ? '+' : '−'} 90 = ${fmt(initial)}°`);
    steps.push(`Interception track = ${fmt(T)} ${k > 0 ? '+' : '−'} 45 = ${fmt(intercept)}°`);
    return { kind: 'intercept', type, initial, intercept, steps };
  }
  if (dir === 'inbound') throw new Error('Inbound interception with Δ > 70° is out of scope');
  const K = norm(P + 180);
  const s = sdiff(R, K);
  const angle = Math.min(Math.round(Math.abs(s) / 3), 30);
  const intercept = norm(R - (Math.sign(s) || 1) * angle);
  steps.push(`Δ > 70° → track to the station first: QDM ${fmt(K)}°`);
  steps.push(`After passing: TRK difference = ${Math.abs(s)}°, angle = ${Math.abs(s)} / 3 = ${Math.round(Math.abs(s) / 3)}°${Math.round(Math.abs(s) / 3) > 30 ? ' → capped at 30°' : ''}`);
  steps.push(`Interception track = ${fmt(R)} ${s >= 0 ? '−' : '+'} ${angle} = ${fmt(intercept)}°`);
  return { kind: 'intercept', type, initial: K, intercept, steps };
}

export function interceptText({ type, initial, intercept }) {
  if (type === 'correction') return `Correction, initial track = interception track ${fmt(intercept)}°`;
  if (type === '45') return `45°, initial track = interception track ${fmt(intercept)}°`;
  if (type === '90/45') return `90°/45°, initial track ${fmt(initial)}°, interception track ${fmt(intercept)}°`;
  return `Track to station (${fmt(initial)}°), then over-station interception track ${fmt(intercept)}°`;
}

// ---------- Holding ----------

export const ENTRIES = ['direct', 'special', 'teardrop', 'parallel'];
const ENTRY_NAME = { direct: 'Direct', special: 'Special direct', teardrop: 'Teardrop', parallel: 'Parallel' };
// Boundaries with a ±5° "either" zone, and the entries on each side.
const EITHER = [
  { at: 110, pair: ['special', 'teardrop'] },
  { at: 180, pair: ['teardrop', 'parallel'] },
  { at: 290, pair: ['parallel', 'direct'] },
];
export const EITHER_PAIRS = EITHER.map((e) => e.pair);

export function holdAngle({ inbound, turn, trk }) {
  return turn === 'std' ? norm(trk - inbound) : norm(inbound - trk);
}

export function sectorOf(d) {
  if (d < 70 || d > 290) return 'direct';
  if (d < 110) return 'special';
  if (d < 180) return 'teardrop';
  return 'parallel';
}

// Initial track (or heading for special) of a given entry.
export function entryInitial(entry, { inbound, turn, trk }) {
  const O = norm(inbound + 180);
  if (entry === 'teardrop') return norm(turn === 'std' ? O - 30 : O + 30);
  if (entry === 'special') return norm(trk);
  return O;
}

// inbound: inbound track. turn: 'std' (right) | 'nonstd' (left). trk: aircraft track to the fix.
export function holding({ inbound, turn, trk }) {
  const I = norm(inbound);
  const O = norm(I + 180);
  const d = holdAngle({ inbound: I, turn, trk });
  const entry = sectorOf(d);
  const steps = [
    `${turn === 'std' ? 'STD (right turns)' : 'Non-STD (left turns)'}, inbound ${fmt(I)}°, outbound ${fmt(O)}°`,
    turn === 'std'
      ? `d = track to fix − inbound = ${fmt(trk)} − ${fmt(I)} = ${d}° (mod 360)`
      : `d = inbound − track to fix = ${fmt(I)} − ${fmt(trk)} = ${d}° (mod 360)`,
    `Sectors: direct 0–70 & 290–360, special direct 70–110, teardrop 110–180, parallel 180–290`,
  ];
  const zone = EITHER.find((e) => Math.abs(d - e.at) <= 5);
  if (zone) {
    steps.push(`d is within ±5° of the ${zone.at}° boundary → either ${ENTRY_NAME[zone.pair[0]]} or ${ENTRY_NAME[zone.pair[1]]}`);
    return { kind: 'hold', entry: null, either: zone.pair, turn, initial: null, trk: norm(trk), outbound: O, steps };
  }
  const initial = entryInitial(entry, { inbound: I, turn, trk });
  steps.push(`d = ${d}° → ${ENTRY_NAME[entry]}`);
  if (entry === 'teardrop') steps.push(`Teardrop track = ${fmt(O)} ${turn === 'std' ? '−' : '+'} 30 = ${fmt(initial)}°`);
  if (entry === 'parallel') steps.push(`Parallel: fly outbound track ${fmt(O)}° on the non-holding side`);
  if (entry === 'direct') steps.push(`Direct: turn ${turn === 'std' ? 'right' : 'left'} to outbound ${fmt(O)}°`);
  if (entry === 'special') steps.push(`Special direct: hold ${fmt(trk)}° for 15 s, turn ${turn === 'std' ? 'right' : 'left'} to ${fmt(O)}°, outbound 45 s`);
  return { kind: 'hold', entry, either: null, turn, initial, trk: norm(trk), outbound: O, steps };
}

export function holdText({ entry, either, turn, initial, trk, outbound }) {
  if (either) return `Either ${ENTRY_NAME[either[0]]} or ${ENTRY_NAME[either[1]]}`;
  const dirWord = turn === 'std' ? 'right' : 'left';
  if (entry === 'direct') return `Direct, turn ${dirWord} to TRK ${fmt(initial)}°`;
  if (entry === 'special') return `Special direct, hold ${fmt(trk)}° for 15 s, then turn ${dirWord} to TRK ${fmt(outbound)}°`;
  return `${ENTRY_NAME[entry]}, initial track ${fmt(initial)}°`;
}
