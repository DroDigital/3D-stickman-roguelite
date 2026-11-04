// CPU-simulated particle pools (structure-of-arrays, zero allocations per frame).

export const SHAPE = { GLOW: 0, RING: 1, SPARK: 2, CHUNK: 3, STAR: 4, SMOKE: 5 };

class Pool {
  constructor(cap) {
    this.cap = cap;
    this.n = 0;
    const F = () => new Float32Array(cap);
    this.x = F(); this.y = F(); this.z = F();
    this.vx = F(); this.vy = F(); this.vz = F();
    this.life = F(); this.max = F();
    this.s0 = F(); this.s1 = F();
    this.r = F(); this.g = F(); this.b = F(); this.a = F();
    this.drag = F(); this.grav = F(); this.bounce = F();
    this.shape = new Uint8Array(cap);
    this.amb = new Uint8Array(cap);
  }

  spawn() {
    if (this.n >= this.cap) {
      // overwrite a random old particle when saturated
      return (Math.random() * this.cap) | 0;
    }
    return this.n++;
  }

  kill(i) {
    const j = --this.n;
    if (i === j) return;
    this.x[i] = this.x[j]; this.y[i] = this.y[j]; this.z[i] = this.z[j];
    this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.vz[i] = this.vz[j];
    this.life[i] = this.life[j]; this.max[i] = this.max[j];
    this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j];
    this.r[i] = this.r[j]; this.g[i] = this.g[j]; this.b[i] = this.b[j]; this.a[i] = this.a[j];
    this.drag[i] = this.drag[j]; this.grav[i] = this.grav[j]; this.bounce[i] = this.bounce[j];
    this.shape[i] = this.shape[j];
    this.amb[i] = this.amb[j];
  }
}

export class Particles {
  constructor(renderer) {
    this.r = renderer;
    this.add = new Pool(16000);
    this.alpha = new Pool(11000);
    this.ground = () => -1e9;
    // a moving wind body (the sprinting player) that shoves ambient particles aside and drags them along
    this.field = { x: 0, y: 0, z: 0, vx: 0, vz: 0, r: 0, k: 0 };
  }

  clear() { this.add.n = 0; this.alpha.n = 0; }

  emit(o) {
    const p = o.additive === false ? this.alpha : this.add;
    const i = p.spawn();
    p.x[i] = o.x; p.y[i] = o.y; p.z[i] = o.z;
    p.vx[i] = o.vx || 0; p.vy[i] = o.vy || 0; p.vz[i] = o.vz || 0;
    p.life[i] = p.max[i] = o.life || 1;
    p.s0[i] = o.size ?? 0.2; p.s1[i] = o.size1 ?? 0;
    const c = o.color || [1, 1, 1];
    p.r[i] = c[0]; p.g[i] = c[1]; p.b[i] = c[2]; p.a[i] = o.alpha ?? 1;
    p.drag[i] = o.drag ?? 1; p.grav[i] = o.grav ?? 0; p.bounce[i] = o.bounce ?? -1;
    p.shape[i] = o.shape ?? 0;
    p.amb[i] = o.amb ? 1 : 0;
  }

  /** Spherical burst. */
  burst(x, y, z, count, o) {
    const sp = o.speed ?? 4, spr = o.spread ?? 1;
    const up = o.up ?? 0;
    for (let k = 0; k < count; k++) {
      let dx = Math.random() * 2 - 1, dy = Math.random() * 2 - 1, dz = Math.random() * 2 - 1;
      const l = Math.hypot(dx, dy, dz) || 1;
      const s = sp * (0.35 + Math.random() * 0.65);
      dx = (dx / l) * s; dy = (dy / l) * s + up; dz = (dz / l) * s;
      if (o.dir) {
        dx = dx * spr + o.dir[0] * sp;
        dy = dy * spr + o.dir[1] * sp;
        dz = dz * spr + o.dir[2] * sp;
      }
      const jit = o.jitter ?? 0;
      this.emit({
        x: x + (Math.random() - 0.5) * jit, y: y + (Math.random() - 0.5) * jit, z: z + (Math.random() - 0.5) * jit,
        vx: dx, vy: dy, vz: dz,
        life: (o.life ?? 0.6) * (0.6 + Math.random() * 0.6),
        size: (o.size ?? 0.15) * (0.6 + Math.random() * 0.8), size1: o.size1 ?? 0,
        color: o.colors ? o.colors[(Math.random() * o.colors.length) | 0] : o.color,
        alpha: o.alpha, drag: o.drag, grav: o.grav, bounce: o.bounce, shape: o.shape, additive: o.additive,
      });
    }
  }

  _sim(p, dt, batch, stretchSparks) {
    const ground = this.ground;
    const F = this.field, fr2 = F.r * F.r, fk = F.k;
    for (let i = p.n - 1; i >= 0; i--) {
      p.life[i] -= dt;
      if (p.life[i] <= 0) { p.kill(i); continue; }
      if (fk > 0 && p.amb[i]) {
        const dx = p.x[i] - F.x, dy = p.y[i] - F.y, dz = p.z[i] - F.z;
        const d2 = dx * dx + dz * dz + dy * dy * 0.3;
        if (d2 < fr2) {
          // pushed out of the way, then swept along in the wake
          const d = Math.sqrt(d2) || 1, w = (1 - d / F.r) * fk * dt;
          p.vx[i] += (dx / d) * w * 9 + F.vx * w * 1.6;
          p.vz[i] += (dz / d) * w * 9 + F.vz * w * 1.6;
          p.vy[i] += w * 2.5;
        }
      }
      const dr = Math.exp(-p.drag[i] * dt);
      p.vx[i] *= dr; p.vy[i] *= dr; p.vz[i] *= dr;
      p.vy[i] -= p.grav[i] * dt;
      p.x[i] += p.vx[i] * dt; p.y[i] += p.vy[i] * dt; p.z[i] += p.vz[i] * dt;
      if (p.bounce[i] >= 0) {
        const g = ground(p.x[i], p.z[i]) + 0.03;
        if (p.y[i] < g) {
          p.y[i] = g;
          p.vy[i] = -p.vy[i] * p.bounce[i];
          p.vx[i] *= 0.6; p.vz[i] *= 0.6;
        }
      }
      const t = p.life[i] / p.max[i];
      const size = p.s1[i] + (p.s0[i] - p.s1[i]) * t;
      const a = p.a[i] * Math.min(1, t * 3);
      const sh = p.shape[i];
      if (sh === SHAPE.SPARK && stretchSparks) {
        const k = 0.045;
        batch.push(p.x[i], p.y[i], p.z[i], size, p.r[i], p.g[i], p.b[i], a, p.vx[i] * k, p.vy[i] * k, p.vz[i] * k, sh);
      } else {
        batch.push(p.x[i], p.y[i], p.z[i], size, p.r[i], p.g[i], p.b[i], a, 0, 0, 0, sh);
      }
    }
  }

  update(dt) {
    this._sim(this.add, dt, this.r.addQuads, true);
    this._sim(this.alpha, dt, this.r.alphaQuads, true);
  }
}
