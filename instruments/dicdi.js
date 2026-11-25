import { card, bezel, lubber, svg } from './card.js';

// Heading indicator + VOR CDI side by side. Needle always centred; OBS at the top of the CDI card.
export function dicdi({ hdg, obs, flag }) {
  const plane = `<path d="M100 70 v60 M70 98 h60 M88 124 h24" stroke="#f08a24" stroke-width="5" fill="none" stroke-linecap="round"/>`;
  const di = svg(bezel('HDG') + card('card', hdg) + plane + lubber, 'Heading indicator');
  const flagBox =
    `<rect x="124" y="84" width="34" height="18" rx="2" fill="#000" stroke="#555"/>` +
    `<text id="flag" data-flag="${flag}" x="141" y="98" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">${flag === 'TO' ? 'TO ▲' : 'FR ▼'}</text>`;
  const dots = [-40, -30, -20, -10, 10, 20, 30, 40].map((x) => `<circle cx="${100 + x}" cy="140" r="2.5" fill="#eee"/>`).join('');
  const cdi = svg(
    bezel('VOR') + card('obs', obs) + `<line id="cdi" x1="100" y1="50" x2="100" y2="150" stroke="#fff" stroke-width="4"/>` +
      dots + flagBox + `<path d="M100 18 l-6 10 h12 z" fill="#f2d200"/>`,
    'VOR CDI',
  );
  return `<div class="pair">${di}${cdi}</div>`;
}
