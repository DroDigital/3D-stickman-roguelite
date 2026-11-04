// Procedural world generation: terrain, static props, colliders, destructibles, loot containers, obelisks and portals.
import { Noise2D } from '../core/noise.js';
import { RNG } from '../core/rng.js';
import { SpatialHash } from '../core/spatial.js';
import { terrainMesh } from '../gfx/meshes.js';
import { Foliage } from './foliage.js';
import { PRIM } from '../gfx/renderer.js';
import { SHAPE } from '../gfx/particles.js';
import { clamp, mixRgb, TAU } from '../core/math.js';
import { WORLD_SIZE, ARENA_RADIUS } from './config.js';

const CHEST_TIERS = [
  { name: 'Reliquary', cost: 25, minTier: 0, luck: 0, color: [0.55, 0.42, 0.3], glow: [1, 0.75, 0.4], scale: 1 },
  { name: 'Ossuary Casket', cost: 70, minTier: 1, luck: 0.3, color: [0.75, 0.72, 0.65], glow: [0.5, 0.7, 1], scale: 1.2 },
  { name: 'Eldritch Coffer', cost: 160, minTier: 3, luck: 0.8, color: [0.12, 0.08, 0.16], glow: [0.4, 1, 0.85], scale: 1.45 },
];
export { CHEST_TIERS };

class Debris {
  constructor() {
    this.list = [];
  }

  spawn(o) {
    if (this.list.length > 420) this.list.shift();
    this.list.push({
      x: o.x, y: o.y, z: o.z,
      vx: o.vx ?? (Math.random() - 0.5) * 6, vy: o.vy ?? 3 + Math.random() * 5, vz: o.vz ?? (Math.random() - 0.5) * 6,
      yaw: Math.random() * TAU, pitch: Math.random() * TAU, roll: 0,
      wy: (Math.random() - 0.5) * 12, wp: (Math.random() - 0.5) * 12,
      sx: o.sx ?? 0.2, sy: o.sy ?? 0.2, sz: o.sz ?? 0.2,
      kind: o.kind ?? PRIM.BOX, c: o.c ?? [0.5, 0.5, 0.5], e: o.e ?? 0,
      life: o.life ?? 4 + Math.random() * 2, rest: false,
    });
  }

  update(dt, world) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i];
      d.life -= dt;
      if (d.life <= 0) { this.list.splice(i, 1); continue; }
      if (d.rest) continue;
      d.vy -= 20 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      d.yaw += d.wy * dt; d.pitch += d.wp * dt;
      const g = world.height(d.x, d.z) + d.sy * 0.4;
      if (d.y < g) {
        d.y = g;
        if (d.vy < -1.5) {
          d.vy = -d.vy * 0.35;
          d.vx *= 0.6; d.vz *= 0.6; d.wy *= 0.6; d.wp *= 0.5;
        } else {
          d.vy = 0; d.vx *= 0.85; d.vz *= 0.85; d.wy *= 0.8; d.wp *= 0.8;
          if (Math.abs(d.vx) + Math.abs(d.vz) < 0.15) { d.rest = true; d.pitch = Math.round(d.pitch / (Math.PI / 2)) * (Math.PI / 2); }
        }
      }
    }
  }

  draw(R) {
    for (const d of this.list) {
      const s = d.life < 1 ? d.life : 1;
      R.trs(d.kind, d.x, d.y - (1 - s) * 0.3, d.z, d.yaw, d.pitch, d.roll, d.sx * s, d.sy * s, d.sz * s, d.c, d.e);
    }
  }
}

export class World {
  /**
   * @param {object} dim dimension theme
   * @param {number} seed
   * @param {'open'|'arena'} mode
   * @param {Renderer} R
   */
  constructor(dim, seed, mode, R, depth = 0) {
    this.dim = dim;
    this.seed = seed;
    this.mode = mode;
    this.R = R;
    this.depth = depth;
    this.rng = new RNG(seed);
    this.noise = new Noise2D(seed);
    this.noise2 = new Noise2D(seed ^ 0x9e3779b9);
    this.colliders = new SpatialHash(8);
    this.colliderList = [];
    this.destructibles = [];
    this.chests = [];
    this.obelisks = [];
    this.portal = null;
    this.exitPortal = null;
    this.lights = [];
    this.animated = []; // dynamic decorative props (floating rocks, tendrils)
    this.debris = new Debris();
    this.time = 0;
    this.chestsOpened = 0;

    if (mode === 'arena') {
      this.size = ARENA_RADIUS * 3.2;
      this.n = 72;
      this.playRadius = ARENA_RADIUS - 1.5;
    } else {
      this.size = WORLD_SIZE;
      this.n = 136;
      this.playRadius = WORLD_SIZE / 2 - 18;
    }
    this._buildTerrain();
    R.clearStatic();
    if (mode === 'arena') this._populateArena();
    else this._populateOpen();
    R.uploadStatic();
    // foliage is placed after props so tufts never grow inside them
    this.foliage = new Foliage(this, dim.foliage, seed);
    if (R.setFoliageKind) {
      R.setFoliageKind(dim.foliage.kind);
      R.setFoliageInstances(null, 0);
      R.wind = dim.foliage.wind;
    }
  }

