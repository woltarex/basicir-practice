// Shared SVG pieces. All instruments use a 200×200 viewBox centred on (100,100).
import { norm } from '../rules.js';

export const LABELS = { 0: 'N', 30: '3', 60: '6', 90: 'E', 120: '12', 150: '15', 180: 'S', 210: '21', 240: '24', 270: 'W', 300: '30', 330: '33' };

// Compass card rotated so `up` is at the top. r = outer tick radius.
export function card(id, up, r = 82) {
  let s = `<g id="${id}" transform="rotate(${norm(-up)} 100 100)">`;
  for (let a = 0; a < 360; a += 5) {
    const len = a % 30 === 0 ? 10 : a % 10 === 0 ? 7 : 4;
    s += `<line x1="100" y1="${100 - r}" x2="100" y2="${100 - r + len}" stroke="currentColor" stroke-width="${a % 10 ? 1 : 1.6}" transform="rotate(${a} 100 100)"/>`;
  }
  for (const [a, t] of Object.entries(LABELS)) {
    s += `<text x="100" y="${100 - r + 24}" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor" transform="rotate(${a} 100 100)">${t}</text>`;
  }
  return s + '</g>';
}

export const bezel = (label) =>
  `<circle cx="100" cy="100" r="96" fill="#111" stroke="#666" stroke-width="4"/>` +
  `<text x="2" y="11" font-size="10" font-weight="700" fill="#f08a24">${label}</text>`;

export const lubber = `<path d="M100 6 l-6 -0 l6 10 l6 -10 z" fill="#f08a24"/>`;

export const svg = (body, label) =>
  `<svg viewBox="0 0 200 200" class="instrument" role="img" aria-label="${label}" style="color:#eee">${body}</svg>`;
