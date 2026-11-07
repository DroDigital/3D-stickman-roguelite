// Weapon ribbon trails for the cinematic pack: every frame of a swing records the blade's tip and base; the trail
// is drawn as a smooth (Catmull-Rom subdivided) ribbon between them that brightens toward the edge and fades
// with age — the classic action-game swoosh, in HDR so it blooms.

const LIFE = 0.2;

export class Trail {
  constructor() {
    this.pts = []; // { t, x0,y0,z0 (tip), x1,y1,z1 (base) }
    this.time = 0;
  }

  /** Record the blade this frame (only while it should leave a trail). */
  add(tip, base) {
    this.pts.push({ t: this.time, x0: tip[0], y0: tip[1], z0: tip[2], x1: base[0], y1: base[1], z1: base[2] });
    if (this.pts.length > 40) this.pts.shift();
  }

  update(dt) {
    this.time += dt;
    while (this.pts.length && this.time - this.pts[0].t > LIFE) this.pts.shift();
  }

  clear() { this.pts.length = 0; }

  /** Emit the ribbon into the renderer (no-op when the renderer has no ribbon support). */
  draw(R, color, width = 1, intensity = 1) {
    const P = this.pts;
    if (!R.ribbon || P.length < 2) return;
    const out = [];
    const cr = (a, b, c, d, t) => {
      const t2 = t * t, t3 = t2 * t;
      return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    };
    const n = P.length;
    for (let i = 0; i < n - 1; i++) {
      const a = P[Math.max(0, i - 1)], b = P[i], c = P[i + 1], d = P[Math.min(n - 1, i + 2)];
      const steps = 4;
      for (let s = 0; s < steps; s++) {
        const u = s / steps;
        const age = (this.time - (b.t + (c.t - b.t) * u)) / LIFE;
        out.push(
          cr(a.x0, b.x0, c.x0, d.x0, u), cr(a.y0, b.y0, c.y0, d.y0, u), cr(a.z0, b.z0, c.z0, d.z0, u),
          cr(a.x1, b.x1, c.x1, d.x1, u), cr(a.y1, b.y1, c.y1, d.y1, u), cr(a.z1, b.z1, c.z1, d.z1, u),
          Math.max(0, 1 - age),
        );
      }
    }
    const l = P[n - 1];
    out.push(l.x0, l.y0, l.z0, l.x1, l.y1, l.z1, Math.max(0, 1 - (this.time - l.t) / LIFE));
    R.ribbon(out, color, width, intensity);
  }
}
