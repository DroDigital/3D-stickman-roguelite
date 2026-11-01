// Generic creature rigs: a point skeleton + segments/balls for rendering. Any rig can become a Verlet ragdoll.
import { PRIM } from '../gfx/renderer.js';
import { SHAPE } from '../gfx/particles.js';

export class Topology {
  /**
   * @param {number} n points
   * @param {Array<[number,number,number,number]>} segs [a, b, radius, paletteSlot]
   * @param {Array<[number,number,number,number?]>} balls [i, radius, paletteSlot, smooth]
   * @param {Array<[number,number]>} braces extra ragdoll constraints keeping the torso rigid
   * @param {number[]} severable segment indices that can be torn off on brutal kills
   */
  constructor(n, segs, balls, braces = [], severable = []) {
    this.n = n;
    this.segs = segs;
    this.balls = balls;
    this.braces = braces;
    this.severable = severable;
  }
}

const tmpC = [0, 0, 0];

function shade(c, flash, out) {
  out[0] = c[0] + (1 - c[0]) * flash;
  out[1] = c[1] + (1 - c[1]) * flash;
  out[2] = c[2] + (1 - c[2]) * flash;
  return out;
}

/** palette: array of {c:[r,g,b], e:number}. scaleR multiplies radii. */
export function drawRig(R, topo, pts, palette, flash = 0, scaleR = 1, skipSegs = null) {
  const segs = topo.segs;
  for (let s = 0; s < segs.length; s++) {
    if (skipSegs && skipSegs[s]) continue;
    const g = segs[s];
    const a = g[0] * 3, b = g[1] * 3;
    const pal = palette[g[3]];
    const c = flash > 0 ? shade(pal.c, flash, tmpC) : pal.c;
    R.seg(pts[a], pts[a + 1], pts[a + 2], pts[b], pts[b + 1], pts[b + 2], g[2] * scaleR, c, pal.e + flash);
  }
  const balls = topo.balls;
  for (let k = 0; k < balls.length; k++) {
    const bl = balls[k];
    const i = bl[0] * 3;
    const pal = palette[bl[2]];
    const c = flash > 0 ? shade(pal.c, flash, tmpC) : pal.c;
    const r = bl[1] * scaleR;
    R.trs(bl[3] ? PRIM.ORB : r < 0.12 ? PRIM.BALL : PRIM.SPHERE, pts[i], pts[i + 1], pts[i + 2], 0, 0, 0, r, r, r, c, pal.e + flash);
  }
}

// ------------------------------------------------------------------ Verlet ragdolls

class Ragdoll {
  constructor() {
    this.active = false;
    this.pts = new Float32Array(64 * 3);
    this.prev = new Float32Array(64 * 3);
    this.cons = [];
    this.skip = null;
  }
}

export class Ragdolls {
  constructor(max = 48) {
    this.list = Array.from({ length: max }, () => new Ragdoll());
    this.cursor = 0;
  }

  clear() { for (const r of this.list) r.active = false; }

  /**
   * Convert a live rig into a ragdoll.
   * vel: [vx,vy,vz] base velocity, impulse applied with falloff from impulse point index.
   */
  spawn(topo, pts, palette, opts = {}) {
    let rd = this.list.find((r) => !r.active);
    if (!rd) {
      rd = this.list[this.cursor];
      this.cursor = (this.cursor + 1) % this.list.length;
    }
    const n = topo.n;
    if (rd.pts.length < n * 3) {
      rd.pts = new Float32Array(n * 3);
      rd.prev = new Float32Array(n * 3);
    }
    rd.active = true;
    rd.topo = topo;
    rd.palette = palette;
    rd.n = n;
    rd.life = opts.life ?? 5;
    rd.maxLife = rd.life;
    rd.scaleR = opts.scaleR ?? 1;
    rd.ash = opts.ash || [0.2, 0.2, 0.2];
    rd.blood = opts.blood || [0.5, 0.02, 0.05];
    rd.bleedPts = [];
    rd.sink = 0;
    rd.radius = opts.radius ?? 0.06;
    const dt = 1 / 60;
    const v = opts.vel || [0, 0, 0];
    const imp = opts.impulse || [0, 0, 0];
    const ip = opts.impulsePoint ?? 0;
    const ix = pts[ip * 3], iy = pts[ip * 3 + 1], iz = pts[ip * 3 + 2];
    for (let i = 0; i < n; i++) {
      const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
      rd.pts[i * 3] = x; rd.pts[i * 3 + 1] = y; rd.pts[i * 3 + 2] = z;
      const d = Math.hypot(x - ix, y - iy, z - iz);
      const f = 1 / (1 + d * 1.5);
      const jitter = opts.jitter ?? 0.6;
      const vx = v[0] + imp[0] * f + (Math.random() - 0.5) * jitter;
      const vy = v[1] + imp[1] * f + (Math.random() - 0.5) * jitter;
      const vz = v[2] + imp[2] * f + (Math.random() - 0.5) * jitter;
      rd.prev[i * 3] = x - vx * dt;
      rd.prev[i * 3 + 1] = y - vy * dt;
      rd.prev[i * 3 + 2] = z - vz * dt;
    }
    rd.cons.length = 0;
    rd.skip = new Uint8Array(topo.segs.length);
    const addCon = (a, b, segIndex) => {
      const L = Math.hypot(pts[a * 3] - pts[b * 3], pts[a * 3 + 1] - pts[b * 3 + 1], pts[a * 3 + 2] - pts[b * 3 + 2]);
      rd.cons.push([a, b, Math.max(L, 0.01), segIndex]);
    };
    topo.segs.forEach((s, i) => addCon(s[0], s[1], i));
    for (const [a, b] of topo.braces) addCon(a, b, -1);
    // dismemberment
    if (opts.dismember && topo.severable.length) {
      const count = opts.dismember === true ? 1 : opts.dismember;
      for (let k = 0; k < count; k++) {
        const si = topo.severable[(Math.random() * topo.severable.length) | 0];
        const idx = rd.cons.findIndex((c) => c[3] === si);
        if (idx >= 0) {
          const c = rd.cons[idx];
          rd.cons.splice(idx, 1);
          rd.skip[si] = 1;
          // separated piece gets a kick
          const p = c[1];
          rd.prev[p * 3] -= (Math.random() - 0.5) * 0.12;
          rd.prev[p * 3 + 1] -= 0.08;
          rd.prev[p * 3 + 2] -= (Math.random() - 0.5) * 0.12;
          rd.bleedPts.push(c[0], c[1]);
        }
      }
    }
    return rd;
  }

