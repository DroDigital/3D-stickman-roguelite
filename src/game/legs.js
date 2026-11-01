// Procedural legged locomotion: planted feet, gait groups, arcing steps and 2-bone IK knees.
import { smoothstep } from '../core/math.js';

export class Legs {
  /**
   * legs: [{hip:[x,y,z] (body-local), rest:[x,z] (body-local foot rest), l1, l2, group}]
   */
  constructor(legs, opts = {}) {
    this.legs = legs.map((l) => ({
      ...l,
      fx: 0, fy: 0, fz: 0, sx: 0, sy: 0, sz: 0, tx: 0, ty: 0, tz: 0, t: -1,
      hx: 0, hy: 0, hz: 0, kx: 0, ky: 0, kz: 0,
    }));
    this.stepTime = opts.stepTime ?? 0.18;
    this.stepDist = opts.stepDist ?? 0.6;
    this.lift = opts.lift ?? 0.3;
    this.lead = opts.lead ?? 0.6;
    this.knee = opts.knee ?? 1; // +1 knees up/out (spider), -1 knees backward (digitigrade)
    this.init = false;
  }

  place(body, ground) {
    for (const l of this.legs) {
      this._rest(l, body, 0, 0, ground);
      l.fx = l.tx; l.fy = l.ty; l.fz = l.tz;
      l.t = -1;
    }
    this.init = true;
  }

  _rest(l, body, vx, vz, ground) {
    const c = Math.cos(body.yaw), s = Math.sin(body.yaw);
    const sc = body.scale || 1;
    const x = body.x + (l.rest[0] * c + l.rest[1] * s) * sc + vx * this.stepTime * this.lead * 2;
    const z = body.z + (-l.rest[0] * s + l.rest[1] * c) * sc + vz * this.stepTime * this.lead * 2;
    l.tx = x; l.tz = z; l.ty = ground(x, z) + 0.04 * sc;
  }

  /** body: {x,y,z,yaw,scale,pitch?}; returns nothing, updates foot/hip/knee world positions. */
  update(dt, body, vx, vz, ground) {
    if (!this.init) this.place(body, ground);
    const c = Math.cos(body.yaw), s = Math.sin(body.yaw);
    const sc = body.scale || 1;
    const speed = Math.hypot(vx, vz);
    const stepTime = this.stepTime / Math.max(0.6, Math.min(1.8, speed / 4 + 0.6));
    let groupStepping = {};
    for (const l of this.legs) if (l.t >= 0) groupStepping[l.group] = true;
    for (const l of this.legs) {
      // hip world
      const hx = l.hip[0] * sc, hy = l.hip[1] * sc, hz = l.hip[2] * sc;
      l.hx = body.x + hx * c + hz * s;
      l.hy = body.y + hy;
      l.hz = body.z - hx * s + hz * c;
      this._rest(l, body, vx, vz, ground);
      if (l.t >= 0) {
        l.t += dt / stepTime;
        if (l.t >= 1) { l.t = -1; l.fx = l.tx; l.fy = l.ty; l.fz = l.tz; } else {
          const k = smoothstep(l.t);
          l.fx = l.sx + (l.tx - l.sx) * k;
          l.fz = l.sz + (l.tz - l.sz) * k;
          l.fy = l.sy + (l.ty - l.sy) * k + Math.sin(l.t * Math.PI) * this.lift * sc;
        }
      } else {
        const d = Math.hypot(l.tx - l.fx, l.tz - l.fz);
        const otherStepping = Object.keys(groupStepping).some((g) => Number(g) !== l.group);
        if ((d > this.stepDist * sc && !otherStepping) || d > this.stepDist * sc * 2.2) {
          l.t = 0; l.sx = l.fx; l.sy = l.fy; l.sz = l.fz;
          groupStepping[l.group] = true;
        }
      }
      // IK knee
      const dx = l.fx - l.hx, dy = l.fy - l.hy, dz = l.fz - l.hz;
      let dist = Math.hypot(dx, dy, dz) || 1e-4;
      const L1 = l.l1 * sc, L2 = l.l2 * sc;
      const maxD = (L1 + L2) * 0.999;
      let fx = l.fx, fy = l.fy, fz = l.fz;
      if (dist > maxD) {
        const r = maxD / dist;
        fx = l.hx + dx * r; fy = l.hy + dy * r; fz = l.hz + dz * r;
        dist = maxD;
      }
      const nx = (fx - l.hx) / dist, ny = (fy - l.hy) / dist, nz = (fz - l.hz) / dist;
      const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
      const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      // pole: outward from body + up (spider) or backward (digitigrade)
      let px = l.hx - body.x, pz = l.hz - body.z;
      const pl = Math.hypot(px, pz) || 1;
      px /= pl; pz /= pl;
      let qx, qy, qz;
      if (this.knee > 0) { qx = px * 0.6; qy = 1; qz = pz * 0.6; } else { qx = -s * 0 + (-Math.sin(body.yaw)) * 1; qy = 0.3; qz = -Math.cos(body.yaw); }
      const pd = qx * nx + qy * ny + qz * nz;
      qx -= nx * pd; qy -= ny * pd; qz -= nz * pd;
      const ql = Math.hypot(qx, qy, qz) || 1;
      l.kx = l.hx + nx * a + (qx / ql) * h;
      l.ky = l.hy + ny * a + (qy / ql) * h;
      l.kz = l.hz + nz * a + (qz / ql) * h;
      l.ex = fx; l.ey = fy; l.ez = fz;
    }
  }

  /** Write hip/knee/foot for each leg into pts starting at point index base (3 points per leg). */
  write(pts, base) {
    let o = base * 3;
    for (const l of this.legs) {
      pts[o++] = l.hx; pts[o++] = l.hy; pts[o++] = l.hz;
      pts[o++] = l.kx; pts[o++] = l.ky; pts[o++] = l.kz;
      pts[o++] = l.ex; pts[o++] = l.ey; pts[o++] = l.ez;
    }
  }
}
