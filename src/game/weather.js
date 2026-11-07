// Weather and living atmosphere for the cinematic pack. Each realm cycles through its own weather states (ash
// fall and ember storms, rain and lightning storms, void snow and starfall, blood rain and spore fog). Weather
// drives GPU precipitation, wind (foliage, particles, clouds), gusts, fog density, surface wetness and ash dust,
// lightning that lights the whole scene with thunder arriving after the flash, splashes and ripples, and audio
// beds. Critter flocks (crows, void moths, glowing fish, carrion flies) settle around the hero and scatter when
// disturbed — by footsteps, sprints, blasts or thunder.
import { SHAPE } from '../gfx/particles.js';
import { PRIM } from '../gfx/renderer.js';
import { MAT } from '../gfx/materials.js';
import { LOOKS } from '../gfx/cinematic.js';
import { TAU, clamp, lerp } from '../core/math.js';

/** Weather state presets. precip: GPU particle field; fog: density multiplier; wet/dust: surface targets. */
export const WEATHER = {
  clear: { precip: null, amount: 0, wind: 0.5, gust: 0.1, fog: 1, wet: 0, dust: 0, cloud: 0.35, lightning: 0 },
  ashfall: { precip: 'ash', amount: 0.55, wind: 0.9, gust: 0.35, fog: 1.25, wet: 0, dust: 0.75, cloud: 0.85, lightning: 0 },
  embers: { precip: 'embers', amount: 0.35, wind: 1.3, gust: 0.6, fog: 1.1, wet: 0, dust: 0.4, cloud: 0.7, lightning: 0 },
  dry_storm: { precip: 'ash', amount: 0.8, wind: 1.8, gust: 1, fog: 1.4, wet: 0, dust: 0.9, cloud: 1, lightning: 0.11 },
  rain: { precip: 'rain', amount: 0.6, wind: 0.9, gust: 0.4, fog: 1.3, wet: 1, dust: 0, cloud: 0.9, lightning: 0.02 },
  storm: { precip: 'rain', amount: 1, wind: 2, gust: 1, fog: 1.55, wet: 1, dust: 0, cloud: 1, lightning: 0.12 },
  mist: { precip: null, amount: 0, wind: 0.3, gust: 0.1, fog: 2.1, wet: 0.45, dust: 0, cloud: 0.6, lightning: 0 },
  voidsnow: { precip: 'voidsnow', amount: 0.65, wind: 0.5, gust: 0.25, fog: 1.2, wet: 0, dust: 0.35, cloud: 0.4, lightning: 0 },
  starfall: { precip: 'voidsnow', amount: 0.25, wind: 0.4, gust: 0.2, fog: 1, wet: 0, dust: 0.1, cloud: 0.2, lightning: 0, meteors: 1 },
  bloodrain: { precip: 'blood', amount: 0.75, wind: 1, gust: 0.5, fog: 1.35, wet: 1, dust: 0, cloud: 1, lightning: 0.05 },
  spores: { precip: 'spores', amount: 0.55, wind: 0.35, gust: 0.15, fog: 1.6, wet: 0.3, dust: 0, cloud: 0.8, lightning: 0 },
};

/** GPU precipitation looks. */
const PRECIP = {
  rain: { vel: [0, -16, 0], size: 0.008, streak: 0.04, color: [0.55, 0.62, 0.7], alpha: 0.32, round: 0, sway: 0, box: 26 },
  blood: { vel: [0, -15, 0], size: 0.009, streak: 0.04, color: [0.55, 0.06, 0.06], alpha: 0.42, round: 0, sway: 0, box: 26 },
  ash: { vel: [0, -1.1, 0], size: 0.035, streak: 0, color: [0.42, 0.4, 0.4], alpha: 0.7, round: 1, sway: 0.6, box: 30 },
  embers: { vel: [0, 0.8, 0], size: 0.03, streak: 0, color: [2.6, 1.0, 0.3], alpha: 0.85, round: 1, sway: 0.8, box: 30 },
  voidsnow: { vel: [0, -0.7, 0], size: 0.04, streak: 0, color: [1.2, 0.9, 2.0], alpha: 0.7, round: 1, sway: 0.7, box: 30 },
  spores: { vel: [0, 0.25, 0], size: 0.05, streak: 0, color: [1.4, 0.8, 0.4], alpha: 0.55, round: 1, sway: 1.2, box: 30 },
};

