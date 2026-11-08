// Pure-logic tests for the voxel fog grid and horizon AO: slice mapping, grid sizing, jitter, the quality presets
// and a static check of the shader sources (every template token resolved, GLSL ES 3.00 header).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../src/gfx/volumetric.js';
import { QUALITY } from '../src/gfx/cinematic.js';

test('slice depth runs from the near plane to the far plane, exponentially', () => {
  assert.ok(Math.abs(V.sliceDepth(0) - V.FROXEL_NEAR) < 1e-9);
  assert.ok(Math.abs(V.sliceDepth(1) - V.FROXEL_FAR) / V.FROXEL_FAR < 1e-9);
  // equal ratios per unit of slice coordinate: the midpoint is the geometric mean
  const mid = V.sliceDepth(0.5);
  assert.ok(Math.abs(mid * mid - V.FROXEL_NEAR * V.FROXEL_FAR) / (V.FROXEL_NEAR * V.FROXEL_FAR) < 1e-9);
});

test('slice coordinate inverts slice depth and is monotonic', () => {
  let prev = -1;
  for (let i = 0; i <= 50; i++) {
    const u = i / 50;
    assert.ok(Math.abs(V.sliceCoord(V.sliceDepth(u)) - u) < 1e-9, `u=${u}`);
    assert.ok(V.sliceCoord(V.sliceDepth(u)) > prev || i === 0);
    prev = V.sliceCoord(V.sliceDepth(u));
  }
  // depths in front of the grid clamp to its first slice instead of going negative
  assert.equal(V.sliceCoord(0.01), 0);
});

test('grid width follows the aspect ratio, never below 8 cells', () => {
  assert.equal(V.gridWidth(90, 16 / 9), 160);
  assert.equal(V.gridWidth(45, 4 / 3), 60);
  assert.equal(V.gridWidth(45, 0.1), 8);
});

test('per-frame jitter stays in [0, 1) and changes from frame to frame', () => {
  const seen = new Set();
  for (let f = 0; f < 200; f++) {
    const j = V.frameJitter(f);
    assert.ok(j >= 0 && j < 1, `frame ${f}: ${j}`);
    seen.add(j.toFixed(6));
  }
  assert.equal(seen.size, 200);
});

test('quality presets scale the fog grid, the march and the AO budget together', () => {
  const order = ['low', 'medium', 'high', 'ultra'];
  let prevCells = 0;
  for (const name of order) {
    const q = QUALITY[name];
    const [gy, gz] = q.grid;
    assert.ok(gy >= 8 && gz >= 8, name);
    const cells = gy * gz;
    assert.ok(cells > prevCells, `${name} grid must be larger than the preset below it`);
    prevCells = cells;
    assert.ok(q.fogSteps >= 8 && q.fogSteps <= 64, name);
    if (q.ao) {
      assert.ok(q.aoSlices >= 2 && q.aoSlices <= 6, `${name} slices`);
      assert.ok(q.aoSteps >= 2 && q.aoSteps <= 6, `${name} steps`);
    } else {
      assert.equal(q.aoSlices, 0, `${name} has AO off`);
    }
  }
  assert.equal(QUALITY.low.ao, false);
  assert.ok(QUALITY.high.ao && QUALITY.ultra.ao);
});

test('every shader source resolves its template tokens and starts with the GLSL ES 3.00 header', () => {
  const sources = { inject: V.FROXEL_INJECT_FS, march: V.FROXEL_MARCH_FS, gtao: V.GTAO_FS, aoTemporal: V.AO_TEMPORAL_FS };
  for (const [name, src] of Object.entries(sources)) {
    assert.equal(src.split('\n')[0], '#version 300 es', name);
    assert.equal(src.match(/\$\{[^}]*\}/g), null, `${name} has an unresolved template token`);
    assert.ok(/void main\(\)\s*\{/.test(src), `${name} has main`);
    // a single output per pass, written by name (the fog march and the AO passes each write one target)
    assert.ok(/out vec4 o_/.test(src), `${name} declares an output`);
  }
});

test('the shaders use no GLSL ES 3.00 reserved words as identifiers (a compile error would drop the whole pipeline)', () => {
  const RESERVED = ['common', 'partition', 'active', 'asm', 'class', 'union', 'enum', 'typedef', 'template', 'this', 'resource',
    'goto', 'inline', 'noinline', 'public', 'static', 'extern', 'external', 'interface', 'long', 'short', 'half', 'fixed',
    'unsigned', 'superp', 'input', 'output', 'sizeof', 'cast', 'namespace', 'using', 'patch', 'sample', 'filter'];
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const sources = { inject: V.FROXEL_INJECT_FS, march: V.FROXEL_MARCH_FS, gtao: V.GTAO_FS, aoTemporal: V.AO_TEMPORAL_FS };
  for (const [name, src] of Object.entries(sources)) {
    const code = strip(src);
    for (const w of RESERVED) assert.ok(!new RegExp(`\\b${w}\\b`).test(code), `${name} uses the reserved word '${w}'`);
  }
});
