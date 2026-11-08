// Pure-logic tests for the cinematic pack: the mannequin retarget, HDR decoding / SH lighting and weather tables.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Mannequin } from '../src/gfx/skinned.js';
import { decodeRGBE, shFromEquirect } from '../src/core/assets.js';
import { WEATHER } from '../src/game/weather.js';
import { LOOKS, QUALITY } from '../src/gfx/cinematic.js';
import { DIMENSIONS } from '../src/game/dimensions.js';

// a do-nothing WebGL stand-in: constants are numbers, calls are no-ops
const fakeGl = () => new Proxy({}, { get: (t, k) => (typeof k === 'string' && k === k.toUpperCase() ? 1 : () => ({})) });

function loadMannequin() {
  const meta = JSON.parse(fs.readFileSync(new URL('../assets/models/mannequin.json', import.meta.url)));
  const b = fs.readFileSync(new URL('../assets/models/mannequin.bin', import.meta.url));
  return new Mannequin(fakeGl(), { meta, bin: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) });
}

/** A skeleton (in anatomy.expandSkeleton's shape) placed exactly on the mannequin's bind pose. */
function bindSkeleton(M) {
  const B = (n) => M.bindPos(n);
  const sk = { PELVIS: B('hips'), NECK: B('neck'), LUMBAR: B('spine.001'), THORAX: B('spine.002'), CHEST: B('spine.003') };
  const hd = B('head');
  sk.HEAD = sk.NECK.map((v, i) => v + (hd[i] - v) / 0.32);
  for (const S of ['L', 'R']) {
    sk[S + 'CLAV'] = B('shoulder.' + S); sk[S + 'SH'] = B('upper_arm.' + S); sk[S + 'EL'] = B('forearm.' + S); sk[S + 'WRIST'] = B('hand.' + S);
    const h = B('hand.' + S); sk[S + 'TIP'] = [h[0] + (S === 'L' ? 0.09 : -0.09), h[1], h[2]];
    sk[S + 'HIP'] = B('thigh.' + S); sk[S + 'KN'] = B('shin.' + S);
    const f = B('foot.' + S); sk[S + 'ANKLE'] = [f[0], f[1] - M.ankleLift, f[2]]; sk[S + 'TOE'] = [f[0], f[1] - M.ankleLift, f[2] + 0.17];
  }
  Object.assign(sk, { T: [0, 1, 0], Ft: [0, 0, 1], Fh: [0, 0, 1], hUp: [0, 1, 0], hR: [-1, 0, 0] });
  return sk;
}

test('mannequin retarget reproduces the bind pose (skin matrices ~ identity)', () => {
  const M = loadMannequin();
  assert.equal(M.nJ, 53);
  M.add(bindSkeleton(M), { girth: 1, grip: 0 });
  for (let j = 0; j < M.nJ; j++) {
    let e = 0;
    for (let k = 0; k < 16; k++) e = Math.max(e, Math.abs(M.data[j * 16 + k] - (k % 5 === 0 ? 1 : 0)));
    // clavicles aim at the upper arm rather than along their own tail, so they may turn slightly
    assert.ok(e < (M.names[j].includes('shoulder') ? 0.2 : 0.06), `${M.names[j]} deviates by ${e.toFixed(3)}`);
  }
});

test('mannequin hands land on the gameplay wrists when the arm is posed', () => {
  const M = loadMannequin();
  const sk = bindSkeleton(M);
  // swing the right forearm forward and stretch the arm 10%
  sk.RWRIST = [sk.REL[0], sk.REL[1] - 0.05, sk.REL[2] + 0.3];
  sk.RTIP = [sk.RWRIST[0], sk.RWRIST[1], sk.RWRIST[2] + 0.09];
  M.beginFrame();
  M.add(sk, { girth: 1 });
  const j = M.J['hand.R'];
  // skin matrix * bind position of the hand = new hand position
  const m = M.data.subarray(j * 16, j * 16 + 16), b = M.bindPos('hand.R');
  const out = [0, 1, 2].map((r) => m[r] * b[0] + m[4 + r] * b[1] + m[8 + r] * b[2] + m[12 + r]);
  out.forEach((v, i) => assert.ok(Math.abs(v - sk.RWRIST[i]) < 1e-3));
});

test('RGBE decoding and spherical-harmonic irradiance of a constant sky', () => {
  // 8x4 map of radiance 0.5: mantissa 128, exponent 128 -> 128 * 2^(128-136) = 0.5
  const w = 8, h = 4, data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([128, 128, 128, 128], i * 4);
  const rgb = decodeRGBE({ width: w, height: h, data });
  assert.ok(Math.abs(rgb[0] - 0.5) < 1e-6);
  const sh = shFromEquirect(w, h, rgb);
  // a uniform environment has only the DC term: irradiance / pi equals the radiance
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(sh[c] - 0.5) < 0.01, `dc ${sh[c]}`);
  for (let k = 3; k < 27; k++) assert.ok(Math.abs(sh[k]) < 0.05, `band ${k} should vanish`);
});

test('every realm has a cinematic look whose weather states exist', () => {
  for (const d of DIMENSIONS) {
    const look = LOOKS[d.id];
    assert.ok(look, d.id);
    for (const s of look.weather) assert.ok(WEATHER[s], `${d.id}: ${s}`);
    for (const k of ['lift', 'gamma', 'gain', 'shadow', 'high']) assert.equal(look.grade[k].length, 3);
  }
  for (const q of Object.values(QUALITY)) assert.ok(q.scale > 0 && q.scale <= 1 && q.shadow >= 1024);
});

// ------------------------------------------------------------------ dynamic resolution
import { AdaptiveScaler } from '../src/gfx/adaptive.js';

/** Feed `secs` of frames at interval `dt`, returning the scale at the end. */
function run(s, dt, secs) { for (let t = 0; t < secs; t += dt) s.update(dt); return s.scale; }

test('dynamic resolution steps down under sustained slow frames, never below its floor', () => {
  const s = new AdaptiveScaler({ max: 1, min: 0.5 });
  run(s, 0.05, 2.9);
  assert.equal(s.scale, 1, 'warm-up leaves the scale alone');
  let low = 1;
  for (let t = 0; t < 30; t += 0.05) { s.update(0.05); low = Math.min(low, s.scale); }
  assert.equal(low, 0.5);
  assert.equal(s.scale, 0.5);
});

test('a single hitch does not change quality', () => {
  const s = new AdaptiveScaler({ max: 0.9 });
  run(s, 1 / 60, 5);
  s.update(0.4);
  run(s, 1 / 60, 3);
  assert.equal(s.scale, 0.9);
});

test('a steady 60 fps display keeps the full preset', () => {
  const s = new AdaptiveScaler({ max: 0.9 });
  assert.equal(run(s, 1 / 60, 60), 0.9);
});

test('after a slow spell the scale climbs back once the cap lapses', () => {
  const s = new AdaptiveScaler({ max: 1, min: 0.5, holdCap: 30 });
  run(s, 0.05, 6);
  const dropped = s.scale;
  assert.ok(dropped < 1);
  run(s, 1 / 60, 10);
  assert.ok(s.scale < 1, 'held below the level that was too slow');
  run(s, 1 / 60, 45);
  assert.equal(s.scale, 1);
});

test('disabled dynamic resolution pins the preset', () => {
  const s = new AdaptiveScaler({ max: 0.75, enabled: false });
  assert.equal(run(s, 0.1, 20), 0.75);
});
