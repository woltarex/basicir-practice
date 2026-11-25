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
