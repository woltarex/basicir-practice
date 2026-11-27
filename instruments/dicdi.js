import { card, bezel, lubber, svg } from './card.js';

const FLAG_TEXT = { TO: 'TO ▲', FROM: 'FR ▼', OFF: 'OFF' };

// Heading indicator + VOR CDI. OBS at the top of the CDI card.
// deflection: degrees, + = needle right; 2° per dot (5 dots per side), 4 SVG units per degree, clamped at ±10°.
export function dicdi({ hdg, obs, flag, deflection = 0 }, extra = '') {
  const dx = Math.max(-10, Math.min(10, deflection)) * 4;
  const plane = `<path d="M100 70 v60 M70 98 h60 M88 124 h24" stroke="#f08a24" stroke-width="5" fill="none" stroke-linecap="round"/>`;
  const di = svg(bezel('HDG') + card('card', hdg) + plane + lubber, 'Heading indicator');
  const flagBox =
    // Below the dot row, inside radius ~56 (far corner 144,134 → 55.6) so it never covers the card numerals
    // (which start at radius 58). Drawn before #cdi so the needle passes over it, never under.
    `<rect x="110" y="116" width="34" height="18" rx="2" fill="${flag === 'OFF' ? '#c0392b' : '#000'}" stroke="#555"/>` +
    `<text id="flag" data-flag="${flag}" x="127" y="130" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">${FLAG_TEXT[flag]}</text>`;
  // Deviation dots across the middle, with the centre circle the needle sits in when on course.
  const dots = [-40, -32, -24, -16, -8, 8, 16, 24, 32, 40].map((x) => `<circle cx="${100 + x}" cy="100" r="2.5" fill="#eee"/>`).join('');
  const ring = `<circle cx="100" cy="100" r="6" fill="none" stroke="#eee" stroke-width="2"/>`;
  const cdi = svg(
    bezel('VOR') + card('obs', obs) + dots + ring + flagBox +
      `<line id="cdi" x1="100" y1="50" x2="100" y2="150" stroke="#fff" stroke-width="4" transform="translate(${dx} 0)"/>` +
      extra + `<path d="M100 18 l-6 10 h12 z" fill="#f2d200"/>`,
    'VOR CDI',
  );
  return `<div class="pair">${di}${cdi}</div>`;
}
