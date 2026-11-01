// Runtime for upgrade abilities: passive auras, periodic casts, on-hit and on-kill procs.
import { PRIM } from '../gfx/renderer.js';
import { SHAPE } from '../gfx/particles.js';
import { TAU } from '../core/math.js';

export class Abilities {
  constructor(game) {
    this.game = game;
    this.t = { blades: 1, starfall: 2, gaze: 1.5, entropy: 0 };
    this.orbAngle = 0;
    this.gazeBeam = null;
    this.echoQueue = [];
  }

  power(id) { return this.game.player.ab[id] || 0; }

  update(dt) {
    const g = this.game;
    const p = g.player;
    const area = p.stats.areaMul;

    // Void Orbitals
    const orb = this.power('orbitals');
    if (orb > 0) {
      const n = Math.min(8, 1 + Math.floor(orb));
      this.orbAngle += dt * (2.2 + orb * 0.2);
      const r = 2.4 * area;
      for (let i = 0; i < n; i++) {
        const a = this.orbAngle + (i / n) * TAU;
        const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r, y = p.y + 1.1;
        g.forEnemiesNear(x, z, 0.9, (e) => {
          if ((e._orbHit || 0) > g.time) return;
          e._orbHit = g.time + 0.4;
          g.damageEnemy(e, { dmg: 7 * orb * p.stats.dmgMul, dirX: Math.cos(a + 1.57), dirZ: Math.sin(a + 1.57), kb: 4, source: 'orbital', color: [0.7, 0.5, 1] });
        });
      }
    }

    // Spectral Blades
    const bl = this.power('blades');
    if (bl > 0) {
      this.t.blades -= dt;
      if (this.t.blades <= 0) {
        this.t.blades = Math.max(0.6, 2.4 - bl * 0.18);
        const n = 1 + Math.floor(bl / 1.5);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * TAU;
          g.spawnProjectile({ x: p.x, y: p.y + 1.6, z: p.z, vx: Math.cos(a) * 6, vy: 3, vz: Math.sin(a) * 6, r: 0.5, dmg: 12 * bl * p.stats.dmgMul, life: 3, owner: 'player', color: [0.6, 0.9, 1], kind: 'blade', homing: 14 });
        }
      }
    }

    // Entropy Field
    const en = this.power('entropy');
    if (en > 0) {
      const r = (3 + en * 0.4) * area;
      this.t.entropy -= dt;
      const tick = this.t.entropy <= 0;
      if (tick) this.t.entropy = 0.5;
      g.forEnemiesNear(p.x, p.z, r, (e) => {
        e.slowT = 0.3;
        if (tick) g.damageEnemy(e, { dmg: 3.5 * en * p.stats.dmgMul, dirX: 0, dirZ: 0, kb: 0, source: 'entropy', color: [0.5, 0.3, 0.8], quiet: true });
      });
      g.R.decal(p.x, p.y + 0.06, p.z, r, 0.45, 0.2, 0.75, 0.22 + Math.sin(g.time * 3) * 0.05, SHAPE.RING);
      if (Math.random() < 0.5) {
        const a = Math.random() * TAU, rr = Math.random() * r;
        g.particles.emit({ x: p.x + Math.cos(a) * rr, y: p.y + 0.1, z: p.z + Math.sin(a) * rr, vy: 0.8, life: 1, size: 0.12, color: [0.5, 0.3, 0.9], shape: SHAPE.GLOW });
      }
    }

    // Starfall
    const sf = this.power('starfall');
    if (sf > 0) {
      this.t.starfall -= dt;
      if (this.t.starfall <= 0) {
        this.t.starfall = Math.max(0.8, 3.2 - sf * 0.25);
        const n = 1 + Math.floor(sf / 2);
        for (let i = 0; i < n; i++) {
          const e = g.randomEnemyNear(p.x, p.z, 22);
          if (!e) break;
          g.addHazard({ x: e.x, z: e.z, r: 2.6 * area, t: 0.7, dmg: 30 * sf * p.stats.dmgMul, kind: 'star', owner: 'player', color: [1, 0.85, 0.5] });
        }
      }
    }

    // Eldritch Gaze
    const gz = this.power('gaze');
    if (gz > 0) {
      this.t.gaze -= dt;
      const ex = p.x - Math.sin(p.yaw) * 0.6, ez = p.z - Math.cos(p.yaw) * 0.6, ey = p.y + 2.6 + Math.sin(g.time * 2) * 0.1;
      this.eyePos = [ex, ey, ez];
      if (this.t.gaze <= 0) {
        const e = g.nearestEnemy(ex, ez, 14);
        if (e) {
          this.t.gaze = Math.max(0.35, 1.4 - gz * 0.12);
          this.gazeBeam = { e, t: 0.18 };
          g.damageEnemy(e, { dmg: 16 * gz * p.stats.dmgMul, dirX: 0, dirZ: 0, kb: 2, source: 'gaze', color: [1, 0.3, 0.6] });
          g.audio.play('zap');
        }
      }
      if (this.gazeBeam) {
        this.gazeBeam.t -= dt;
        if (this.gazeBeam.t <= 0) this.gazeBeam = null;
      }
    }

