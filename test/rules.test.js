import { test } from 'node:test';
import assert from 'node:assert/strict';
import { norm, sdiff, fmt, interception, interceptBand, interceptText, cdiReading } from '../rules.js';
import { holding, holdText, sectorOf } from '../rules.js';

test('angle helpers', () => {
  assert.equal(norm(-10), 350);
  assert.equal(norm(720), 0);
  assert.equal(sdiff(350, 10), 20);
  assert.equal(sdiff(10, 350), -20);
  assert.equal(sdiff(0, 180), 180);
  assert.equal(fmt(5), '005');
});

test('interception bands', () => {
  assert.equal(interceptBand(14), 'correction');
  assert.equal(interceptBand(15), '45');
  assert.equal(interceptBand(30), '45');
  assert.equal(interceptBand(31), '90/45');
  assert.equal(interceptBand(70), '90/45');
  assert.equal(interceptBand(71), 'overstation');
});

test('90/45 inbound, R-350 from R-035 (ref option: 260 / 215)', () => {
  const r = interception({ radial: 350, dir: 'inbound', pos: 35 });
  assert.equal(r.type, '90/45');
  assert.equal(r.initial, 260);
  assert.equal(r.intercept, 215);
});

test('90/45 inbound from the other side (ref option: 080 / 125)', () => {
  const r = interception({ radial: 350, dir: 'inbound', pos: 305 });
  assert.equal(r.initial, 80);
  assert.equal(r.intercept, 125);
});

test('90/45 outbound R-105 from R-150 (ref option: 015 / 060)', () => {
  const r = interception({ radial: 105, dir: 'outbound', pos: 150 });
  assert.equal(r.type, '90/45');
  assert.equal(r.initial, 15);
  assert.equal(r.intercept, 60);
});

test('45 inbound', () => {
  const r = interception({ radial: 90, dir: 'inbound', pos: 110 });
  assert.equal(r.type, '45');
  assert.equal(r.initial, 315);
  assert.equal(r.intercept, 315);
});

test('correction doubles the difference (ref: QDR 250, correction 240)', () => {
  const r = interception({ radial: 250, dir: 'outbound', pos: 255 });
  assert.equal(r.type, 'correction');
  assert.equal(r.intercept, 240);
});

test('correction at the band edge: 14° doubles to 28° (the 30° cap never binds below 15°)', () => {
  const r = interception({ radial: 0, dir: 'outbound', pos: 346 });
  assert.equal(r.type, 'correction');
  assert.equal(r.intercept, 28);
});

test('over-station: slide example 270 → QDR 195 gives 170', () => {
  // Tracking QDM 270 means you are on R-090.
  const r = interception({ radial: 195, dir: 'outbound', pos: 90 });
  assert.equal(r.type, 'overstation');
  assert.equal(r.initial, 270);
  assert.equal(r.intercept, 170);
});

test('over-station angle capped at 30', () => {
  // R-000 required, on R-080: K=260, s=-100, angle 33 → 30, track 000+30
  const r = interception({ radial: 0, dir: 'outbound', pos: 80 });
  assert.equal(r.intercept, 30);
});

test('inbound beyond 70 is out of scope', () => {
  assert.throws(() => interception({ radial: 0, dir: 'inbound', pos: 90 }));
});

test('interception text', () => {
  assert.equal(interceptText({ type: '90/45', initial: 260, intercept: 215 }), '90°/45°, initial track 260°, interception track 215°');
  assert.equal(interceptText({ type: '45', initial: 35, intercept: 35 }), '45°, initial track = interception track 035°');
});

test('holding sectors', () => {
  assert.equal(sectorOf(0), 'direct');
  assert.equal(sectorOf(69), 'direct');
  assert.equal(sectorOf(70), 'special');
  assert.equal(sectorOf(110), 'teardrop');
  assert.equal(sectorOf(180), 'parallel');
  assert.equal(sectorOf(290), 'parallel');
  assert.equal(sectorOf(291), 'direct');
});

test('special direct: slide example inbound 270 STD, track 360', () => {
  const r = holding({ inbound: 270, turn: 'std', trk: 0 });
  assert.equal(r.entry, 'special');
  assert.equal(holdText(r), 'Special direct, hold 000° for 15 s, then turn right to TRK 090°');
});

