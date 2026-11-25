import { norm } from '../rules.js';
import { card, bezel, lubber, svg } from './card.js';

// hdg: heading. obs: selected course. flag: 'TO' | 'FROM'. Deviation bar is always centred.
export function hsi({ hdg, obs, flag }) {
  const dots = [-40, -32, -24, -16, -8, 8, 16, 24, 32, 40].map((x) => `<circle cx="${100 + x}" cy="100" r="2.5" fill="none" stroke="#eee"/>`).join('');
  const tri = flag === 'TO'
    ? `<path id="flag" data-flag="TO" d="M100 66 l-8 12 h16 z" fill="#fff"/>`
    : `<path id="flag" data-flag="FROM" d="M100 134 l-8 -12 h16 z" fill="#fff"/>`;
  const course =
    `<g id="course" transform="rotate(${norm(obs - hdg)} 100 100)">` +
    `<line x1="100" y1="22" x2="100" y2="58" stroke="#f2d200" stroke-width="5"/>` +
    `<path d="M100 18 l-8 14 h16 z" fill="#f2d200"/>` +
    `<line x1="100" y1="142" x2="100" y2="178" stroke="#f2d200" stroke-width="5"/>` +
    `<line id="cdi" x1="100" y1="62" x2="100" y2="138" stroke="#f2d200" stroke-width="5"/>` +
    dots + tri + '</g>';
  const plane = `<path d="M100 92 v22 M90 100 h20 M95 112 h10" stroke="#f08a24" stroke-width="3" fill="none"/>`;
  return svg(bezel('HSI') + card('card', hdg) + course + plane + lubber, 'HSI');
}