/** Critter flocks per realm: crows in the ash, glowing fish in the drowned abyss, void moths, carrion flies. */
const CRITTERS = {
  ashen: { kind: 'crow', color: [0.05, 0.045, 0.05], emis: 0, size: 0.32, flap: 9, sound: 'caw' },
  drowned: { kind: 'fish', color: [0.3, 1, 0.85], emis: 1.2, size: 0.22, flap: 5, sound: 'bubble' },
  starless: { kind: 'moth', color: [0.75, 0.55, 1], emis: 1.6, size: 0.2, flap: 16, sound: 'flutter' },
  flesh: { kind: 'fly', color: [0.15, 0.05, 0.05], emis: 0, size: 0.16, flap: 30, sound: 'buzz' },
};

export class Weather {
  constructor(game) {
    this.game = game;
    this.state = 'clear';
    this.cur = { ...WEATHER.clear };
    this.t = 0;
    this.next = 60;
    this.lightningT = 6;
    this.flash = 0;
    this.flashSeq = [];
    this.thunder = [];
    this.windAng = Math.random() * TAU;
    this.gustT = 0;
    this.gust = 0;
    this.wet = 0;
    this.dust = 0;
    this.flocks = [];
    this.meteors = [];
    this.bolt = null;
  }

  /** New dimension: pick the realm's weather cycle and reset surfaces. */
  setRealm(dim, mode) {
    this.dim = dim;
    this.look = LOOKS[dim.id] || LOOKS.ashen;
    this.cycle = this.look.weather;
    this.mode = mode;
    // the rift sanctum is always mid-storm
    this.state = mode === 'arena' ? (this.cycle.find((s) => WEATHER[s].lightning > 0.05) || this.cycle[0]) : this.cycle[(Math.random() * this.cycle.length) | 0];
    Object.assign(this.cur, WEATHER[this.state]);
    this.next = 70 + Math.random() * 60;
    this.wet = WEATHER[this.state].wet * 0.8;
    this.dust = WEATHER[this.state].dust * 0.8;
    this.flocks = [];
    this.meteors = [];
    this.critter = CRITTERS[dim.id] || CRITTERS.ashen;
  }

  /** Force a weather state (debug / events). */
  set(state) { if (WEATHER[state]) { this.state = state; this.next = 80 + Math.random() * 60; } }

