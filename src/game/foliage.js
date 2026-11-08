// Dense stylised foliage, streamed around the player in 4 m cells. Tufts are generated deterministically per cell
// (meadow patches from noise, never on steep slopes or inside props) and drawn as one instanced batch whose vertex
// shader bends every blade away from the player, the player's recent footsteps, nearby enemies and blasts.
import { Noise2D } from '../core/noise.js';
import { TAU, clamp } from '../core/math.js';

const CELL = 4;
const RADIUS = 36;
const FLOATS = 12;
// instance budget: enough for the densest preset inside the streaming radius
export const MAX_TUFTS = 65536;
// the meadow map the renderer uses for ground mist: MEADOW_N cells of MEADOW_STEP metres, centred on the player
export const MEADOW_N = 48;
export const MEADOW_STEP = 2;

function hash(i, j, seed) {
  let h = (i * 374761393 + j * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822519) + 0x6d2b79f5 | 0;
    h ^= h >>> 13;
    return ((h >>> 0) % 100000) / 100000;
  };
}

export class Foliage {
  constructor(world, cfg, seed) {
    this.world = world;
    this.cfg = cfg;
    this.seed = seed | 0;
    this.noise = new Noise2D(seed + 311);
    this.cells = new Map();
    this.cx = 1e9; this.cz = 1e9;
    this.data = new Float32Array(MAX_TUFTS * FLOATS);
    this.count = 0;
    this.dirty = false;
    // tuft density multiplier (the graphics preset), and the meadow map centre and buffer
    this.scale = 1;
    this.mapC = null;
    this.mapBuf = new Float32Array(MEADOW_N * MEADOW_N * 2);
  }

  /** Tuft density multiplier from the graphics preset. Changing it regrows the cells around the player. */
  setScale(s) {
    if (Math.abs(s - this.scale) < 1e-6) return false;
    this.scale = s;
    this.cells.clear();
    this.cx = 1e9; // forces a rebuild on the next update
    return true;
  }

  /** 0..1 meadow density at a point (also used for rustle effects). */
  density(x, z) {
    const n = this.noise.fbm(x * 0.035, z * 0.035, 2) * 0.5 + 0.5;
    // a wide meadow threshold: most of the ground grows grass, so the streamed area reads as one dense field
    const d = clamp((n - 0.2) / 0.45, 0, 1) * this.cfg.density;
    // the arena keeps its ritual floor clear
    if (this.world.mode === 'arena' && Math.hypot(x, z) < 34) return d * 0.25;
    return d;
  }

  _cell(i, j) {
    const key = i * 100003 + j;
    let c = this.cells.get(key);
    if (c) return c;
    const W = this.world, cfg = this.cfg;
    const rnd = hash(i, j, this.seed);
    const out = [];
    const x0 = i * CELL, z0 = j * CELL;
    const dens = this.density(x0 + CELL / 2, z0 + CELL / 2);
    // tall growths (kelp, cilia) are thinned so they never hide the hero behind them: densityMul < 1 for those kinds
    const n = Math.round(dens * cfg.perCell * this.scale * (cfg.densityMul ?? 1) * (0.6 + rnd() * 0.8));
    for (let k = 0; k < n; k++) {
      const x = x0 + rnd() * CELL, z = z0 + rnd() * CELL;
      if (Math.hypot(x, z) > W.playRadius + 8) continue;
      if (W.normalY(x, z) < 0.78) continue;
      if (!W.isClear(x, z, 0.35)) continue;
      const pick = cfg.colors[(rnd() * cfg.colors.length) | 0];
      const jit = 0.85 + rnd() * 0.3;
      const h = (cfg.h[0] + rnd() * (cfg.h[1] - cfg.h[0])) * (0.75 + dens * 0.45);
      out.push(x, W.height(x, z) - 0.03, z, h, rnd() * TAU, cfg.w * (0.8 + rnd() * 0.5), rnd() * TAU, cfg.stiff * (0.8 + rnd() * 0.4),
        pick[0] * jit, pick[1] * jit, pick[2] * jit, cfg.emis * (rnd() < 0.5 ? 1 : 0.3));
    }
    c = new Float32Array(out);
    this.cells.set(key, c);
    return c;
  }

  /** Rebuild the instance list when the player has moved far enough. Returns true when it changed. */
  update(px, pz) {
    if (Math.hypot(px - this.cx, pz - this.cz) < 3) return false;
    this.cx = px; this.cz = pz;
    const r = RADIUS + CELL;
    const i0 = Math.floor((px - r) / CELL), i1 = Math.floor((px + r) / CELL);
    const j0 = Math.floor((pz - r) / CELL), j1 = Math.floor((pz + r) / CELL);
    let o = 0;
    const cap = this.data.length;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const cxm = i * CELL + CELL / 2 - px, czm = j * CELL + CELL / 2 - pz;
        if (cxm * cxm + czm * czm > r * r) continue;
        const c = this._cell(i, j);
        if (o + c.length > cap) break;
        this.data.set(c, o);
        o += c.length;
      }
    }
    this.count = o / FLOATS;
    this.dirty = true;
    // forget far cells so long runs don't grow memory
    if (this.cells.size > 4000) this.cells.clear();
    return true;
  }

  /** True when the meadow map must be rebuilt around (px, pz). Records the new centre when it returns true. */
  mapDue(px, pz, moved = 6) {
    const c = this.mapC;
    if (c && Math.hypot(px - c[0], pz - c[1]) < moved) return false;
    this.mapC = [px, pz];
    return true;
  }

  /**
   * Meadow map around (cx, cz): per cell, R = meadow density in 0..1 and G = ground height. The renderer uses it to
   * lay ground mist over the grass and settle it into the terrain.
   */
  sampleMap(cx, cz) {
    const W = this.world, half = (MEADOW_N * MEADOW_STEP) / 2, out = this.mapBuf;
    const dmax = Math.max(1e-6, this.cfg.density);
    for (let j = 0; j < MEADOW_N; j++) for (let i = 0; i < MEADOW_N; i++) {
      const x = cx - half + (i + 0.5) * MEADOW_STEP, z = cz - half + (j + 0.5) * MEADOW_STEP;
      const o = (j * MEADOW_N + i) * 2;
      out[o] = clamp(this.density(x, z) / dmax, 0, 1);
      out[o + 1] = W.height(x, z);
    }
    return out;
  }

  get radius() { return RADIUS; }
}
