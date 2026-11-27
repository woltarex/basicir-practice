import { instrumentState } from '../generator.js';
import { rmi } from './rmi.js';
import { hsi } from './hsi.js';
import { dicdi } from './dicdi.js';
import { card, bezel, svg } from './card.js';
import { overlay } from './overlay.js';

// Without a result: the question's instrument (nothing in numbers mode).
// With a result: the same instrument with the solution drawn on it; numbers mode — or northUp — gets a
// north-up compass rose with the solution instead.
export function renderInstrument(s, result = null, { northUp = false } = {}) {
  if (s.display === 'numbers' || (northUp && result)) {
    return result ? svg(bezel('SOLUTION') + card('card', 0) + overlay(s, result, 0).svg, 'Solution diagram') : '';
  }
  const st = instrumentState(s);
  const up = s.display === 'dicdi' ? st.obs : st.hdg; // DI+CDI: draw on the VOR card
  return { rmi, hsi, dicdi }[s.display](st, result ? overlay(s, result, up).svg : '');
}

export { overlay };
