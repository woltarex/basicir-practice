import { norm } from '../rules.js';
import { card, bezel, lubber, svg } from './card.js';

// hdg: aircraft heading (top of card). qdm: bearing to the station (needle head).
export function rmi({ hdg, qdm, nav }) {
  const needle =
    `<g id="needle" transform="rotate(${norm(qdm - hdg)} 100 100)">` +
    `<line x1="100" y1="160" x2="100" y2="40" stroke="#f2d200" stroke-width="5"/>` +
    `<path d="M100 26 l-9 16 h18 z" fill="#f2d200"/>` +
    `<path d="M88 172 l12 -12 l12 12" fill="none" stroke="#f2d200" stroke-width="4"/>` +
    `<circle cx="100" cy="100" r="4" fill="#f2d200"/></g>`;
  return svg(bezel(`RMI · ${nav === 'NDB' ? 'ADF' : 'VOR'}`) + card('card', hdg) + needle + lubber, 'RMI');
}
