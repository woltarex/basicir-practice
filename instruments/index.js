import { instrumentState } from '../generator.js';
import { rmi } from './rmi.js';
import { hsi } from './hsi.js';
import { dicdi } from './dicdi.js';

export function renderInstrument(s) {
  if (s.display === 'numbers') return '';
  return { rmi, hsi, dicdi }[s.display](instrumentState(s));
}
