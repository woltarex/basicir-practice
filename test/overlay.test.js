import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, makeScenario, buildQuestion, solve } from '../generator.js';
import { renderInstrument } from '../instruments/index.js';
import { overlay, sectorDiagram } from '../instruments/overlay.js';
import { norm } from '../rules.js';

// data-bearing of the overlay element with the given data-role (null if absent).
function bearing(svg, role) {
  const m = svg.match(new RegExp(`data-role="${role}" data-bearing="(\\d+)"`));
  return m ? Number(m[1]) : null;
}
const overlayRot = (svg) => Number(svg.match(/id="overlay" transform="rotate\((\d+) 100 100\)"/)[1]);

const ic = (over) => ({ id: 't', kind: 'intercept', display: 'numbers', flag: 'TO', dir: 'inbound', phrasing: 'radial', dist: 8, hdg: 0, gs: 100, ...over });
const hd = (over) => ({ id: 't', kind: 'hold', display: 'numbers', flag: 'TO', nav: 'VOR', ...over });

test('interception overlay: required radial, your radial, initial and interception tracks', () => {
  // Inbound R-350 from R-035: 90/45, initial 260, intercept 215.
  const s = ic({ radial: 350, pos: 35 });
  const { svg, legend } = overlay(s, solve(s), 0);
  assert.equal(bearing(svg, 'required'), 350);
  assert.equal(bearing(svg, 'you'), 35);
  assert.equal(bearing(svg, 'initial'), 260);
  assert.equal(bearing(svg, 'intercept'), 215);
  assert.equal(legend.length, 4);
  assert.ok(legend.every((l) => l.color && l.text));
});

test('45° and correction overlays draw a single track line', () => {
  for (const s of [ic({ radial: 90, pos: 110 }), ic({ radial: 250, dir: 'outbound', pos: 255 })]) {
    const { svg } = overlay(s, solve(s), 0);
    assert.equal(bearing(svg, 'initial'), null);
    assert.equal(bearing(svg, 'intercept'), solve(s).intercept);
  }
});

test('over-station overlay: track to the station, then the interception track', () => {
  const s = ic({ radial: 195, dir: 'outbound', pos: 90 });
  const { svg } = overlay(s, solve(s), 0);
  assert.equal(bearing(svg, 'tostation'), 270);
  assert.equal(bearing(svg, 'intercept'), 170);
});

test('holding overlay: racetrack on the outbound side, boundaries, arrival and entry', () => {
  // STD, inbound 000, track to fix 150 → d = 150 → teardrop 150.
  const s = hd({ inbound: 0, turn: 'std', trk: 150, hdg: 150 });
  const { svg, legend } = overlay(s, solve(s), 0);
  assert.equal(bearing(svg, 'racetrack'), 180);
  assert.match(svg, /data-role="racetrack" data-bearing="180" data-turn="std"/);
  // Aircraft arrives from the reciprocal of its track.
  assert.equal(bearing(svg, 'arrival'), 330);
  assert.equal(bearing(svg, 'entry'), 150);
  // Boundaries at d = 70, 110, 180, 290 seen from where the aircraft comes from: I + d + 180 (STD).
  const b = [...svg.matchAll(/data-role="boundary" data-bearing="(\d+)"/g)].map((m) => Number(m[1])).sort((x, y) => x - y);
  assert.deepEqual(b, [0, 110, 250, 290]);
  assert.ok(legend.length >= 3);
});

test('Non-STD holding mirrors the boundaries and racetrack side', () => {
  const s = hd({ inbound: 0, turn: 'nonstd', trk: 210, hdg: 210 }); // d = 150 → teardrop 210
  const { svg } = overlay(s, solve(s), 0);
  assert.match(svg, /data-role="racetrack" data-bearing="180" data-turn="nonstd"/);
  assert.equal(bearing(svg, 'entry'), 210);
  const b = [...svg.matchAll(/data-role="boundary" data-bearing="(\d+)"/g)].map((m) => Number(m[1])).sort((x, y) => x - y);
  assert.deepEqual(b, [0, 70, 110, 250]);
});

test('special direct draws the 15 s leg on the track to the fix, then the outbound', () => {
  const s = hd({ inbound: 270, turn: 'std', trk: 0, hdg: 0 });
  const { svg } = overlay(s, solve(s), 0);
  assert.equal(bearing(svg, 'entry'), 0);
  assert.equal(bearing(svg, 'outbound'), 90);
});

test('either-zone holding draws no single entry line', () => {
  const s = hd({ inbound: 0, turn: 'std', trk: 180, hdg: 180 });
  const { svg, legend } = overlay(s, solve(s), 0);
  assert.equal(bearing(svg, 'entry'), null);
  assert.ok(legend.some((l) => /±5°/.test(l.text)));
});

test('overlay rotates with the card it is drawn on', () => {
  const rng = mulberry32(21);
  for (let i = 0; i < 300; i++) {
    const s = makeScenario(rng, { types: ['intercept', 'hold'], display: 'mixed', instruments: ['rmi', 'hsi', 'dicdi'] }, String(i));
    const q = buildQuestion(s, rng);
    const svg = renderInstrument(s, q.result);
    const cards = [...svg.matchAll(/id="(card|obs)" transform="rotate\((\d+) 100 100\)"/g)];
    // The overlay goes on the last card drawn: the CDI's OBS card for DI+CDI, otherwise the only card.
    const up = Number(cards.at(-1)[2]);
    assert.equal(overlayRot(svg), up, `display ${s.display}`);
    if (s.display === 'numbers') assert.equal(up, 0); // plain north-up rose
  }
});