  update(dt, ground, particles) {
    const g = 22;
    const steps = 2;
    const h = dt / steps;
    for (const rd of this.list) {
      if (!rd.active) continue;
      rd.life -= dt;
      if (rd.life <= 0) { rd.active = false; continue; }
      const P = rd.pts, Q = rd.prev, n = rd.n;
      const sinking = rd.life < 1.4;
      if (sinking) rd.sink += dt * 0.5;
      for (let s = 0; s < steps; s++) {
        for (let i = 0; i < n; i++) {
          const o = i * 3;
          const x = P[o], y = P[o + 1], z = P[o + 2];
          const vx = (x - Q[o]) * 0.995, vy = (y - Q[o + 1]) * 0.995, vz = (z - Q[o + 2]) * 0.995;
          Q[o] = x; Q[o + 1] = y; Q[o + 2] = z;
          P[o] = x + vx;
          P[o + 1] = y + vy - g * h * h;
          P[o + 2] = z + vz;
          const gy = ground(P[o], P[o + 2]) + rd.radius - rd.sink;
          if (P[o + 1] < gy) {
            P[o + 1] = gy;
            // friction: pull previous towards current horizontally
            Q[o] = P[o] - (P[o] - Q[o]) * 0.55;
            Q[o + 2] = P[o + 2] - (P[o + 2] - Q[o + 2]) * 0.55;
            Q[o + 1] = P[o + 1] + (P[o + 1] - Q[o + 1]) * 0.0 + vy * 0.25;
          }
        }
        for (let it = 0; it < 4; it++) {
          for (const c of rd.cons) {
            const a = c[0] * 3, b = c[1] * 3;
            const dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2];
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
            const k = ((d - c[2]) / d) * 0.5;
            P[a] += dx * k; P[a + 1] += dy * k; P[a + 2] += dz * k;
            P[b] -= dx * k; P[b + 1] -= dy * k; P[b + 2] -= dz * k;
          }
        }
      }
      // bleeding stumps
      if (rd.bleedPts.length && rd.life > rd.maxLife - 1.2 && Math.random() < 0.7) {
        const i = rd.bleedPts[(Math.random() * rd.bleedPts.length) | 0] * 3;
        particles.emit({
          x: P[i], y: P[i + 1], z: P[i + 2],
          vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 2, vz: (Math.random() - 0.5) * 2,
          life: 0.6, size: 0.07, color: rd.blood, grav: 14, drag: 0.5, bounce: 0.1, shape: SHAPE.CHUNK, additive: false,
        });
      }
      if (sinking && Math.random() < 0.6) {
        const i = ((Math.random() * n) | 0) * 3;
        particles.emit({
          x: P[i], y: P[i + 1], z: P[i + 2], vx: (Math.random() - 0.5) * 0.4, vy: 0.8 + Math.random(), vz: (Math.random() - 0.5) * 0.4,
          life: 1.2, size: 0.12, size1: 0.02, color: rd.ash, grav: -0.5, drag: 1, shape: SHAPE.SMOKE, additive: false, alpha: 0.7,
        });
      }
    }
  }

  draw(R) {
    for (const rd of this.list) {
      if (!rd.active) continue;
      const fade = Math.min(1, rd.life / 1.4);
      drawRig(R, rd.topo, rd.pts, rd.palette, 0, rd.scaleR * (0.4 + 0.6 * fade), rd.skip);
    }
  }
}