  update(dt, active) {
    const g = this.game, R = g.R, cine = R.cine;
    if (!this.dim) return;
    this.t += dt;
    // cycle the weather slowly through the realm's states
    this.next -= dt;
    if (this.next <= 0 && this.mode !== 'arena') {
      const opts = this.cycle.filter((s) => s !== this.state);
      this.state = opts[(Math.random() * opts.length) | 0] || this.state;
      this.next = 70 + Math.random() * 70;
      if (WEATHER[this.state].lightning > 0.05) g.audio.play('thunder', 0.4, 0.5);
    }
    const tgt = WEATHER[this.state];
    const k = 1 - Math.exp(-dt / 6); // states cross-fade over several seconds
    for (const key of ['amount', 'wind', 'gust', 'fog', 'cloud', 'lightning']) this.cur[key] = lerp(this.cur[key], tgt[key], k);
    if (tgt.precip && this.cur.precip !== tgt.precip) {
      // swap precipitation type once the old one has faded
      if (this.cur.amountShown === undefined || this.cur.amountShown < 0.05) this.cur.precip = tgt.precip;
    }
    const showAmt = this.cur.precip === tgt.precip ? this.cur.amount : Math.max(0, (this.cur.amountShown || 0) - dt * 0.3);
    this.cur.amountShown = showAmt;
    // surfaces: rain soaks in quickly and dries slowly; ash settles over a minute
    this.wet = clamp(this.wet + (tgt.wet > this.wet ? dt / 12 : -dt / 50) * (tgt.wet > this.wet ? tgt.wet : 1), 0, 1);
    this.dust = clamp(this.dust + (tgt.dust > this.dust ? dt / 60 : -dt / 90), 0, 1);
    // wind: a slowly veering direction with gusts
    this.windAng += (Math.sin(this.t * 0.05) * 0.04) * dt;
    this.gustT -= dt;
    if (this.gustT <= 0) { this.gustT = 3 + Math.random() * 7; this.gustTarget = Math.random() < this.cur.gust ? 0.6 + Math.random() * 0.8 : 0; }
    this.gust = lerp(this.gust, this.gustTarget || 0, 1 - Math.exp(-dt * 1.5));
    const ws = this.cur.wind * (1 + this.gust);
    R.wind = [Math.cos(this.windAng) * ws * 0.6, Math.sin(this.windAng) * ws * 0.6];
    R.fogMul = this.cur.fog;
    // lightning: a flicker sequence, a bolt, then thunder after the light
    this.lightningT -= dt;
    if (this.cur.lightning > 0.02 && this.lightningT <= 0) {
      this.lightningT = (4 + Math.random() * 10) / Math.max(0.2, this.cur.lightning * 8);
      this.strike();
    }
    if (this.flashSeq.length) {
      const f = this.flashSeq[0];
      f.t -= dt;
      this.flash = f.v * Math.max(0, f.t / f.d);
      if (f.t <= 0) this.flashSeq.shift();
    } else this.flash = Math.max(0, this.flash - dt * 4);
    for (const th of this.thunder) th.t -= dt;
    for (const th of this.thunder.filter((th) => th.t <= 0)) {
      g.audio.play('thunder', th.k);
      if (th.k > 0.7) g.shake(0.25 * th.k);
      this.scare(g.player.x, g.player.z, 40);
    }
    this.thunder = this.thunder.filter((th) => th.t > 0);
    if (this.bolt) { this.bolt.t -= dt; if (this.bolt.t <= 0) this.bolt = null; }

    if (cine) {
      const pr = PRECIP[this.cur.precip];
      if (pr) {
        Object.assign(cine.precip, pr);
        cine.precip.kind = this.cur.precip;
        const wx = R.wind[0] * (pr.streak ? 2.5 : 1.2), wz = R.wind[1] * (pr.streak ? 2.5 : 1.2);
        cine.precip.vel = [pr.vel[0] + wx, pr.vel[1], pr.vel[2] + wz];
        cine.precip.amount = showAmt;
      } else cine.precip.amount = 0;
      cine.flash = this.flash;
      cine.wet = this.wet;
      cine.dust = this.dust;
      cine.gust = this.gust;
      cine.cloud = this.look.cloud * this.cur.cloud;
    }
    g.audio.setWeather({
      rain: (this.cur.precip === 'rain' || this.cur.precip === 'blood') ? showAmt : 0,
      wind: clamp(this.cur.wind * 0.35 + this.gust * 0.5, 0, 1),
      realm: this.dim.id,
    });
    if (active) {
      this._splashes(dt);
      this._meteors(dt);
      this._flocks(dt);
    }
  }

