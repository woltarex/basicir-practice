import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, makeScenario, instrumentState } from '../generator.js';
import { renderInstrument } from '../instruments/index.js';
import { hsi } from '../instruments/hsi.js';
import { dicdi } from '../instruments/dicdi.js';
import { norm } from '../rules.js';

// Read the rotation angle of the element with the given id back out of the SVG.
function rot(svg, id) {
  const m = svg.match(new RegExp(`id="${id}" transform="rotate\\((-?\\d+) 100 100\\)"`));
  assert.ok(m, `no rotation for #${id}`);
  return Number(m[1]);
}
const flagOf = (svg) => svg.match(/data-flag="(TO|FROM|OFF)"/)[1];

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

const cdiDx = (svg) => Number(svg.match(/id="cdi"[^>]*transform="translate\((-?[\d.]+) 0\)"/)[1]);
function deflected(display, n = 500) {
  const rng = mulberry32(12);
  return Array.from({ length: n }, (_, i) => makeScenario(rng,
    { types: ['intercept', 'hold'], display: 'instruments', instruments: [display], cdiMode: 'deflected' }, String(i)));
}

test('deflected HSI: needle moves 4 units per degree and reads back to your radial', () => {
  for (const s of deflected('hsi')) {
    const svg = renderInstrument(s);
    const st = instrumentState(s);
    const hdg = norm(-rot(svg, 'card'));
    const obs = norm(hdg + rot(svg, 'course'));
    const dev = cdiDx(svg) / 4;
    assert.ok([2, 4, 6, 8].includes(Math.abs(dev)), `dev ${dev}`);
    assert.equal(flagOf(svg), s.flag);
    assert.equal(flagOf(svg) === 'FROM' ? norm(obs - dev) : norm(obs + 180 + dev), st.P);
  }
});

test('deflected DI+CDI: same reading on the VOR card', () => {
  for (const s of deflected('dicdi')) {
    const svg = renderInstrument(s);
    const st = instrumentState(s);
    const obs = norm(-rot(svg, 'obs'));
    const dev = cdiDx(svg) / 4;
    assert.ok([2, 4, 6, 8].includes(Math.abs(dev)));
    assert.equal(flagOf(svg) === 'FROM' ? norm(obs - dev) : norm(obs + 180 + dev), st.P);
  }
});

test('needle is centred without a cdiMode, clamped at full scale, OFF flag drawn', () => {
  for (const s of scenarios('hsi', 50)) assert.equal(cdiDx(renderInstrument(s)), 0);
  assert.equal(cdiDx(hsi({ hdg: 0, obs: 0, flag: 'FROM', deflection: 25 })), 40);
  assert.equal(cdiDx(dicdi({ hdg: 0, obs: 0, flag: 'FROM', deflection: -25 })), -40);
  assert.equal(flagOf(hsi({ hdg: 0, obs: 0, flag: 'OFF', deflection: 0 })), 'OFF');
  assert.match(dicdi({ hdg: 0, obs: 0, flag: 'OFF', deflection: 0 }), />OFF</);
});

test('DI+CDI has 5 dots per side at 2° per dot', () => {
  const svg = dicdi({ hdg: 0, obs: 0, flag: 'TO', deflection: 0 });
  const xs = [...svg.matchAll(/<circle cx="([\d.]+)" cy="100" r="2.5"/g)].map((m) => Number(m[1]) - 100);
  assert.deepEqual(xs, [-40, -32, -24, -16, -8, 8, 16, 24, 32, 40]);
});

test('DI+CDI flag sits below the dot row, inside radius 56, and is drawn before the needle', () => {
  const svg = dicdi({ hdg: 0, obs: 0, flag: 'FROM', deflection: 8 });
  const [, x, y, w, h] = svg.match(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/);
  assert.ok(Number(y) >= 106);
  assert.ok(Math.hypot(Number(x) + Number(w) - 100, Number(y) + Number(h) - 100) <= 56);
  assert.ok(svg.indexOf('data-flag') < svg.indexOf('id="cdi"'));
});