  // ------------------------------------------------------------ terrain
  rawHeight(x, z) {
    const t = this.dim.terrain;
    const d = Math.hypot(x, z);
    if (this.mode === 'arena') {
      const R0 = ARENA_RADIUS;
      let h = this.noise.fbm(x * 0.05, z * 0.05, 3) * 0.35;
      // shallow bowl rim
      h += Math.max(0, d - R0 * 0.75) * 0.06;
      if (d > R0 + 1) h -= Math.pow(d - R0 - 1, 1.4) * 1.6;
      return h;
    }
    let h = this.noise.fbm(x * t.freq, z * t.freq, 5) * t.amp;
    h += (this.noise2.ridge(x * t.freq * 1.8, z * t.freq * 1.8, 4) - 0.35) * t.ridge;
    // flatten spawn
    h *= clamp(d / 30, 0.15, 1);
    // boundary walls
    const edge = this.playRadius + 4;
    if (d > edge) h += Math.min(9, Math.pow(d - edge, 1.2) * 0.45);
    return h;
  }

  _buildTerrain() {
    const t = this.dim.terrain;
    const veinN = new Noise2D(this.seed + 77);
    const colorFn = (x, y, z, ny) => {
      const hn = clamp((y + t.amp) / (t.amp * 2.2), 0, 1);
      let c = mixRgb(t.low, t.high, hn);
      if (ny < 0.82) c = mixRgb(c, t.steep, clamp((0.82 - ny) * 4, 0, 1));
      const v = veinN.ridge(x * 0.05, z * 0.05, 2);
      if (v > 0.47) c = mixRgb(c, t.accent, clamp((v - 0.47) * 8, 0, 1) * t.veins * 2);
      const jitter = (veinN.noise(x * 0.7, z * 0.7)) * 0.06;
      if (this.mode === 'arena') {
        const d = Math.hypot(x, z);
        if (d > ARENA_RADIUS + 1) c = mixRgb(c, [0.02, 0.01, 0.03], clamp((d - ARENA_RADIUS) / 8, 0, 1));
        // ritual circle inlay
        const ring = Math.abs(d - ARENA_RADIUS * 0.55);
        if (ring < 0.8) c = mixRgb(c, t.accent, 0.7);
      }
      return [clamp(c[0] + jitter, 0, 1), clamp(c[1] + jitter, 0, 1), clamp(c[2] + jitter, 0, 1)];
    };
    const mesh = terrainMesh(this.n, this.size, (x, z) => this.rawHeight(x, z), colorFn);
    this.heights = mesh.heights;
    this.step = mesh.step;
    this.half = this.size / 2;
    // the hand-drawn styles paint the ground in soft washes instead of per-triangle facets
    this.R.setTerrain(mesh.data, terrainMesh(this.n, this.size, (x, z) => this.rawHeight(x, z), colorFn, true).data);
  }

  /** Exact height matching the rendered triangle mesh. */
  height(x, z) {
    const n = this.n, step = this.step;
    let gx = (x + this.half) / step, gz = (z + this.half) / step;
    gx = clamp(gx, 0, n - 1e-4); gz = clamp(gz, 0, n - 1e-4);
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const H = this.heights, w = n + 1;
    const h00 = H[j * w + i], h10 = H[j * w + i + 1], h01 = H[(j + 1) * w + i], h11 = H[(j + 1) * w + i + 1];
    if (fz >= fx) return h00 + (h11 - h01) * fx + (h01 - h00) * fz;
    return h00 + (h10 - h00) * fx + (h11 - h10) * fz;
  }

  normalY(x, z) {
    const e = 0.6;
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    return 2 * e / Math.hypot(hx, 2 * e, hz);
  }

