import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, makeScenario, instrumentState } from '../generator.js';
import { renderInstrument } from '../instruments/index.js';
import { norm } from '../rules.js';

// Read the rotation angle of the element with the given id back out of the SVG.
function rot(svg, id) {
  const m = svg.match(new RegExp(`id="${id}" transform="rotate\\((-?\\d+) 100 100\\)"`));
  assert.ok(m, `no rotation for #${id}`);
  return Number(m[1]);
}
const flagOf = (svg) => svg.match(/data-flag="(TO|FROM)"/)[1];

function scenarios(display, n = 500) {
  const rng = mulberry32(11);
  return Array.from({ length: n }, (_, i) =>
    makeScenario(rng, { types: ['intercept', 'hold'], display: 'instruments', instruments: [display] }, String(i)));
}

test('RMI: card shows heading at top, needle head points to QDM', () => {
  for (const s of scenarios('rmi')) {
    const svg = renderInstrument(s);
    const st = instrumentState(s);
    const hdgAtTop = norm(-rot(svg, 'card'));
    assert.equal(hdgAtTop, s.hdg);
    assert.equal(norm(hdgAtTop + rot(svg, 'needle')), st.qdm); // needle angle is relative to the top
    assert.equal(norm(st.qdm + 180), st.P); // tail = your radial
  }
});

test('HSI: course pointer at OBS, flag consistent with your radial', () => {
  for (const s of scenarios('hsi')) {
    const svg = renderInstrument(s);
    const st = instrumentState(s);
    const hdg = norm(-rot(svg, 'card'));
    const obs = norm(hdg + rot(svg, 'course'));
    const flag = flagOf(svg);
    assert.equal(hdg, s.hdg);
    // Reading back: FROM → radial = OBS, TO → radial = OBS + 180
    assert.equal(flag === 'FROM' ? obs : norm(obs + 180), st.P);
  }
});

test('DI+CDI: DI shows heading, CDI card has OBS at top, flag consistent', () => {
  for (const s of scenarios('dicdi')) {
    const svg = renderInstrument(s);
    const st = instrumentState(s);
    assert.equal(norm(-rot(svg, 'card')), s.hdg);
    const obs = norm(-rot(svg, 'obs'));
    assert.equal(flagOf(svg) === 'FROM' ? obs : norm(obs + 180), st.P);
  }
});

test('numbers mode renders nothing', () => {
  assert.equal(renderInstrument({ display: 'numbers' }), '');
});