    // Echo strikes
    for (let i = this.echoQueue.length - 1; i >= 0; i--) {
      const q = this.echoQueue[i];
      q.t -= dt;
      if (q.t <= 0) {
        this.echoQueue.splice(i, 1);
        if (q.e.alive) {
          g.damageEnemy(q.e, { dmg: q.dmg, dirX: q.dirX, dirZ: q.dirZ, kb: 2, source: 'echo', color: [0.6, 0.9, 1] });
          g.particles.burst(q.e.x, q.e.y + 1, q.e.z, 10, { speed: 4, color: [0.6, 0.9, 1], shape: SHAPE.SPARK, size: 0.06, life: 0.4 });
        }
      }
    }
  }

  /** Called whenever the player's melee lands. */
  onHit(e, info) {
    const g = this.game;
    const p = g.player;
    const ch = this.power('chain');
    if (ch > 0 && info.source === 'melee' && Math.random() < 0.18 + ch * 0.05) {
      let from = e;
      const hit = new Set([e]);
      const jumps = 2 + Math.floor(ch);
      for (let k = 0; k < jumps; k++) {
        let best = null, bd = 9;
        g.forEnemiesNear(from.x, from.z, 9, (o) => {
          if (hit.has(o) || !o.alive) return;
          const d = Math.hypot(o.x - from.x, o.z - from.z);
          if (d < bd) { bd = d; best = o; }
        });
        if (!best) break;
        hit.add(best);
        g.lightning(from.x, from.y + 1.2 * from.size, from.z, best.x, best.y + 1.2 * best.size, best.z, [0.6, 0.85, 1]);
        g.damageEnemy(best, { dmg: 9 * ch * p.stats.dmgMul, dirX: 0, dirZ: 0, kb: 1, source: 'chain', color: [0.6, 0.85, 1] });
        from = best;
      }
      g.audio.play('zap');
    }
    const ec = this.power('echo');
    if (ec > 0 && info.source === 'melee' && Math.random() < 0.15 + ec * 0.05) {
      this.echoQueue.push({ e, t: 0.35, dmg: info.dmg * (0.4 + ec * 0.1), dirX: info.dirX, dirZ: info.dirZ });
    }
  }

  onKill(e) {
    const g = this.game;
    const p = g.player;
    const nv = this.power('nova');
    if (nv > 0 && Math.random() < 0.12 + nv * 0.04) {
      g.addHazard({ x: e.x, z: e.z, r: (2.8 + nv * 0.3) * p.stats.areaMul, t: 0.01, dmg: 18 * nv * p.stats.dmgMul, kind: 'nova', owner: 'player', color: [0.9, 0.1, 0.15] });
    }
  }

  onHeavy(x, z) {
    const sg = this.power('singularity');
    if (sg <= 0) return;
    const g = this.game;
    g.addWell({ x, z, r: (4 + sg * 0.5) * g.player.stats.areaMul, t: 2 + sg * 0.25, dps: 8 * sg * g.player.stats.dmgMul });
  }

  onDodge(p) {
    const em = this.power('emberstep');
    if (em <= 0) return;
    const g = this.game;
    for (let i = 0; i < 4; i++) {
      g.addHazard({ x: p.x + p.dodgeDir[0] * i * 1.4, z: p.z + p.dodgeDir[1] * i * 1.4, r: 1.6, t: 0.15 + i * 0.08, dmg: 10 * em * p.stats.dmgMul, kind: 'fire', owner: 'player', color: [1, 0.45, 0.1], burn: 5 * em });
    }
  }

  draw(R) {
    const g = this.game;
    const p = g.player;
    const orb = this.power('orbitals');
    if (orb > 0) {
      const n = Math.min(8, 1 + Math.floor(orb));
      const r = 2.4 * p.stats.areaMul;
      for (let i = 0; i < n; i++) {
        const a = this.orbAngle + (i / n) * TAU;
        const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r, y = p.y + 1.1 + Math.sin(a * 2) * 0.15;
        R.trs(PRIM.OCTA, x, y, z, a * 2, 0.4, 0, 0.12, 0.3, 0.12, [0.55, 0.3, 1], 0.9);
        g.particles.emit({ x, y, z, life: 0.3, size: 0.16, size1: 0, color: [0.5, 0.25, 1], alpha: 0.6, shape: SHAPE.GLOW });
      }
      R.light(p.x, p.y + 1.2, p.z, 6, 0.6, 0.4, 1, 0.6);
    }
    if (this.power('gaze') > 0 && this.eyePos) {
      const [x, y, z] = this.eyePos;
      R.ball(x, y, z, 0.17, [0.8, 0.74, 0.68], 0.05, true);
      for (let k = 0; k < 3; k++) {
        const a = g.time * 2 + k * 2.1;
        R.seg(x, y - 0.1, z, x + Math.cos(a) * 0.15, y - 0.45 - Math.sin(g.time * 3 + k) * 0.05, z + Math.sin(a) * 0.15, 0.015, [0.5, 0.1, 0.2], 0.2);
      }
      const tx = this.gazeBeam?.e.x ?? p.x + Math.sin(p.yaw) * 5, tz = this.gazeBeam?.e.z ?? p.z + Math.cos(p.yaw) * 5;
      const dx = tx - x, dz = tz - z, l = Math.hypot(dx, dz) || 1;
      R.ball(x + (dx / l) * 0.13, y - 0.02, z + (dz / l) * 0.13, 0.075, [1, 0.3, 0.6], 2);
      if (this.gazeBeam) {
        const e = this.gazeBeam.e;
        R.seg(x, y, z, e.x, e.y + 1 * e.size, e.z, 0.08 + this.gazeBeam.t * 0.5, [1, 0.4, 0.7], 4);
        R.light(e.x, e.y + 1, e.z, 5, 1, 0.3, 0.6, 2);
      }
    }
  }
}