  /** A lightning strike somewhere around the hero (or exactly at x,z). */
  strike(x, z) {
    const g = this.game, p = g.player;
    const a = Math.random() * TAU, d = x === undefined ? 18 + Math.random() * 55 : 0;
    const bx = x ?? p.x + Math.cos(a) * d, bz = z ?? p.z + Math.sin(a) * d;
    const by = g.world.height(bx, bz);
    // flicker: two or three pulses
    this.flashSeq = [{ v: 1, t: 0.08, d: 0.08 }, { v: 0.25, t: 0.06, d: 0.06 }, { v: 0.8, t: 0.18, d: 0.18 }];
    if (Math.random() < 0.5) this.flashSeq.push({ v: 0.5, t: 0.25, d: 0.25 });
    const pts = [[bx + (Math.random() - 0.5) * 20, by + 70, bz + (Math.random() - 0.5) * 20]];
    for (let i = 1; i < 12; i++) {
      const t = i / 12, prev = pts[i - 1];
      pts.push([lerp(prev[0], bx, 0.25) + (Math.random() - 0.5) * 6 * (1 - t), lerp(by + 70, by, t), lerp(prev[2], bz, 0.25) + (Math.random() - 0.5) * 6 * (1 - t)]);
    }
    pts.push([bx, by, bz]);
    this.bolt = { pts, t: 0.35, x: bx, z: bz };
    const dist = Math.hypot(bx - p.x, bz - p.z);
    // light travels faster than sound — exaggerated a little for drama
    this.thunder.push({ t: 0.25 + dist / 90, k: clamp(1.2 - dist / 80, 0.35, 1) });
    if (dist < 40) {
      // ground strike: scorch, sparks and smoke
      g.splat(bx, bz, 2.5);
      g.particles.burst(bx, by + 0.3, bz, 40, { speed: 9, color: [0.8, 0.9, 1], shape: SHAPE.SPARK, size: 0.08, life: 0.6, grav: 10, bounce: 0.3 });
      g.particles.burst(bx, by + 0.5, bz, 14, { speed: 2, color: [0.25, 0.25, 0.28], shape: SHAPE.SMOKE, size: 1, size1: 2.4, life: 2.5, drag: 1.2, grav: -0.6, additive: false, alpha: 0.5 });
      g.blasts.push({ x: bx, z: bz, r: 4, s: 1.4, t: 0.6 });
    }
  }

  /** Scare every critter within r of (x,z). */
  scare(x, z, r) {
    for (const f of this.flocks) {
      if (f.state === 'flee') continue;
      if (Math.hypot(f.x - x, f.z - z) < r) this._flee(f, x, z);
    }
  }

  draw(R) {
    const g = this.game;
    if (this.bolt) {
      const b = this.bolt, c = [0.75, 0.82, 1];
      for (let i = 1; i < b.pts.length; i++) {
        const a = b.pts[i - 1], d = b.pts[i];
        R.seg(a[0], a[1], a[2], d[0], d[1], d[2], 0.09, c, 14 * (b.t / 0.35));
      }
      const m = b.pts[b.pts.length - 2];
      R.light(m[0], m[1] + 2, m[2], 40, 0.7, 0.8, 1, 6 * (b.t / 0.35));
    }
    for (const m of this.meteors) {
      R.seg(m.x, m.y, m.z, m.x - m.vx * 0.12, m.y - m.vy * 0.12, m.z - m.vz * 0.12, 0.12, m.c, 10);
    }
    // critters
    const cr = this.critter;
    if (!cr) return;
    R.setMat(cr.kind === 'crow' ? MAT.CLOTH : MAT.NONE, 0.7, 0, 6);
    for (const f of this.flocks) {
      for (const b of f.birds) {
        const s = cr.size * b.s;
        const flap = b.air ? Math.sin(g.time * cr.flap * b.rate + b.ph) : (Math.sin(g.time * 2 + b.ph) > 0.97 ? 0.6 : -0.9);
        const yaw = b.yaw;
        const cx = Math.cos(yaw), sz = Math.sin(yaw);
        // body
        R.trs(PRIM.SPHERE, b.x, b.y, b.z, yaw, 0, 0, s * 0.35, s * 0.32, s * 0.7, cr.color, cr.emis * 0.6);
        // wings (two thin boxes hinged at the shoulders)
        for (const side of [-1, 1]) {
          const ang = flap * 0.9 * side;
          const wx = b.x + cx * side * s * 0.45, wz = b.z - sz * side * s * 0.45;
          R.trs(PRIM.BOX, wx, b.y + Math.sin(ang) * s * 0.3 * side, wz, yaw, 0, ang, s * 0.9, s * 0.04, s * 0.45, cr.color, cr.emis);
        }
      }
    }
    R.setMat();
  }