test('without a result nothing extra is drawn', () => {
  const s = ic({ radial: 350, pos: 35, display: 'rmi' });
  assert.ok(!renderInstrument(s).includes('id="overlay"'));
  assert.equal(renderInstrument({ ...s, display: 'numbers' }), '');
});

test('buildQuestion exposes the rule result for the overlay', () => {
  const q = buildQuestion(ic({ radial: 350, pos: 35 }), mulberry32(1));
  assert.equal(q.result.type, '90/45');
  assert.equal(norm(q.result.initial), 260);
});

test('northUp: an instrument question with a result gets the north-up SOLUTION rose', () => {
  const s = ic({ radial: 350, pos: 35, display: 'rmi', hdg: 120 });
  const svg = renderInstrument(s, solve(s), { northUp: true });
  assert.match(svg, /SOLUTION/);
  assert.equal(overlayRot(svg), 0);
  assert.match(svg, /id="card" transform="rotate\(0 100 100\)"/);
  assert.ok(!svg.includes('id="needle"'));
  // Without a result northUp has nothing to draw, so the question's instrument comes back.
  assert.ok(renderInstrument(s, null, { northUp: true }).includes('id="needle"'));
});

const tags = (svg, role) => [...svg.matchAll(new RegExp(`<[a-z]+ data-role="${role}"[^>]*>`, 'g'))].map((m) => m[0]);
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))[1];
const sectorBearings = (svg) => Object.fromEntries(tags(svg, 'sector').map((t) => [attr(t, 'data-label'), Number(attr(t, 'data-bearing'))]));

test('holding overlay shades and labels the four sectors, upright on a rotated card', () => {
  const s = hd({ inbound: 0, turn: 'std', trk: 150, hdg: 150 });
  const { svg } = overlay(s, solve(s), 40);
  for (const up of [-30, 725]) {
    for (const l of tags(overlay(s, solve(s), up).svg, 'sector')) {
      assert.equal(attr(l, 'transform'), `rotate(${norm(up)} ${attr(l, 'x')} ${attr(l, 'y')})`);
    }
  }
  // Label d = 25 (DIR, clear of the racetrack), 90, 145, 235, seen from where the aircraft comes from (I + d + 180).
  assert.deepEqual(sectorBearings(svg), { DIR: 205, SPEC: 270, TD: 325, PAR: 55 });
  for (const t of tags(svg, 'sector')) {
    assert.equal(attr(t, 'transform'), `rotate(40 ${attr(t, 'x')} ${attr(t, 'y')})`);
  }
  const wedges = tags(svg, 'wedge');
  assert.equal(wedges.length, 4);
  assert.ok(wedges.every((w) => attr(w, 'fill-opacity') === '0.08'));
  for (const l of tags(svg, 'sector')) {
    assert.ok(Math.abs(Math.hypot(Number(attr(l, 'x')) - 100, Number(attr(l, 'y')) - 100) - 44) < 0.2);
  }
});

test('Non-STD sector labels mirror the STD ones', () => {
  const s = hd({ inbound: 0, turn: 'nonstd', trk: 210, hdg: 210 });
  assert.deepEqual(sectorBearings(overlay(s, solve(s), 0).svg), { DIR: 155, SPEC: 90, TD: 35, PAR: 305 });
});

test('sectorDiagram draws a labelled north-up sector chart for each turn direction', () => {
  for (const turn of ['std', 'nonstd']) {
    const svg = sectorDiagram(turn);
    assert.match(svg, /^<svg/);
    assert.equal(tags(svg, 'sector').length, 4);
    assert.match(svg, new RegExp(`data-role="racetrack"[^>]*data-turn="${turn}"`));
  }
});

test('wedge arcs run from boundary to boundary in the right direction', () => {
  const bearingOf = (x, y) => norm(Math.round((Math.atan2(x - 100, 100 - y) * 180) / Math.PI));
  const ranges = { DIR: [290, 430], SPEC: [70, 110], TD: [110, 180], PAR: [180, 290] };
  for (const turn of ['std', 'nonstd']) {
    const s = hd({ inbound: 0, turn, trk: 150, hdg: 150 });
    const from = (d) => norm(turn === 'std' ? d + 180 : -d + 180);
    for (const w of tags(overlay(s, solve(s), 0).svg, 'wedge')) {
      const m = attr(w, 'd').match(/^M100 100 L([\d.]+) ([\d.]+) A86 86 0 (\d) (\d) ([\d.]+) ([\d.]+) Z$/);
      assert.ok(m, attr(w, 'd'));
      const [lo, hi] = ranges[attr(w, 'data-label')];
      assert.equal(bearingOf(m[1], m[2]), from(lo));
      assert.equal(bearingOf(m[5], m[6]), from(hi));
      assert.equal(m[3], '0');
      assert.equal(m[4], turn === 'std' ? '1' : '0');
    }
  }
});

test('sectorDiagram does not reuse the live instrument ids', () => {
  for (const turn of ['std', 'nonstd']) {
    const svg = sectorDiagram(turn);
    assert.ok(!svg.includes('id="card"') && !svg.includes('id="overlay"'));
  }
});
