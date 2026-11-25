import { test } from 'node:test';
import assert from 'node:assert/strict';
import { norm, sdiff, fmt, interception, interceptBand, interceptText } from '../rules.js';

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
