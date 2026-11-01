import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RNG, hashSeed } from '../src/core/rng.js';
import { writeTRS, writeSegment, angleDiff, rotYXZ } from '../src/core/math.js';
import { SpatialHash } from '../src/core/spatial.js';
import { Noise2D } from '../src/core/noise.js';

test('RNG is deterministic per seed', () => {
  const a = new RNG(42), b = new RNG(42), c = new RNG(43);
  const sa = Array.from({ length: 20 }, () => a.next());
  const sb = Array.from({ length: 20 }, () => b.next());
  const sc = Array.from({ length: 20 }, () => c.next());
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  for (const v of sa) assert.ok(v >= 0 && v < 1);
  assert.equal(hashSeed('abyss'), hashSeed('abyss'));
});

test('RNG.weighted respects weights', () => {
  const r = new RNG(7);
  const counts = { a: 0, b: 0 };
  for (let i = 0; i < 20000; i++) counts[r.weighted([{ k: 'a', weight: 9 }, { k: 'b', weight: 1 }]).k]++;
  const ratio = counts.a / counts.b;
  assert.ok(ratio > 7 && ratio < 11, `ratio ${ratio}`);
});

test('writeTRS produces orthogonal, correctly scaled axes', () => {
  const m = new Float32Array(16);
  writeTRS(m, 0, 1, 2, 3, 0.7, -0.4, 1.1, 2, 3, 4);
  const col = (i) => [m[i * 4], m[i * 4 + 1], m[i * 4 + 2]];
  const len = (v) => Math.hypot(...v);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  assert.ok(Math.abs(len(col(0)) - 2) < 1e-5);
  assert.ok(Math.abs(len(col(1)) - 3) < 1e-5);
  assert.ok(Math.abs(len(col(2)) - 4) < 1e-5);
  assert.ok(Math.abs(dot(col(0), col(1))) < 1e-4);
  assert.ok(Math.abs(dot(col(1), col(2))) < 1e-4);
  assert.deepEqual([m[12], m[13], m[14]], [1, 2, 3]);
  // matches rotYXZ for the unit Y axis
  const out = [0, 0, 0];
  rotYXZ(out, 0, 0, 1, 0, 0.7, -0.4, 1.1);
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(out[k] * 3 - m[4 + k]) < 1e-5);
});

test('writeSegment maps the unit cylinder onto a->b', () => {
  const m = new Float32Array(16);
  writeSegment(m, 0, 1, 1, 1, 4, 5, 1, 0.5);
  const apply = (x, y, z) => [0, 1, 2].map((k) => m[k] * x + m[4 + k] * y + m[8 + k] * z + m[12 + k]);
  const a = apply(0, 0, 0), b = apply(0, 1, 0), r = apply(1, 0, 0);
  assert.deepEqual(a.map((v) => +v.toFixed(5)), [1, 1, 1]);
  assert.deepEqual(b.map((v) => +v.toFixed(5)), [4, 5, 1]);
  assert.ok(Math.abs(Math.hypot(r[0] - 1, r[1] - 1, r[2] - 1) - 0.5) < 1e-5);
});

test('angleDiff wraps to [-PI, PI]', () => {
  assert.ok(Math.abs(angleDiff(0.1, 2 * Math.PI - 0.1) + 0.2) < 1e-9);
  assert.ok(Math.abs(angleDiff(3, -3) - (2 * Math.PI - 6)) < 1e-9);
});

test('SpatialHash finds neighbours across cells', () => {
  const h = new SpatialHash(4);
  const items = [];
  for (let i = 0; i < 200; i++) {
    const it = { x: (i % 20) * 3 - 30, z: Math.floor(i / 20) * 3 - 15 };
    items.push(it);
    h.insert(it, it.x, it.z);
  }
  const found = new Set();
  h.query(0, 0, 5, (o) => { if (Math.hypot(o.x, o.z) < 5) found.add(o); });
  const brute = items.filter((o) => Math.hypot(o.x, o.z) < 5);
  assert.equal(found.size, brute.length);
});

test('Noise is bounded and seeded', () => {
  const n = new Noise2D(5), m = new Noise2D(5);
  for (let i = 0; i < 500; i++) {
    const x = i * 0.37, y = i * 0.11;
    const v = n.fbm(x, y);
    assert.ok(v > -1.5 && v < 1.5);
    assert.equal(v, m.fbm(x, y));
  }
});
