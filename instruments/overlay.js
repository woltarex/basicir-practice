// Solution overlay drawn on top of an instrument after the user answers.
// Every line is placed by compass bearing in the card's own frame, so it lines up with the card numerals.
// Like the school's worked solutions, tracks are drawn as rays from the station/fix in the instrument centre.
import { norm, fmt } from '../rules.js';

export const COLORS = {
  required: '#ff4d4d',
  you: '#ffffff',
  initial: '#b8e986',
  intercept: '#1fbf5f',
  tostation: '#4db8ff',
  racetrack: '#4db8ff',
  boundary: '#9aa4b2',
};

const pt = (b, r) => {
  const a = (b * Math.PI) / 180;
  return [+(100 + r * Math.sin(a)).toFixed(1), +(100 - r * Math.cos(a)).toFixed(1)];
};

// A line along bearing b from radius r0 to r1 (r1 < r0 means it points inward), optional arrowhead at r1.
function ray(role, b, color, { r0 = 0, r1 = 64, arrow = true, dash = false, at = null } = {}) {
  const tip = r1 > r0 ? `M100 ${100 - r1} l-4 8 h8 z` : `M100 ${100 - r1} l-4 -8 h8 z`;
  const move = at ? `translate(${at[0] - 100} ${at[1] - 100}) ` : '';
  return `<g data-role="${role}" data-bearing="${norm(b)}" transform="${move}rotate(${norm(b)} 100 100)">` +
    `<line x1="100" y1="${100 - r0}" x2="100" y2="${100 - r1}" stroke="${color}" stroke-width="2.5"${dash ? ' stroke-dasharray="5 4"' : ''}/>` +
    (arrow ? `<path d="${tip}" fill="${color}"/>` : '') + '</g>';
}

function interceptParts(s, r) {
  const parts = [
    ray('required', s.radial, COLORS.required, { r1: 80, arrow: false }),
    ray('you', s.pos, COLORS.you, { r1: 80, arrow: false, dash: true }),
    (() => { const [x, y] = pt(s.pos, 50); return `<circle data-role="aircraft" cx="${x}" cy="${y}" r="5" fill="#f08a24" stroke="#000"/>`; })(),
  ];
  const legend = [
    { color: COLORS.required, text: `Required radial R-${fmt(s.radial)}` },
    { color: COLORS.you, text: `You are on R-${fmt(s.pos)} (orange dot)` },
  ];
  if (r.type === 'overstation') {
    parts.push(ray('tostation', r.initial, COLORS.tostation));
    legend.push({ color: COLORS.tostation, text: `Track to the station ${fmt(r.initial)}°` });
  } else if (r.type === '90/45') {
    parts.push(ray('initial', r.initial, COLORS.initial));
    legend.push({ color: COLORS.initial, text: `Initial track ${fmt(r.initial)}°` });
  }
  parts.push(ray('intercept', r.intercept, COLORS.intercept));
  legend.push({
    color: COLORS.intercept,
    text: r.type === '90/45' || r.type === 'overstation'
      ? `Interception track ${fmt(r.intercept)}°`
      : `Initial = interception track ${fmt(r.intercept)}°`,
  });
  return { parts, legend };
}

function holdParts(s, r) {
  const O = norm(s.inbound + 180);
  const std = s.turn === 'std';
  const L = 40, w = 22; // racetrack leg length and width
  // In a frame with the outbound direction up, the inbound leg runs down into the fix at the centre;
  // the holding side is to the right of the inbound track (STD) → x < 100, or to the left (Non-STD).
  const racetrack =
    `<g data-role="racetrack" data-bearing="${O}" data-turn="${s.turn}" transform="rotate(${O} 100 100)">` +
    `<rect x="${std ? 100 - w : 100}" y="${100 - L - w / 2}" width="${w}" height="${L + w}" rx="${w / 2}" fill="none" stroke="${COLORS.racetrack}" stroke-width="2.5"/>` +
    `<path d="M100 ${100 - L / 2 + 4} l-4 -8 h8 z" fill="${COLORS.racetrack}"/></g>`;
  const from = (d) => (std ? s.inbound + d + 180 : s.inbound - d + 180);
  const parts = [
    ...[70, 110, 180, 290].map((d) => ray('boundary', from(d), COLORS.boundary, { r1: 86, arrow: false, dash: true })),
    racetrack,
    ray('arrival', s.trk + 180, COLORS.you, { r0: 86, r1: 10 }),
  ];
  const legend = [
    { color: COLORS.racetrack, text: `Holding: inbound ${fmt(s.inbound)}°, ${std ? 'right' : 'left'} turns` },
    { color: COLORS.boundary, text: 'Sector boundaries (70° / 110° / 180° / 290° from the inbound track)' },
    { color: COLORS.you, text: `You arrive on track ${fmt(s.trk)}° to the fix` },
  ];
  if (r.either) {
    legend.push({ color: COLORS.boundary, text: 'Within ±5° of a boundary → either entry is correct' });
  } else if (r.entry === 'special') {
    parts.push(ray('entry', s.trk, COLORS.initial, { r1: 22 }));
    parts.push(ray('outbound', O, COLORS.initial, { r1: 44, at: pt(s.trk, 22) }));
    legend.push({ color: COLORS.initial, text: `Special direct: ${fmt(s.trk)}° for 15 s, then outbound ${fmt(O)}°` });
  } else {
    parts.push(ray('entry', r.initial, COLORS.initial));
    legend.push({ color: COLORS.initial, text: `${r.entry[0].toUpperCase() + r.entry.slice(1)} entry: initial track ${fmt(r.initial)}°` });
  }
  return { parts, legend };
}

// s: scenario, r: rule result, up: the bearing at the top of the card the overlay is drawn on.
export function overlay(s, r, up) {
  const { parts, legend } = r.kind === 'intercept' ? interceptParts(s, r) : holdParts(s, r);
  return { svg: `<g id="overlay" transform="rotate(${norm(-up)} 100 100)">${parts.join('')}</g>`, legend };
}