  clampToBounds(p) {
    const d = Math.hypot(p.x, p.z);
    if (d > this.playRadius) {
      p.x *= this.playRadius / d;
      p.z *= this.playRadius / d;
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ props
  _addCollider(x, z, r, ref = null) {
    const c = { x, z, r, ref, alive: true };
    this.colliders.insert(c, x, z);
    this.colliderList.push(c);
    return c;
  }

  _st(kind, x, y, z, yaw, pitch, roll, sx, sy, sz, c, e = 0, list = null) {
    const h = this.R.staticTRS(kind, x, y, z, yaw, pitch, roll, sx, sy, sz, c, e);
    if (list) list.push({ h, kind, x, y, z, sx, sy, sz, yaw, c, e });
    return h;
  }

  _seg(ax, ay, az, bx, by, bz, r, c, e = 0, list = null) {
    const h = this.R.staticSeg(ax, ay, az, bx, by, bz, r, c, e);
    if (list) list.push({ h, kind: PRIM.CYL, x: (ax + bx) / 2, y: (ay + by) / 2, z: (az + bz) / 2, sx: r * 2, sy: Math.hypot(bx - ax, by - ay, bz - az), sz: r * 2, yaw: 0, c, e });
    return h;
  }

  _branch(x, y, z, dx, dy, dz, len, r, depth, c, rng, list) {
    const ex = x + dx * len, ey = y + dy * len, ez = z + dz * len;
    this._seg(x, y, z, ex, ey, ez, r, c, 0, list);
    if (depth <= 0 || r < 0.03) return;
    const kids = rng.int(2, 3);
    for (let k = 0; k < kids; k++) {
      let nx = dx + rng.range(-0.9, 0.9), ny = dy + rng.range(-0.2, 0.5), nz = dz + rng.range(-0.9, 0.9);
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      this._branch(ex, ey, ez, nx, ny, nz, len * rng.range(0.55, 0.8), r * 0.62, depth - 1, c, rng, list);
    }
  }

  _prop(type, x, z, rng) {
    const y = this.height(x, z);
    const dim = this.dim;
    const t = dim.terrain;
    switch (type) {
      case 'deadTree': {
        const s = rng.range(0.8, 1.6);
        const c = mixRgb([0.12, 0.1, 0.1], t.steep, 0.3);
        this._branch(x, y - 0.3, z, rng.range(-0.15, 0.15), 1, rng.range(-0.15, 0.15), 2.8 * s, 0.22 * s, 2, c, rng);
        this._addCollider(x, z, 0.5 * s);
        break;
      }
      case 'boneSpire': {
        const s = rng.range(0.7, 1.8);
        const c = [0.78, 0.74, 0.66];
        this._st(PRIM.CONE, x, y - 0.5, z, rng.next() * TAU, rng.range(-0.15, 0.15), rng.range(-0.15, 0.15), 0.8 * s, 6 * s, 0.8 * s, c);
        for (let i = 0; i < 3; i++) {
          const a = rng.next() * TAU;
          this._st(PRIM.CONE, x + Math.cos(a) * 0.9 * s, y - 0.2, z + Math.sin(a) * 0.9 * s, a, rng.range(0.3, 0.7), 0, 0.3 * s, 2.5 * s, 0.3 * s, c);
        }
        this._addCollider(x, z, 0.9 * s);
        break;
      }
      case 'rock': {
        const s = rng.range(0.6, 2.4);
        const c = mixRgb(t.steep, t.high, rng.range(0.1, 0.5));
        this._st(PRIM.SPHERE, x, y, z, rng.next() * TAU, rng.range(-0.3, 0.3), rng.range(-0.3, 0.3), s * rng.range(1, 1.6), s * rng.range(0.6, 1.1), s * rng.range(1, 1.5), c);
        if (s > 1) this._addCollider(x, z, s * 1.1);
        break;
      }
      case 'ruinPillar': {
        const s = rng.range(0.8, 1.3);
        const c = mixRgb([0.45, 0.42, 0.4], t.high, 0.3);
        const h = rng.range(2.5, 6) * s;
        const yaw = rng.next() * TAU;
        const tilt = rng.range(-0.12, 0.12);
        const parts = [];
        this._st(PRIM.BOX, x, y - 0.2, z, yaw, 0, 0, 1.4 * s, 0.6, 1.4 * s, c, 0, parts);
        this._st(PRIM.BOX, x, y + h / 2, z, yaw, tilt, 0, 0.9 * s, h, 0.9 * s, c, 0, parts);
        if (rng.chance(0.5)) this._st(PRIM.BOX, x, y + h + 0.2, z, yaw + 0.3, tilt, 0.1, 1.3 * s, 0.4, 1.3 * s, c, 0, parts);
        this._destructible(x, z, 0.9 * s, 60, parts, 'stone');
        break;
      }
      case 'urn': {
        const s = rng.range(0.7, 1.1);
        const c = mixRgb([0.45, 0.3, 0.22], t.accent, 0.25);
        const parts = [];
        this._st(PRIM.SPHERE, x, y + 0.45 * s, z, 0, 0, 0, 0.45 * s, 0.55 * s, 0.45 * s, c, 0, parts);
        this._st(PRIM.CYL, x, y + 0.85 * s, z, 0, 0, 0, 0.2 * s, 0.25 * s, 0.2 * s, c, 0, parts);
        this._destructible(x, z, 0.45 * s, 8, parts, 'urn');
        break;
      }
      case 'crystal': {
        const s = rng.range(0.6, 1.4);
        const col = mixRgb(t.accent, [1, 1, 1], 0.25);
        const parts = [];
        const n = rng.int(3, 5);
        for (let i = 0; i < n; i++) {
          const a = rng.next() * TAU, r = rng.range(0, 0.5) * s;
          this._st(PRIM.OCTA, x + Math.cos(a) * r, y + 0.5 * s, z + Math.sin(a) * r, rng.next() * TAU, rng.range(-0.4, 0.4), rng.range(-0.4, 0.4), 0.25 * s, rng.range(0.8, 1.8) * s, 0.25 * s, col, 0.9, parts);
        }
        this.lights.push({ x, y: y + 1.2, z, r: 7, c: col, i: 0.9, flicker: 0.2 });
        this._destructible(x, z, 0.6 * s, 25, parts, 'crystal');
        break;
      }
      case 'brazier': {
        const c = [0.2, 0.18, 0.18];
        this._st(PRIM.CYL, x, y, z, 0, 0, 0, 0.12, 1.4, 0.12, c);
        this._st(PRIM.CONE, x, y + 1.9, z, 0, Math.PI, 0, 0.45, 0.5, 0.45, c);
        const fire = mixRgb(this.dim.ambient.color, [1, 0.5, 0.1], 0.5);
        this.lights.push({ x, y: y + 2.1, z, r: 14, c: fire, i: 1.6, flicker: 0.6, fire: true });
        this._addCollider(x, z, 0.4);
        break;
      }
      case 'coral': {
        const s = rng.range(0.6, 1.5);
        const col = rng.pick([[0.9, 0.35, 0.45], [0.3, 0.8, 0.75], [0.85, 0.6, 0.3]]);
        this._branch(x, y - 0.2, z, 0, 1, 0, 1.5 * s, 0.16 * s, 2, col, rng);
        this._addCollider(x, z, 0.5 * s);
        break;
      }
      case 'tendril': {
        const s = rng.range(0.8, 1.6);
        const col = mixRgb(t.accent, [0.1, 0.05, 0.08], 0.5);
        this.animated.push({ type: 'tendril', x, y, z, s, phase: rng.next() * TAU, col, segs: rng.int(6, 9) });
        this._addCollider(x, z, 0.5 * s);
        break;
      }
      case 'monolith': {
        const s = rng.range(1, 2);
        const c = [0.06, 0.05, 0.09];
        this._st(PRIM.BOX, x, y + 3.5 * s, z, rng.next() * TAU, rng.range(-0.1, 0.1), rng.range(-0.1, 0.1), 1.2 * s, 7 * s, 0.4 * s, c, 0);
        const glow = t.accent;
        this._st(PRIM.BOX, x, y + 5 * s, z, 0, 0, 0, 0.12, 0.12, 0.12, glow, 2);
        this.lights.push({ x, y: y + 5 * s, z, r: 10, c: glow, i: 0.8, flicker: 0.1 });
        this._addCollider(x, z, 1.1 * s);
        break;
      }
      case 'floatRock': {
        const s = rng.range(0.8, 2.5);
        this.animated.push({ type: 'floatRock', x, y: y + rng.range(4, 12), z, s, phase: rng.next() * TAU, col: mixRgb(t.steep, t.high, 0.3), spin: rng.range(-0.3, 0.3) });
        break;
      }
      case 'ribcage': {
        const s = rng.range(1.2, 2.2);
        const yaw = rng.next() * TAU;
        const c = [0.85, 0.78, 0.68];
        const fx = Math.cos(yaw), fz = Math.sin(yaw);
        for (let i = -3; i <= 3; i++) {
          const cx = x + fx * i * 0.9 * s, cz = z + fz * i * 0.9 * s;
          const cy = this.height(cx, cz);
          for (const side of [-1, 1]) {
            const px = -fz * side, pz = fx * side;
            const w = 2.2 * s * (1 - Math.abs(i) / 5);
            this._seg(cx + px * w, cy - 0.3, cz + pz * w, cx + px * w * 0.9, cy + 2.2 * s, cz + pz * w * 0.9, 0.12 * s, c);
            this._seg(cx + px * w * 0.9, cy + 2.2 * s, cz + pz * w * 0.9, cx + px * 0.2, cy + 3.4 * s, cz + pz * 0.2, 0.1 * s, c);
          }
        }
        this._seg(x - fx * 3 * s, this.height(x, z) + 3.4 * s, z - fz * 3 * s, x + fx * 3 * s, this.height(x, z) + 3.4 * s, z + fz * 3 * s, 0.18 * s, c);
        break;
      }
      case 'eggSac': {
        const s = rng.range(0.6, 1.1);
        const col = mixRgb(t.accent, [1, 0.9, 0.7], 0.3);
        const parts = [];
        for (let i = 0; i < 4; i++) {
          const a = rng.next() * TAU, r = rng.range(0.2, 0.6) * s;
          const rs = rng.range(0.35, 0.6) * s;
          this._st(PRIM.ORB, x + Math.cos(a) * r, y + rs * 0.7, z + Math.sin(a) * r, 0, 0, 0, rs, rs * 1.2, rs, col, 0.5, parts);
        }
        this.lights.push({ x, y: y + 0.8, z, r: 5, c: col, i: 0.6, flicker: 0.4 });
        this._destructible(x, z, 0.7 * s, 15, parts, 'flesh');
        break;
      }
      default:
        break;
    }
  }

  _destructible(x, z, r, hp, parts, material) {
    const d = { x, z, y: this.height(x, z), r, hp, maxHp: hp, parts, material, alive: true, shake: 0 };
    d.collider = this._addCollider(x, z, r, d);
    this.destructibles.push(d);
    return d;
  }

  _scatter(type, density, minDist, rng) {
    const count = Math.floor(density * (this.size * this.size) / 900);
    for (let i = 0; i < count; i++) {
      const a = rng.next() * TAU;
      const r = Math.sqrt(rng.next()) * (this.playRadius + 10);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.hypot(x, z) < minDist) continue;
      if (this.normalY(x, z) < 0.7 && type !== 'rock') continue;
      this._prop(type, x, z, rng);
    }
  }

  /** True when no collider sits within `clearance` metres of (x, z) (measured to the collider's edge). */
  isClear(x, z, clearance) {
    let clear = true;
    this.colliders.query(x, z, clearance + 6, (c) => {
      if (clear && c.alive && Math.hypot(c.x - x, c.z - z) - c.r < clearance) clear = false;
    });
    return clear;
  }

  _farPoint(rng, minR, maxR, avoid = [], clearance = 2) {
    for (let tries = 0; tries < 200; tries++) {
      const a = rng.next() * TAU;
      const r = rng.range(minR, maxR);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!this.isClear(x, z, clearance)) continue;
      // relax slope / spacing preferences once strict sampling keeps failing
      if (tries < 80 && this.normalY(x, z) < 0.85) continue;
      if (tries < 120 && avoid.some((p) => Math.hypot(p.x - x, p.z - z) < 30)) continue;
      return { x, z };
    }
    // the spawn clearing never holds props, so it is always reachable
    return { x: rng.range(-6, 6), z: rng.range(-6, 6) };
  }

