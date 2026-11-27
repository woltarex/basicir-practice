// Solution overlay drawn on top of an instrument after the user answers.
// Every line is placed by compass bearing in the card's own frame, so it lines up with the card numerals.
// Like the school's worked solutions, tracks are drawn as rays from the station/fix in the instrument centre.
import { norm, fmt } from '../rules.js';
import { card, bezel, svg } from './card.js';

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

const SECTORS = [
  { label: 'DIR', from: 290, to: 430, labelAt: 25, color: '#1fbf5f' },
  { label: 'SPEC', from: 70, to: 110, color: '#b8e986' },
  { label: 'TD', from: 110, to: 180, color: '#f2d200' },
  { label: 'PAR', from: 180, to: 290, color: '#4db8ff' },
];

// Bearing from the fix toward where an aircraft with holding angle d comes from.
const fromBearing = ({ inbound, turn }, d) => norm(turn === 'std' ? inbound + d + 180 : inbound - d + 180);

// Shaded sector wedges, dashed boundary lines and labels kept upright on a card rotated by `up`.
export function sectorParts(s, up, opacity = 0.08) {
  const R = 86;
  const sweep = s.turn === 'std' ? 1 : 0; // STD bearings grow clockwise with d
  const parts = SECTORS.map(({ label, from, to, color }) => {
    const [x1, y1] = pt(fromBearing(s, from), R);
    const [x2, y2] = pt(fromBearing(s, to), R);
    const large = to - from > 180 ? 1 : 0;
    return `<path data-role="wedge" data-label="${label}" d="M100 100 L${x1} ${y1} A${R} ${R} 0 ${large} ${sweep} ${x2} ${y2} Z" fill="${color}" fill-opacity="${opacity}"/>`;
  });
  for (const d of [70, 110, 180, 290]) parts.push(ray('boundary', fromBearing(s, d), COLORS.boundary, { r1: 86, arrow: false, dash: true }));
  for (const { label, from, to, labelAt } of SECTORS) {
    const b = fromBearing(s, labelAt ?? (from + to) / 2);
    const [x, y] = pt(b, 44);
    parts.push(`<text data-role="sector" data-label="${label}" data-bearing="${b}" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-size="8" font-weight="700" fill="#cfd6df" transform="rotate(${norm(up)} ${x} ${y})">${label}</text>`);
  }
  return parts;
}

function racetrack(s) {
  const O = norm(s.inbound + 180);
  const std = s.turn === 'std';
  const L = 40, w = 22; // racetrack leg length and width
  // In a frame with the outbound direction up, the inbound leg runs down into the fix at the centre;
  // the holding side is to the right of the inbound track (STD) → x < 100, or to the left (Non-STD).
  return `<g data-role="racetrack" data-bearing="${O}" data-turn="${s.turn}" transform="rotate(${O} 100 100)">` +
    `<rect x="${std ? 100 - w : 100}" y="${100 - L - w / 2}" width="${w}" height="${L + w}" rx="${w / 2}" fill="none" stroke="${COLORS.racetrack}" stroke-width="2.5"/>` +
    `<path d="M100 ${100 - L / 2 + 4} l-4 -8 h8 z" fill="${COLORS.racetrack}"/></g>`;
}

function holdParts(s, r, up) {
  const O = norm(s.inbound + 180);
  const std = s.turn === 'std';
  const parts = [
    ...sectorParts(s, up),
    racetrack(s),
    ray('arrival', s.trk + 180, COLORS.you, { r0: 86, r1: 10 }),
  ];
  const legend = [
    { color: COLORS.racetrack, text: `Holding: inbound ${fmt(s.inbound)}°, ${std ? 'right' : 'left'} turns` },
    { color: COLORS.boundary, text: 'Sector boundaries (70° / 110° / 180° / 290° from the inbound track): DIR · SPEC · TD · PAR' },
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
  const { parts, legend } = r.kind === 'intercept' ? interceptParts(s, r) : holdParts(s, r, up);
  return { svg: `<g id="overlay" transform="rotate(${norm(-up)} 100 100)">${parts.join('')}</g>`, legend };
}

// Stand-alone sector chart for the Rules sheet: inbound 000°, north up, stronger shading.
export function sectorDiagram(turn) {
  const s = { inbound: 0, turn };
  const name = turn === 'std' ? 'STD' : 'NON-STD';
  return svg(bezel(name) + card('card', 0) +
    `<g id="overlay" transform="rotate(0 100 100)">${sectorParts(s, 0, 0.3).join('')}${racetrack(s)}</g>`,
  `${name} holding entry sectors`);
}
