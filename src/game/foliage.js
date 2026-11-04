// Dense stylised foliage, streamed around the player in 4 m cells. Tufts are generated deterministically per cell
// (meadow patches from noise, never on steep slopes or inside props) and drawn as one instanced batch whose vertex
// shader bends every blade away from the player, the player's recent footsteps, nearby enemies and blasts.
import { Noise2D } from '../core/noise.js';
import { TAU, clamp } from '../core/math.js';

const CELL = 4;
const RADIUS = 36;
const FLOATS = 12;

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
    this.data = new Float32Array(16384 * FLOATS);
    this.count = 0;
    this.dirty = false;
  }

  /** 0..1 meadow density at a point (also used for rustle effects). */
  density(x, z) {
    const n = this.noise.fbm(x * 0.035, z * 0.035, 2) * 0.5 + 0.5;
    const d = clamp((n - 0.32) / 0.4, 0, 1) * this.cfg.density;
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
    const n = Math.round(dens * cfg.perCell * (0.6 + rnd() * 0.8));
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

  get radius() { return RADIUS; }
}
