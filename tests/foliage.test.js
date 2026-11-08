// Foliage density: the graphics preset multiplies the tuft count inside the streaming radius, the instance budget
// holds at the densest setting, and the meadow map carries density and ground height for the ground mist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Foliage, MAX_TUFTS, MEADOW_N, MEADOW_STEP } from '../src/game/foliage.js';

const flat = {
  mode: 'open', playRadius: 80,
  normalY: () => 1, isClear: () => true,
  height: (x) => 0.1 * x,
  // the cells only need these to be deterministic
};
const cfg = { kind: 'grass', density: 1, perCell: 30, h: [0.45, 1.05], w: 1, stiff: 1, emis: 0, colors: [[0.5, 0.4, 0.3], [0.6, 0.5, 0.4]] };

test('the density multiplier scales the tuft count roughly in proportion', () => {
  const f = new Foliage(flat, cfg, 7);
  f.update(0, 0);
  const base = f.count;
  assert.ok(base > 1000, `base count ${base}`);
  f.setScale(3);
  f.update(0, 0);
  const tripled = f.count;
  const ratio = tripled / base;
  assert.ok(ratio > 2.4 && ratio < 3.6, `ratio ${ratio}`);
});

test('setScale with the same value changes nothing', () => {
  const f = new Foliage(flat, cfg, 7);
  f.update(0, 0);
  assert.equal(f.setScale(1), false);
  assert.equal(f.setScale(2), true);
});

test('the instance budget holds at the densest setting', () => {
  const f = new Foliage(flat, cfg, 7);
  f.setScale(20);
  f.update(0, 0);
  assert.ok(f.count > 0);
  assert.ok(f.count <= MAX_TUFTS, `count ${f.count} over ${MAX_TUFTS}`);
  // the densest preset should reach far past the old 16k-tuft limit before the budget takes over
  assert.equal(MAX_TUFTS, 65536);
});

test('the meadow map stores density in 0..1 and the ground height at every cell', () => {
  const f = new Foliage(flat, cfg, 11);
  const map = f.sampleMap(10, -4);
  assert.equal(map.length, MEADOW_N * MEADOW_N * 2);
  const half = (MEADOW_N * MEADOW_STEP) / 2;
  let maxDensity = 0;
  for (let j = 0; j < MEADOW_N; j += 7) for (let i = 0; i < MEADOW_N; i += 7) {
    const o = (j * MEADOW_N + i) * 2;
    const x = 10 - half + (i + 0.5) * MEADOW_STEP, z = -4 - half + (j + 0.5) * MEADOW_STEP;
    assert.ok(map[o] >= 0 && map[o] <= 1, `density ${map[o]}`);
    // the map is stored as float32, so compare at that precision
    assert.ok(Math.abs(map[o + 1] - flat.height(x)) < 1e-5, 'ground height');
    maxDensity = Math.max(maxDensity, map[o]);
  }
  assert.ok(maxDensity > 0.3, 'some cells grow grass');
});

test('the meadow map is rebuilt only after the player has moved', () => {
  const f = new Foliage(flat, cfg, 11);
  assert.equal(f.mapDue(0, 0), true);
  assert.equal(f.mapDue(1, 1), false);
  assert.equal(f.mapDue(7, 0), true);
  assert.equal(f.mapDue(7, 0), false);
});