  // ---------------------------------------------------------- internals
  _splashes(dt) {
    const g = this.game, P = g.particles, p = g.player;
    const kind = this.cur.precip, amt = this.cur.amountShown || 0;
    if ((kind === 'rain' || kind === 'blood') && amt > 0.05) {
      const n = Math.floor(amt * 70 * dt + Math.random());
      const col = kind === 'blood' ? [0.5, 0.05, 0.05] : [0.6, 0.68, 0.75];
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * 12;
        const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r, y = g.world.height(x, z) + 0.03;
        P.emit({ x, y, z, life: 0.28, size: 0.02, size1: 0.22, color: col, shape: SHAPE.RING, alpha: 0.5, additive: false });
        if (Math.random() < 0.4) P.emit({ x, y, z, vx: (Math.random() - 0.5) * 1.2, vy: 1.2 + Math.random() * 1.2, vz: (Math.random() - 0.5) * 1.2, life: 0.3, size: 0.018, color: col, shape: SHAPE.CHUNK, grav: 14, additive: false, alpha: 0.6 });
      }
      // drips running off the hero's shoulders
      if (Math.random() < amt * dt * 20) P.emit({ x: p.x + (Math.random() - 0.5) * 0.4, y: p.y + 1.4, z: p.z + (Math.random() - 0.5) * 0.4, vy: -1, life: 0.5, size: 0.015, color: col, shape: SHAPE.CHUNK, grav: 12, additive: false, alpha: 0.7 });
    }
    if (kind === 'embers' && amt > 0.05) {
      // ember gusts: streams of sparks carried on the wind
      const n = Math.floor(amt * 40 * dt * (1 + this.gust * 2) + Math.random());
      const w = this.game.R.wind;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, r = 4 + Math.random() * 18;
        const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        P.emit({ amb: 1, x, y: g.world.height(x, z) + 0.3 + Math.random() * 2, z, vx: w[0] * 3, vy: 0.6 + Math.random(), vz: w[1] * 3, life: 2.5, size: 0.04, color: [1, 0.45, 0.12], shape: SHAPE.SPARK, drag: 0.3 });
      }
    }
  }

  _meteors(dt) {
    const g = this.game, p = g.player;
    if (WEATHER[this.state].meteors && Math.random() < dt * 0.6) {
      const a = Math.random() * TAU;
      this.meteors.push({ x: p.x + Math.cos(a) * 80, y: 90 + Math.random() * 30, z: p.z + Math.sin(a) * 80, vx: -Math.cos(a) * 40 + (Math.random() - 0.5) * 20, vy: -30, vz: -Math.sin(a) * 40 + (Math.random() - 0.5) * 20, t: 3, c: Math.random() < 0.5 ? [0.85, 0.7, 1] : [0.6, 0.8, 1] });
    }
    for (const m of this.meteors) {
      m.t -= dt;
      m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt;
      g.particles.emit({ x: m.x, y: m.y, z: m.z, life: 0.6, size: 0.6, size1: 0, color: m.c, shape: SHAPE.GLOW, alpha: 0.5 });
      const gy = g.world.height(m.x, m.z);
      if (m.y < gy) {
        m.t = 0;
        if (Math.hypot(m.x - p.x, m.z - p.z) < 60) {
          g.particles.burst(m.x, gy + 0.5, m.z, 30, { speed: 8, color: m.c, shape: SHAPE.SPARK, size: 0.1, life: 0.8, grav: 8 });
          g.R.light(m.x, gy + 2, m.z, 25, m.c[0], m.c[1], m.c[2], 6);
          g.audio.play('boom', 0.35);
          this.scare(m.x, m.z, 30);
        }
      }
    }
    this.meteors = this.meteors.filter((m) => m.t > 0);
  }

  _flocks(dt) {
    const g = this.game, p = g.player, W = g.world;
    // keep a handful of flocks settled within 14–40 m of the hero
    this.flocks = this.flocks.filter((f) => Math.hypot(f.x - p.x, f.z - p.z) < 70 && !(f.state === 'flee' && f.t > 9));
    while (this.flocks.length < 5) {
      const a = Math.random() * TAU, r = 16 + Math.random() * 26;
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      if (Math.hypot(x, z) > W.playRadius) break;
      const n = 4 + ((Math.random() * 5) | 0);
      const birds = [];
      for (let i = 0; i < n; i++) {
        const bx = x + (Math.random() - 0.5) * 3, bz = z + (Math.random() - 0.5) * 3;
        birds.push({ x: bx, z: bz, y: W.height(bx, bz) + 0.12, vx: 0, vy: 0, vz: 0, yaw: Math.random() * TAU, ph: Math.random() * TAU, rate: 0.8 + Math.random() * 0.4, s: 0.8 + Math.random() * 0.4, air: this.critter.kind !== 'crow', hop: Math.random() * 3 });
      }
      this.flocks.push({ x, z, birds, state: 'idle', t: 0 });
    }
    const speed = Math.hypot(p.vx, p.vz);
    for (const f of this.flocks) {
      f.t += dt;
      if (f.state === 'idle') {
        const d = Math.hypot(f.x - p.x, f.z - p.z);
        const fear = p.sprinting ? 12 : speed > 3 ? 8 : 5;
        if (d < fear || (g.blasts.length && g.blasts.some((b) => Math.hypot(b.x - f.x, b.z - f.z) < 14))) this._flee(f, p.x, p.z);
        for (const b of f.birds) {
          if (this.critter.kind === 'crow') {
            // pecking about on the ground, with the odd hop
            b.hop -= dt;
            if (b.hop <= 0) { b.hop = 1 + Math.random() * 3; b.yaw += (Math.random() - 0.5) * 2; b.vx = Math.sin(b.yaw) * 0.8; b.vz = Math.cos(b.yaw) * 0.8; b.vy = 1.6; }
            b.vy -= 9 * dt; b.x += b.vx * dt; b.z += b.vz * dt; b.y += b.vy * dt;
            const gy = W.height(b.x, b.z) + 0.12;
            if (b.y < gy) { b.y = gy; b.vy = 0; b.vx *= 0.5; b.vz *= 0.5; }
          } else {
            // hovering swarm loops
            const a = g.time * (0.6 + b.rate * 0.5) + b.ph;
            b.x = f.x + Math.cos(a) * (1.2 + b.s);
            b.z = f.z + Math.sin(a * 1.3) * (1.2 + b.s);
            b.y = W.height(f.x, f.z) + 1.2 + Math.sin(a * 2.1) * 0.5;
            b.yaw = a + Math.PI / 2;
          }
        }
      } else {
        // scatter: burst up and away, then climb and wheel off
        for (const b of f.birds) {
          b.vy += (b.air ? 3 : 6) * dt;
          b.vx *= 1 - dt * 0.2; b.vz *= 1 - dt * 0.2;
          b.vx += Math.sin(g.time * 2 + b.ph) * dt * 2;
          b.x += b.vx * dt; b.y += Math.min(b.vy, 7) * dt; b.z += b.vz * dt;
          b.yaw = Math.atan2(b.vx, b.vz);
        }
      }
    }
  }

  _flee(f, fx, fz) {
    f.state = 'flee';
    f.t = 0;
    for (const b of f.birds) {
      const dx = b.x - fx, dz = b.z - fz, d = Math.hypot(dx, dz) || 1;
      b.air = true;
      b.vx = (dx / d) * (5 + Math.random() * 3) + (Math.random() - 0.5) * 3;
      b.vz = (dz / d) * (5 + Math.random() * 3) + (Math.random() - 0.5) * 3;
      b.vy = 3 + Math.random() * 2;
      b.rate = 1.2 + Math.random() * 0.3;
    }
    this.game.audio.play(this.critter.sound, 0.7, 0, { x: f.x, y: this.game.world.height(f.x, f.z) + 1, z: f.z });
  }
}