test('teardrop STD is outbound − 30, Non-STD outbound + 30', () => {
  const std = holding({ inbound: 14, turn: 'std', trk: 164 }); // d = 150
  assert.equal(std.entry, 'teardrop');
  assert.equal(std.initial, 164);
  const non = holding({ inbound: 14, turn: 'nonstd', trk: 224 }); // d = norm(14-224) = 150
  assert.equal(non.entry, 'teardrop');
  assert.equal(non.initial, 224);
});

test('parallel and direct', () => {
  const p = holding({ inbound: 0, turn: 'std', trk: 230 });
  assert.equal(p.entry, 'parallel');
  assert.equal(holdText(p), 'Parallel, initial track 180°');
  const d = holding({ inbound: 0, turn: 'nonstd', trk: 20 }); // d = 340
  assert.equal(d.entry, 'direct');
  assert.equal(holdText(d), 'Direct, turn left to TRK 180°');
});

test('±5° either zones', () => {
  assert.deepEqual(holding({ inbound: 0, turn: 'std', trk: 105 }).either, ['special', 'teardrop']);
  assert.deepEqual(holding({ inbound: 0, turn: 'std', trk: 184 }).either, ['teardrop', 'parallel']);
  assert.deepEqual(holding({ inbound: 0, turn: 'std', trk: 295 }).either, ['parallel', 'direct']);
  assert.equal(holding({ inbound: 0, turn: 'std', trk: 296 }).either, null);
  assert.equal(holding({ inbound: 0, turn: 'std', trk: 70 }).either, null); // no zone at 70
  assert.equal(holdText(holding({ inbound: 0, turn: 'std', trk: 180 })), 'Either Teardrop or Parallel');
});

test('Non-STD mirrors STD', () => {
  for (let trk = 0; trk < 360; trk += 7) {
    const a = holding({ inbound: 100, turn: 'std', trk: norm(100 + (trk - 100)) });
    const b = holding({ inbound: 100, turn: 'nonstd', trk: norm(100 - (trk - 100)) });
    assert.equal(a.entry, b.entry);
    assert.deepEqual(a.either, b.either);
  }
});

test('every result has worked steps', () => {
  assert.ok(interception({ radial: 10, dir: 'outbound', pos: 200 }).steps.length >= 4);
  assert.ok(holding({ inbound: 10, turn: 'std', trk: 10 }).steps.length >= 4);
});

test('cdiReading: FROM side, needle toward the course (positive = fly right)', () => {
  // On R-095 with OBS 090 FROM you are right (south) of R-090 outbound → fly left → needle left.
  assert.deepEqual(cdiReading(90, 95), { flag: 'FROM', deflection: -5 });
  assert.deepEqual(cdiReading(90, 85), { flag: 'FROM', deflection: 5 });
  assert.deepEqual(cdiReading(0, 0), { flag: 'FROM', deflection: 0 });
  assert.deepEqual(cdiReading(355, 5), { flag: 'FROM', deflection: -10 });
});

test('cdiReading: TO side', () => {
  // On R-095 with OBS 270 TO: QDM 275, course R-090 inbound is to your right → needle right.
  assert.deepEqual(cdiReading(270, 95), { flag: 'TO', deflection: 5 });
  assert.deepEqual(cdiReading(270, 85), { flag: 'TO', deflection: -5 });
  assert.deepEqual(cdiReading(180, 0), { flag: 'TO', deflection: 0 });
});

test('cdiReading: OFF within ±1° of abeam, readable again just outside', () => {
  for (const P of [89, 90, 91, 269, 270, 271]) assert.equal(cdiReading(0, P).flag, 'OFF');
  assert.deepEqual(cdiReading(0, 88), { flag: 'FROM', deflection: -88 });
  assert.deepEqual(cdiReading(0, 92), { flag: 'TO', deflection: -88 });
});

test('cdiReading reads back to your radial whenever on scale', () => {
  for (let obs = 0; obs < 360; obs += 7) for (let off = -10; off <= 10; off++) for (const P of [norm(obs + off), norm(obs + 180 + off)]) {
    const { flag, deflection } = cdiReading(obs, P);
    assert.notEqual(flag, 'OFF');
    assert.equal(flag === 'FROM' ? norm(obs - deflection) : norm(obs + 180 + deflection), P);
  }
});