  _populateOpen() {
    const rng = this.rng;
    for (const [type, density] of Object.entries(this.dim.props)) this._scatter(type, density, 10, rng);
    // loot containers
    const nChests = 16 + Math.min(8, this.depth * 2);
    for (let i = 0; i < nChests; i++) {
      const p = this._farPoint(rng, 14, this.playRadius - 6, [], 1.8);
      const tier = rng.chance(0.08 + this.depth * 0.02) ? 2 : rng.chance(0.3) ? 1 : 0;
      this.chests.push({ x: p.x, z: p.z, y: this.height(p.x, p.z), tier, yaw: rng.next() * TAU, opened: false, openT: 0, bob: rng.next() * TAU });
    }
    // obelisk objectives
    const avoid = [];
    for (let i = 0; i < 3; i++) {
      const p = this._farPoint(rng, 40, this.playRadius - 15, avoid, 3);
      avoid.push(p);
      this.obelisks.push({ x: p.x, z: p.z, y: this.height(p.x, p.z), charge: 0, done: false, active: false, pulse: 0 });
    }
    this.portalSpot = this._farPoint(rng, 55, this.playRadius - 12, avoid, 4);
  }

  _populateArena() {
    const rng = this.rng;
    const t = this.dim.terrain;
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const r = ARENA_RADIUS + 0.5;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = this.height(x, z);
      const h = rng.range(5, 10);
      const c = mixRgb([0.12, 0.1, 0.14], t.steep, 0.5);
      this._st(PRIM.BOX, x, y + h / 2 - 1, z, -a, rng.range(-0.08, 0.08), rng.range(-0.08, 0.08), 1.4, h, 1.4, c);
      this._st(PRIM.OCTA, x, y + h + 0.6, z, a, 0, 0, 0.35, 0.7, 0.35, t.accent, 2);
      if (i % 3 === 0) this.lights.push({ x, y: y + h + 0.6, z, r: 16, c: t.accent, i: 1.2, flicker: 0.15 });
    }
    // floating debris around the void
    for (let i = 0; i < 18; i++) {
      const a = rng.next() * TAU, r = rng.range(ARENA_RADIUS + 8, ARENA_RADIUS + 40);
      this.animated.push({ type: 'floatRock', x: Math.cos(a) * r, y: rng.range(-12, 10), z: Math.sin(a) * r, s: rng.range(1, 4), phase: rng.next() * TAU, col: mixRgb(t.steep, t.high, 0.3), spin: rng.range(-0.3, 0.3) });
    }
  }

  // ------------------------------------------------------------ runtime
  /** Push a circle out of static colliders. */
  resolve(p, radius) {
    this.colliders.query(p.x, p.z, radius + 3, (c) => {
      if (!c.alive) return;
      const dx = p.x - c.x, dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      const m = c.r + radius;
      if (d < m && d > 1e-4) {
        p.x = c.x + (dx / d) * m;
        p.z = c.z + (dz / d) * m;
      }
    });
  }

  /** Damage destructibles in a radius/arc; returns number broken. */
  hitDestructibles(x, z, r, dmg, game, dirX = 0, dirZ = 0, arcCos = -2) {
    let broken = 0;
    for (const d of this.destructibles) {
      if (!d.alive) continue;
      const dx = d.x - x, dz = d.z - z;
      const dist = Math.hypot(dx, dz);
      if (dist > r + d.r) continue;
      if (arcCos > -1 && dist > 0.5 && (dx * dirX + dz * dirZ) / dist < arcCos) continue;
      d.hp -= dmg;
      d.shake = 0.25;
      game.particles.burst(d.x, d.y + 0.8, d.z, 6, { speed: 4, color: this._matColor(d), shape: SHAPE.CHUNK, size: 0.08, life: 0.6, grav: 14, bounce: 0.3, additive: false });
      if (d.hp <= 0) {
        this.breakDestructible(d, game, dirX, dirZ);
        broken++;
      }
    }
    return broken;
  }

  _matColor(d) {
    return d.parts.length ? d.parts[0].c : [0.5, 0.5, 0.5];
  }

  breakDestructible(d, game, dirX = 0, dirZ = 0) {
    d.alive = false;
    d.collider.alive = false;
    this.R.hideStatic(d.parts.map((p) => p.h));
    for (const p of d.parts) {
      const pieces = Math.max(2, Math.min(6, Math.round((p.sx + p.sy + p.sz) * 1.5)));
      for (let i = 0; i < pieces; i++) {
        const s = Math.cbrt(p.sx * p.sy * p.sz / pieces) * 0.8;
        this.debris.spawn({
          x: p.x + (Math.random() - 0.5) * p.sx, y: p.y + (Math.random() - 0.5) * p.sy, z: p.z + (Math.random() - 0.5) * p.sz,
          vx: dirX * 5 + (Math.random() - 0.5) * 7, vy: 3 + Math.random() * 6, vz: dirZ * 5 + (Math.random() - 0.5) * 7,
          sx: s * (0.6 + Math.random() * 0.8), sy: s * (0.6 + Math.random() * 0.8), sz: s * (0.6 + Math.random() * 0.8),
          kind: p.kind === PRIM.CYL ? PRIM.BOX : p.kind === PRIM.ORB ? PRIM.SPHERE : p.kind, c: p.c, e: p.e,
        });
      }
    }
    const col = this._matColor(d);
    game.particles.burst(d.x, d.y + 1, d.z, 26, { speed: 7, color: col, shape: SHAPE.CHUNK, size: 0.12, life: 0.9, grav: 16, bounce: 0.4, additive: false });
    game.particles.burst(d.x, d.y + 0.6, d.z, 14, { speed: 2, color: this.dim.ash, shape: SHAPE.SMOKE, size: 0.9, size1: 1.6, life: 1.4, drag: 2, grav: -0.6, additive: false, alpha: 0.5 });
    if (d.material === 'crystal' || d.material === 'flesh') {
      game.particles.burst(d.x, d.y + 0.8, d.z, 30, { speed: 6, color: col, shape: SHAPE.SPARK, size: 0.06, life: 0.8, grav: 6 });
      // remove associated light
      const li = this.lights.findIndex((l) => Math.hypot(l.x - d.x, l.z - d.z) < 0.5);
      if (li >= 0) this.lights.splice(li, 1);
    }
    game.audio.play('break');
    game.shake(0.25);
    game.onDestructibleBroken(d);
  }

  chestCost(c, discount = 0) {
    const t = CHEST_TIERS[c.tier];
    return Math.round(t.cost * (1 + this.chestsOpened * 0.22) * (1 + this.depth * 0.45) * (1 - discount));
  }

  update(dt, game) {
    this.time += dt;
    this.debris.update(dt, this);
    for (const d of this.destructibles) if (d.shake > 0) d.shake -= dt;
    for (const c of this.chests) {
      if (c.opened && c.openT < 1) c.openT = Math.min(1, c.openT + dt * 1.5);
    }
  }

  draw(R, game, camX, camZ) {
    const time = this.time;
    this.debris.draw(R);
    // lights near camera
    for (const l of this.lights) {
      const dx = l.x - camX, dz = l.z - camZ;
      if (dx * dx + dz * dz > 75 * 75) continue;
      const fl = 1 + Math.sin(time * 9 + l.x) * l.flicker * 0.3 + Math.sin(time * 23 + l.z) * l.flicker * 0.15;
      R.light(l.x, l.y, l.z, l.r, l.c[0], l.c[1], l.c[2], l.i * fl);
      if (l.fire && Math.random() < 0.5) {
        game.particles.emit({ x: l.x + (Math.random() - 0.5) * 0.4, y: l.y - 0.1, z: l.z + (Math.random() - 0.5) * 0.4, vy: 1.5 + Math.random(), vx: (Math.random() - 0.5) * 0.4, vz: (Math.random() - 0.5) * 0.4, life: 0.7, size: 0.3, size1: 0.05, color: l.c, shape: SHAPE.GLOW });
      }
    }
    // animated props
    for (const a of this.animated) {
      const dx = a.x - camX, dz = a.z - camZ;
      if (dx * dx + dz * dz > 110 * 110) continue;
      if (a.type === 'floatRock') {
        const y = a.y + Math.sin(time * 0.6 + a.phase) * 0.6;
        R.trs(PRIM.SPHERE, a.x, y, a.z, time * a.spin + a.phase, a.phase, 0.3, a.s * 1.4, a.s * 0.8, a.s * 1.2, a.col);
        R.trs(PRIM.CONE, a.x, y - a.s * 0.4, a.z, time * a.spin, Math.PI, 0, a.s * 0.9, a.s * 1.8, a.s * 0.9, a.col);
      } else if (a.type === 'tendril') {
        let px = a.x, py = a.y - 0.3, pz = a.z;
        const segL = 0.55 * a.s;
        let r = 0.22 * a.s;
        for (let i = 0; i < a.segs; i++) {
          const k = i / a.segs;
          const sw = Math.sin(time * 1.3 + a.phase + k * 3) * k * 0.9;
          const sw2 = Math.cos(time * 1.1 + a.phase * 2 + k * 2.5) * k * 0.9;
          const nx = px + sw * segL * 0.8, ny = py + segL * (1 - k * 0.4), nz = pz + sw2 * segL * 0.8;
          R.seg(px, py, pz, nx, ny, nz, r, a.col, 0.1);
          px = nx; py = ny; pz = nz;
          r *= 0.84;
        }
        R.ball(px, py, pz, r * 1.8, mixRgb(a.col, [1, 0.9, 0.6], 0.5), 1.4);
      }
    }
    // destructible shake / hp feedback is visual-only via particles
    // chests
    for (const c of this.chests) {
      const dx = c.x - camX, dz = c.z - camZ;
      if (dx * dx + dz * dz > 100 * 100) continue;
      this._drawChest(R, c, game);
    }
    // obelisks
    for (const o of this.obelisks) this._drawObelisk(R, o, game);
    if (this.portal) this._drawPortal(R, this.portal, game);
    if (this.exitPortal) this._drawPortal(R, this.exitPortal, game);
  }

  _drawChest(R, c, game) {
    const t = CHEST_TIERS[c.tier];
    const s = t.scale;
    const y = c.y;
    const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    const col = t.color;
    const band = c.tier === 2 ? [0.3, 0.9, 0.75] : [0.35, 0.3, 0.25];
    R.trs(PRIM.BOX, c.x, y + 0.3 * s, c.z, c.yaw, 0, 0, 1.0 * s, 0.6 * s, 0.65 * s, col, 0);
    R.trs(PRIM.BOX, c.x, y + 0.3 * s, c.z, c.yaw, 0, 0, 1.04 * s, 0.1 * s, 0.69 * s, band, c.tier === 2 ? 0.6 : 0);
    // lid hinged at the back edge
    const open = c.opened ? Math.min(1, c.openT * 1.4) * 1.9 : 0;
    const hz = -0.32 * s;
    const lidCy = 0.62 * s + Math.sin(open) * 0.32 * s;
    const lidCz = hz + Math.cos(open) * 0.32 * s;
    R.trs(PRIM.BOX, c.x + sn * lidCz, y + lidCy, c.z + cs * lidCz, c.yaw, -open, 0, 1.02 * s, 0.14 * s, 0.66 * s, col, 0);
    // eye-lock / glow
    const glowCol = c.opened ? t.glow : t.glow;
    if (!c.opened) {
      const pulse = 0.8 + Math.sin(game.time * 3 + c.bob) * 0.3;
      R.trs(PRIM.ORB, c.x + sn * 0.34 * s, y + 0.5 * s, c.z + cs * 0.34 * s, c.yaw, 0, 0, 0.09 * s, 0.09 * s, 0.05 * s, glowCol, 2 * pulse);
      if (c.tier >= 1) {
        for (const side of [-1, 1]) {
          const ox = cs * side * 0.55 * s, oz = -sn * side * 0.55 * s;
          R.trs(PRIM.CONE, c.x + ox, y + 0.55 * s, c.z + oz, c.yaw + side * 0.4, 0, side * 0.6, 0.06 * s, 0.4 * s, 0.06 * s, c.tier === 2 ? [0.1, 0.05, 0.1] : [0.85, 0.8, 0.7]);
        }
      }
      if (c.tier === 2) {
        for (let i = 0; i < 3; i++) {
          const a = game.time * 1.5 + (i * TAU) / 3;
          R.trs(PRIM.OCTA, c.x + Math.cos(a) * 0.9, y + 1.2 + Math.sin(game.time * 2 + i) * 0.15, c.z + Math.sin(a) * 0.9, a, 0, 0, 0.08, 0.16, 0.08, t.glow, 2);
        }
      }
      R.light(c.x, y + 1.2, c.z, 5 + c.tier * 2, glowCol[0], glowCol[1], glowCol[2], 0.7 + c.tier * 0.3);
      R.decal(c.x, y + 0.08, c.z, 1.3 * s, glowCol[0], glowCol[1], glowCol[2], 0.25, SHAPE.RING);
    } else if (c.openT < 1) {
      const k = 1 - c.openT;
      R.light(c.x, y + 1.5, c.z, 10, glowCol[0], glowCol[1], glowCol[2], 3 * k);
    }
  }

  _drawObelisk(R, o, game) {
    const t = this.dim.terrain;
    const col = o.done ? [0.2, 0.18, 0.22] : [0.08, 0.06, 0.1];
    const glow = o.done ? [0.4, 1, 0.7] : t.accent;
    R.trs(PRIM.BOX, o.x, o.y + 3, o.z, game.time * 0.0 + o.x, 0, 0, 1.1, 6, 1.1, col, 0);
    R.trs(PRIM.CONE, o.x, o.y + 6, o.z, o.x, 0, 0, 0.8, 1.6, 0.8, col, 0);
    const k = o.done ? 1 : o.charge;
    for (let i = 0; i < 4; i++) {
      const a = game.time * (0.6 + k * 2) + (i * TAU) / 4;
      const rr = 1.6 + Math.sin(game.time + i) * 0.2;
      R.trs(PRIM.OCTA, o.x + Math.cos(a) * rr, o.y + 2 + i * 0.9, o.z + Math.sin(a) * rr, a, 0, 0, 0.15, 0.35, 0.15, glow, 0.6 + k * 2);
    }
    R.trs(PRIM.ORB, o.x, o.y + 4.2, o.z, 0, 0, 0, 0.35, 0.35, 0.35, glow, 1 + k * 3);
    R.light(o.x, o.y + 4.2, o.z, 12 + k * 8, glow[0], glow[1], glow[2], 1 + k * 1.5);
    if (!o.done) {
      R.decal(o.x, o.y + 0.1, o.z, 8, glow[0], glow[1], glow[2], o.active ? 0.6 : 0.3, SHAPE.RING);
      if (o.charge > 0) R.decal(o.x, o.y + 0.12, o.z, 8 * o.charge, glow[0], glow[1], glow[2], 0.25, 0);
    }
  }

  _drawPortal(R, p, game) {
    const t = game.time;
    const col = p.kind === 'exit' ? [0.5, 1, 0.85] : this.dim.env.moonCol;
    const life = p.kind === 'boss' && p.timer !== undefined ? clamp(p.timer / 10, 0.3, 1) : 1;
    const R0 = 3.2 * p.scale;
    const n = 22;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + t * 0.4;
      const wob = Math.sin(t * 3 + i * 1.7) * 0.18;
      const x = p.x + Math.cos(a) * (R0 + wob) * Math.cos(p.yaw);
      const z = p.z + Math.cos(a) * (R0 + wob) * -Math.sin(p.yaw);
      const y = p.y + R0 + 0.5 + Math.sin(a) * (R0 + wob);
      R.trs(PRIM.OCTA, x, y, z, a, t + i, 0, 0.18, 0.45, 0.18, col, 1.5 * life);
    }
    // inner swirl
    R.trs(PRIM.ORB, p.x, p.y + R0 + 0.5, p.z, p.yaw, 0, 0, R0 * 0.85, R0 * 0.9, 0.12, [0.02, 0.0, 0.04], 0);
    for (let i = 0; i < 3; i++) {
      const a = t * 2 + (i * TAU) / 3;
      game.particles.emit({
        x: p.x + Math.cos(a) * R0 * Math.cos(p.yaw), y: p.y + R0 + 0.5 + Math.sin(a) * R0, z: p.z - Math.cos(a) * R0 * Math.sin(p.yaw),
        vx: 0, vy: 0, vz: 0, life: 0.6, size: 0.35, size1: 0, color: col, shape: SHAPE.GLOW,
      });
    }
    R.light(p.x, p.y + R0, p.z, 22, col[0], col[1], col[2], 2.2 * life);
    R.decal(p.x, p.y + 0.1, p.z, R0 * 1.5, col[0], col[1], col[2], 0.35, SHAPE.RING);
  }

  openBossPortal(rng) {
    const s = this.portalSpot;
    this.portal = { kind: 'boss', x: s.x, z: s.z, y: this.height(s.x, s.z), yaw: rng.next() * TAU, scale: 1, timer: 80 };
  }

  openExitPortal(x, z) {
    this.exitPortal = { kind: 'exit', x, z, y: this.height(x, z), yaw: 0, scale: 1 };
  }

  /**
   * Layered realm atmosphere around the player. Every particle is flagged `amb` so the player's wake (see
   * Particles.field) shoves it aside and sweeps it along; sprinting makes the realm visibly churn.
   */
  ambient(game, cx, cy, cz, dt) {
    const a = this.dim.ambient;
    const P = game.particles;
    const sprint = game.player && game.player.sprinting ? 1 : 0;
    const n = Math.floor((150 + sprint * 60) * dt + Math.random());
    const R = Math.random;
    for (let i = 0; i < n; i++) {
      // denser close to the player, thinner out to 26 m
      const ang = R() * 6.2832, rad = Math.pow(R(), 0.7) * 26;
      const x = cx + Math.cos(ang) * rad, z = cz + Math.sin(ang) * rad;
      const g = this.height(x, z);
      const layer = R();
      switch (a.kind) {
        case 'embers':
          if (layer < 0.45) P.emit({ amb: 1, x, y: g + R() * 7, z, vx: (R() - 0.5) * 0.6, vy: 0.5 + R() * 0.9, vz: (R() - 0.5) * 0.6, life: 3, size: R() < 0.7 ? 0.05 : 0.09, color: a.color, shape: SHAPE.GLOW, drag: 0.3 });
          else if (layer < 0.9) P.emit({ amb: 1, x, y: g + 3 + R() * 7, z, vx: 0.4 + (R() - 0.5) * 0.5, vy: -0.6 - R() * 0.4, vz: (R() - 0.5) * 0.5, life: 5, size: 0.05 + R() * 0.04, color: a.color2, shape: SHAPE.CHUNK, drag: 0.4, additive: false, alpha: 0.85 });
          else P.emit({ amb: 1, x, y: g + 0.3, z, vx: (R() - 0.5) * 0.4, vy: 0.25, vz: (R() - 0.5) * 0.4, life: 2.5, size: 0.5, size1: 1.4, color: [0.32, 0.27, 0.27], shape: SHAPE.SMOKE, drag: 0.5, additive: false, alpha: 0.35 });
          break;
        case 'bubbles':
          if (layer < 0.4) P.emit({ amb: 1, x, y: g + R() * 3, z, vx: 0, vy: 0.8 + R(), vz: 0, life: 4, size: 0.07 + R() * 0.09, color: a.color, shape: SHAPE.RING, drag: 0.15 });
          else if (layer < 0.85) P.emit({ amb: 1, x, y: g + 0.5 + R() * 6, z, vx: (R() - 0.5) * 0.3, vy: (R() - 0.5) * 0.15, vz: (R() - 0.5) * 0.3, life: 5, size: 0.035, color: a.color2, shape: SHAPE.GLOW, drag: 0.2 });
          else P.emit({ amb: 1, x, y: g + 0.2, z, vx: (R() - 0.5) * 0.3, vy: 0.08, vz: (R() - 0.5) * 0.3, life: 3, size: 0.6, size1: 1.6, color: [0.12, 0.3, 0.3], shape: SHAPE.SMOKE, drag: 0.6, additive: false, alpha: 0.3 });
          break;
        case 'stars':
          if (layer < 0.5) P.emit({ amb: 1, x, y: g + 1 + R() * 10, z, vx: (R() - 0.5) * 0.3, vy: -0.1 + R() * 0.2, vz: (R() - 0.5) * 0.3, life: 4, size: 0.07 + R() * 0.1, color: a.color, shape: SHAPE.STAR, drag: 0.1 });
          else if (layer < 0.88) P.emit({ amb: 1, x, y: g + 0.5 + R() * 4, z, vx: (R() - 0.5) * 0.8, vy: 0.2 + R() * 0.3, vz: (R() - 0.5) * 0.8, life: 2.2, size: 0.05, color: a.color2, shape: SHAPE.SPARK, drag: 0.2 });
          else P.emit({ amb: 1, x, y: g + 0.15, z, vx: 0, vy: 0.4, vz: 0, life: 2, size: 0.1, size1: 1.2, color: a.color2, shape: SHAPE.RING, drag: 0.5, alpha: 0.6 });
          break;
        case 'spores':
          if (layer < 0.5) P.emit({ amb: 1, x, y: g + R() * 6, z, vx: (R() - 0.5) * 0.4, vy: -0.2 + R() * 0.3, vz: (R() - 0.5) * 0.4, life: 4, size: 0.06 + R() * 0.06, color: a.color, shape: SHAPE.GLOW, drag: 0.15 });
          else if (layer < 0.8) P.emit({ amb: 1, x, y: g + 0.3 + R() * 3, z, vx: (R() - 0.5) * 0.2, vy: 0.3 + R() * 0.3, vz: (R() - 0.5) * 0.2, life: 3, size: 0.04, color: a.color2, shape: SHAPE.GLOW, drag: 0.3 });
          else P.emit({ amb: 1, x, y: g + 6 + R() * 6, z, vx: 0, vy: -4, vz: 0, life: 1.6, size: 0.06, color: this.dim.blood, shape: SHAPE.CHUNK, grav: 6, bounce: 0, additive: false });
          break;
        default:
          break;
      }
    }
  }
}
