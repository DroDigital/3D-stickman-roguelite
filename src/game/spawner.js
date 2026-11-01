// Escalating enemy spawns: budget grows with time in the dimension and depth; tides and elite hunts.
import { TAU } from '../core/math.js';

// time (s) before each type may appear in a dimension
const UNLOCK = { husk: 0, crawler: 0, hound: 25, gazer: 45, choir: 90, brute: 110, maw: 70 };

export class Spawner {
  constructor(game) {
    this.game = game;
    this.acc = 0;
    this.tideT = 75;
    this.cap = 40;
    this.enabled = true;
  }

  reset() {
    this.acc = 0;
    this.tideT = 75;
  }

  rate() {
    const g = this.game;
    const t = g.dimTime;
    const obeliskBoost = g.activeObelisk ? 1.8 : 1;
    return (0.55 + t / 110 + g.depth * 0.45) * obeliskBoost;
  }

  pickType() {
    const g = this.game;
    const pool = Object.entries(g.dim.enemies).filter(([k]) => g.dimTime >= (UNLOCK[k] ?? 0) / (1 + g.depth * 0.5));
    return g.rng.weighted(pool, (e) => e[1])[0];
  }

  spawnPoint() {
    const g = this.game;
    const p = g.player;
    const W = g.world;
    for (let i = 0; i < 12; i++) {
      // prefer spawning outside of the camera's view
      const camA = Math.atan2(g.camFwd[0], g.camFwd[2]);
      const a = camA + Math.PI + (Math.random() - 0.5) * Math.PI * 1.6;
      const r = 20 + Math.random() * 14;
      const x = p.x + Math.sin(a) * r, z = p.z + Math.cos(a) * r;
      if (Math.hypot(x, z) > W.playRadius - 2) continue;
      if (W.normalY(x, z) < 0.65) continue;
      return { x, z };
    }
    const a = Math.random() * TAU;
    return { x: p.x + Math.cos(a) * 18, z: p.z + Math.sin(a) * 18 };
  }

  update(dt) {
    const g = this.game;
    if (!this.enabled || g.world.mode !== 'open') return;
    this.cap = Math.min(130, 32 + Math.floor(g.dimTime / 8) + g.depth * 12);
    this.acc += this.rate() * dt;
    while (this.acc >= 1) {
      this.acc -= 1;
      if (g.enemies.length >= this.cap) { this.acc = 0; break; }
      const pt = this.spawnPoint();
      const type = this.pickType();
      const eliteChance = 0.02 + g.dimTime / 3000 + g.depth * 0.015;
      if (type === 'crawler' && Math.random() < 0.6) {
        // crawlers come in broods
        for (let k = 0; k < 3; k++) g.spawnEnemy('crawler', pt.x + (Math.random() - 0.5) * 3, pt.z + (Math.random() - 0.5) * 3, {});
      } else {
        g.spawnEnemy(type, pt.x, pt.z, { elite: Math.random() < eliteChance });
      }
    }
    // tides: periodic surges
    this.tideT -= dt;
    if (this.tideT <= 0) {
      this.tideT = 70 + Math.random() * 20;
      const n = 10 + Math.floor(g.dimTime / 20) + g.depth * 4;
      const a0 = Math.random() * TAU;
      for (let i = 0; i < n; i++) {
        const a = a0 + (Math.random() - 0.5) * 1.2;
        const r = 22 + Math.random() * 6;
        const x = g.player.x + Math.cos(a) * r, z = g.player.z + Math.sin(a) * r;
        if (Math.hypot(x, z) > g.world.playRadius) continue;
        g.spawnEnemy(this.pickType(), x, z, {});
      }
      g.announce('A Tide of the Hollow approaches', 'tide');
    }
  }

  /** Elite hunt when the rift closes unclaimed. */
  hunt(count) {
    const g = this.game;
    for (let i = 0; i < count; i++) {
      const pt = this.spawnPoint();
      g.spawnEnemy(this.pickType(), pt.x, pt.z, { elite: true });
    }
  }
}
