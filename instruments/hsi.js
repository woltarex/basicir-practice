import { norm } from '../rules.js';
import { card, bezel, lubber, svg } from './card.js';

const FLAGS = {
  TO: `<path id="flag" data-flag="TO" d="M100 66 l-8 12 h16 z" fill="#fff"/>`,
  FROM: `<path id="flag" data-flag="FROM" d="M100 134 l-8 -12 h16 z" fill="#fff"/>`,
  OFF: `<g id="flag" data-flag="OFF"><rect x="112" y="66" width="20" height="12" fill="#c0392b"/>` +
    `<path d="M114 78 l8 -12 M122 78 l8 -12" stroke="#fff" stroke-width="2"/></g>`,
};

// hdg: heading. obs: selected course. flag: 'TO' | 'FROM' | 'OFF'.
// deflection: degrees, + = bar right; 2° per dot, 4 SVG units per degree, clamped at ±10° (5 dots).
export function hsi({ hdg, obs, flag, deflection = 0 }, extra = '') {
  const dx = Math.max(-10, Math.min(10, deflection)) * 4;
  const dots = [-40, -32, -24, -16, -8, 8, 16, 24, 32, 40].map((x) => `<circle cx="${100 + x}" cy="100" r="2.5" fill="none" stroke="#eee"/>`).join('');
  const course =
    `<g id="course" transform="rotate(${norm(obs - hdg)} 100 100)">` +
    `<line x1="100" y1="22" x2="100" y2="58" stroke="#f2d200" stroke-width="5"/>` +
    `<path d="M100 18 l-8 14 h16 z" fill="#f2d200"/>` +
    `<line x1="100" y1="142" x2="100" y2="178" stroke="#f2d200" stroke-width="5"/>` +
    `<line id="cdi" x1="100" y1="62" x2="100" y2="138" stroke="#f2d200" stroke-width="5" transform="translate(${dx} 0)"/>` +
    dots + FLAGS[flag] + '</g>';
  const plane = `<path d="M100 92 v22 M90 100 h20 M95 112 h10" stroke="#f08a24" stroke-width="3" fill="none"/>`;
  return svg(bezel('HSI') + card('card', hdg) + course + extra + plane + lubber, 'HSI');
}
