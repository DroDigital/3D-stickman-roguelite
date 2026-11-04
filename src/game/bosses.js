// Boss encounters. Each boss is an Enemy-compatible type definition with phases and bespoke attacks.
import { Topology } from './rig.js';
import { HumanoidAnimator, humanoidTopology, CLIPS, STANCE, J } from './humanoid.js';
import { PRIM } from '../gfx/renderer.js';
import { SHAPE } from '../gfx/particles.js';
import { TAU, lerp } from '../core/math.js';

const pal = (c, e = 0) => ({ c, e });

function toPlayer(e, game) {
  const p = game.player;
  const dx = p.x - e.x, dz = p.z - e.z;
  const d = Math.hypot(dx, dz) || 1e-4;
  return { dx: dx / d, dz: dz / d, d };
}

// ================================================================== The Hollow Shepherd
const shepherd = {
  boss: true,
  name: 'The Hollow Shepherd',
  title: 'Keeper of the Burnt Flock',
  hp: 3200, dmg: 28, speed: 3.4, radius: 1.6, size: 3.4, xp: 300, shard: 60, poise: true, spawnTime: 2.2, body: 'shepherd',
  palette: (dim) => [pal(dim.id === 'flesh' ? [0.55, 0.22, 0.2] : [0.42, 0.36, 0.32], 0.08), pal([0.85, 0.8, 0.7], 0.1)],
  init(e, game) {
    e.topo = humanoidTopology(0.05, 0.13, { headSlot: 1 });
    e.anim = new HumanoidAnimator(e.size, STANCE.heavy);
    e.anim.style = 'normal';
    e.pts = e.anim.pts;
    e.pattern = 0;
    e.phase2 = false;
    e.name = game.dim.id === 'flesh' ? 'The Flayed Shepherd' : 'The Hollow Shepherd';
  },
  onInterrupt(e) { e.doSlam = false; e.summon = false; },
  think(e, dt, game) {
    if (!e.phase2 && e.hp < e.maxHp * 0.5) {
      e.phase2 = true;
      game.bossRoar(e, 'The Shepherd tears off its mask of bark');
      e.speed *= 1.25;
    }
    if (e.state !== 'chase') { e.mvx = e.mvz = 0; return; }
    const t = toPlayer(e, game);
    e.wantYaw = Math.atan2(t.dx, t.dz);
    e.mvx = t.d > 4 ? t.dx * e.speed : 0;
    e.mvz = t.d > 4 ? t.dz * e.speed : 0;
    if (e.atkCd > 0) return;
    const pick = e.pattern++ % (e.phase2 ? 5 : 4);
    const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
    if (pick === 0 || pick === 3) {
      // staff sweep: big frontal half-ring
      e.windup(1.1, false);
      e.anim.play(CLIPS.reap, (CLIPS.reap.hitT * CLIPS.reap.dur) / 1.1);
      for (let i = -2; i <= 2; i++) {
        const a = e.yaw + i * 0.38;
        game.addHazard({ x: e.x + Math.sin(a) * 4.6, z: e.z + Math.cos(a) * 4.6, r: 2.6, t: 1.1, dmg: e.dmg, kind: 'slam', owner: 'enemy', color: [1, 0.2, 0.1], src: e });
      }
      e.next = 1.4;
    } else if (pick === 1) {
      // lantern slam: counterable
      e.windup(1.0, true);
      e.anim.play(CLIPS.slam, (CLIPS.slam.hitT * CLIPS.slam.dur) / 1.0);
      e.slamAt = [e.x + fx * 5, e.z + fz * 5];
      e.next = 1.2;
      e.doSlam = true;
    } else if (pick === 2) {
      // summon the flock
      e.windup(1.2, false);
      e.anim.play(CLIPS.cast, CLIPS.cast.dur / 1.2);
      e.summon = true;
      e.next = 1.0;
    } else {
      // phase 2: line of hellfire pillars toward the player
      e.windup(0.8, false);
      e.anim.play(CLIPS.cast, CLIPS.cast.dur / 0.8);
      for (let k = 0; k < 9; k++) {
        const dd = 3 + k * 2.4;
        for (const off of [-0.25, 0, 0.25]) {
          const a = Math.atan2(t.dx, t.dz) + off * (k > 0 ? 1 : 0);
          if (off !== 0 && k % 2) continue;
          game.addHazard({ x: e.x + Math.sin(a) * dd, z: e.z + Math.cos(a) * dd, r: 1.8, t: 0.9 + k * 0.12, dmg: e.dmg * 0.8, kind: 'pillar', owner: 'enemy', color: [1, 0.45, 0.1], src: e });
        }
      }
      e.next = 1.2;
    }
  },
  strike(e, game) {
    if (e.doSlam) {
      e.doSlam = false;
      game.addHazard({ x: e.slamAt[0], z: e.slamAt[1], r: 4.5, t: 0.01, dmg: e.dmg * 1.3, kind: 'slam', owner: 'enemy', color: [1, 0.6, 0.2] });
      game.shake(0.8);
    }
    if (e.summon) {
      e.summon = false;
      const n = e.phase2 ? 6 : 4;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        game.spawnEnemy(game.dim.id === 'flesh' ? 'hound' : 'husk', game.player.x + Math.cos(a) * 7, game.player.z + Math.sin(a) * 7, {});
      }
    }
    e.recover(e.next || 1);
    e.atkCd = e.phase2 ? 0.6 : 1.2;
  },
  animate(e, dt, game) {
    const c = Math.cos(e.yaw), s = Math.sin(e.yaw);
    e.anim.update(dt, {
      fwdSpeed: e.vx * s + e.vz * c, sideSpeed: e.vx * c - e.vz * s, combat: 1,
      x: e.x, y: e.y, z: e.z, yaw: e.yaw, ground: (x, z) => game.world.height(x, z),
    });
  },
  draw(e, R, game) {
    const p = e.pts;
    const hx = p[J.HEAD * 3], hy = p[J.HEAD * 3 + 1], hz = p[J.HEAD * 3 + 2];
    const bone = [0.85, 0.8, 0.7];
    // antlers
    for (const side of [-1, 1]) {
      const c = Math.cos(e.yaw), s = Math.sin(e.yaw);
      let x = hx + side * 0.2 * c, y = hy + 0.25, z = hz - side * 0.2 * s;
      let dx = side * c * 0.6, dy = 1, dz = -side * s * 0.6;
      let len = 1.2, r = 0.09;
      for (let k = 0; k < 4; k++) {
        const nx = x + dx * len, ny = y + dy * len, nz = z + dz * len;
        R.seg(x, y, z, nx, ny, nz, r, bone, 0.05);
        R.segPrim(PRIM.CONE, nx, ny, nz, nx + (dx * 0.3 - s * 0.4) * len, ny + 0.5 * len, nz + (dz * 0.3 - c * 0.4) * len, r * 0.8, bone);
        x = nx; y = ny; z = nz;
        dx *= 1.25; len *= 0.75; r *= 0.75;
      }
    }
    // hollow face
    R.ball(hx + Math.sin(e.yaw) * 0.25, hy, hz + Math.cos(e.yaw) * 0.25, 0.3, [0.01, 0, 0.01], 0);
    const eye = e.phase2 ? [1, 0.25, 0.05] : game.dim.env.moonCol;
    for (const side of [-1, 1]) {
      const c = Math.cos(e.yaw), s = Math.sin(e.yaw);
      R.ball(hx + side * 0.13 * c + s * 0.48, hy + 0.05, hz - side * 0.13 * s + c * 0.48, 0.07, eye, 4);
    }
    // lantern staff
    const rx = p[J.RHA * 3], ry = p[J.RHA * 3 + 1], rz = p[J.RHA * 3 + 2];
    const w = e.anim.wdir;
    const L = 6.5;
    const tx = rx + w[0] * L * 0.7, ty = ry + w[1] * L * 0.7, tz = rz + w[2] * L * 0.7;
    R.seg(rx - w[0] * L * 0.3, ry - w[1] * L * 0.3, rz - w[2] * L * 0.3, tx, ty, tz, 0.09, [0.15, 0.1, 0.08]);
    R.segPrim(PRIM.CONE, tx, ty, tz, tx + w[0] * 0.5 + 0.4, ty + w[1] * 0.5, tz + w[2] * 0.5, 0.12, bone);
    const lx = tx + 0.0, ly = ty - 0.8, lz = tz;
    R.seg(tx, ty, tz, lx, ly, lz, 0.02, [0.3, 0.3, 0.3]);
    R.trs(PRIM.OCTA, lx, ly - 0.35, lz, game.time, 0, 0, 0.35, 0.55, 0.35, [0.2, 0.18, 0.15], 0);
    R.ball(lx, ly - 0.35, lz, 0.22, eye, 4);
    R.light(lx, ly - 0.35, lz, 18, eye[0], eye[1], eye[2], 2.2);
    if (Math.random() < 0.6) game.particles.emit({ x: lx, y: ly - 0.2, z: lz, vx: (Math.random() - 0.5), vy: 1.5, vz: (Math.random() - 0.5), life: 1, size: 0.2, size1: 0, color: eye });
    // tattered robe streamers from chest
    const cx = p[J.CHEST * 3], cy = p[J.CHEST * 3 + 1], cz = p[J.CHEST * 3 + 2];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU;
      const sw = Math.sin(game.time * 2 + i) * 0.4;
      const ox = Math.cos(a) * 0.5, oz = Math.sin(a) * 0.5;
      R.seg(cx + ox, cy, cz + oz, cx + ox * 1.6 + sw - e.vx * 0.1, cy - 3.2, cz + oz * 1.6 - e.vz * 0.1, 0.07, [0.08, 0.06, 0.07]);
    }
  },
};

// ================================================================== The Tidewyrm (Leviathan)
const SEGS = 26;
const leviathan = {
  boss: true,
  name: 'Tidewyrm of the Drowned Choir',
  title: 'It sings with a thousand drowned mouths',
  hp: 3000, dmg: 26, speed: 11, radius: 2.0, size: 1, xp: 300, shard: 60, poise: true, spawnTime: 0.2, stationary: false,
  palette: (dim) => [pal([0.1, 0.24, 0.26], 0.05), pal([0.62, 0.7, 0.66], 0.05), pal(dim.env.moonCol, 0.7)],
  init(e, game) {
    const segs = [];
    for (let i = 0; i < SEGS - 1; i++) {
      const k = i / SEGS;
      segs.push([i, i + 1, 0.95 * (1 - k * 0.75) + 0.15, i % 3 === 0 ? 1 : 0]);
    }
    // jaws: points SEGS..SEGS+3
    segs.push([0, SEGS, 0.25, 1], [0, SEGS + 1, 0.25, 1], [SEGS, SEGS + 2, 0.12, 1], [SEGS + 1, SEGS + 3, 0.12, 1]);
    const balls = [[0, 1.15, 0, 1]];
    for (let i = 2; i < SEGS; i += 2) balls.push([i, 1.0 * (1 - i / SEGS * 0.75) + 0.12, i % 4 === 0 ? 2 : 0, 0]);
    e.topo = new Topology(SEGS + 4, segs, balls);
    e.pts = new Float32Array((SEGS + 4) * 3);
    e.hx = e.x; e.hy = game.world.height(e.x, e.z) - 4; e.hz = e.z;
    e.hvx = 0; e.hvy = 0; e.hvz = 0;
    for (let i = 0; i < SEGS; i++) { e.pts[i * 3] = e.x; e.pts[i * 3 + 1] = e.hy - i * 0.5; e.pts[i * 3 + 2] = e.z; }
    e.mode = 'submerged';
    e.modeT = 2;
    e.atk = null;
    e.breaches = 0;
    e.jaw = 0;
    e.phase2 = false;
  },
  think(e, dt, game) {
    const W = game.world;
    const p = game.player;
    if (!e.phase2 && e.hp < e.maxHp * 0.5) { e.phase2 = true; game.bossRoar(e, 'The Tidewyrm\'s choir rises to a scream'); }
    e.modeT -= dt;
    e.mvx = e.mvz = 0;
    const ground = W.height(e.hx, e.hz);
    if (e.mode === 'submerged') {
      // tunnel toward player, leaving a wake
      const dx = p.x - e.hx, dz = p.z - e.hz, d = Math.hypot(dx, dz) || 1;
      e.hvx = (dx / d) * 13; e.hvz = (dz / d) * 13;
      e.hx += e.hvx * dt; e.hz += e.hvz * dt;
      e.hy = lerp(e.hy, W.height(e.hx, e.hz) - 5, dt * 3);
      if (Math.random() < 0.7) game.particles.emit({ x: e.hx + (Math.random() - 0.5) * 2, y: W.height(e.hx, e.hz) + 0.1, z: e.hz + (Math.random() - 0.5) * 2, vy: 3 + Math.random() * 3, life: 0.6, size: 0.15, color: game.dim.ash, shape: SHAPE.CHUNK, grav: 12, additive: false });
      if (e.modeT <= 0) {
        // telegraph breach under the player
        e.mode = 'telegraph';
        e.modeT = 1.1;
        e.bx = p.x + p.vx * 0.5; e.bz = p.z + p.vz * 0.5;
        game.addHazard({ x: e.bx, z: e.bz, r: 4.2, t: 1.1, dmg: e.dmg * 1.2, kind: 'slam', owner: 'enemy', color: [0.2, 1, 0.8], src: e });
        if (e.phase2) for (let i = 0; i < 3; i++) {
          const a = Math.random() * TAU;
          game.addHazard({ x: e.bx + Math.cos(a) * 7, z: e.bz + Math.sin(a) * 7, r: 2.5, t: 1.4 + i * 0.2, dmg: e.dmg * 0.7, kind: 'pillar', owner: 'enemy', color: [0.2, 1, 0.8], src: e });
        }
      }
    } else if (e.mode === 'telegraph') {
      e.hx = lerp(e.hx, e.bx, dt * 6); e.hz = lerp(e.hz, e.bz, dt * 6);
      if (e.modeT <= 0) {
        e.mode = 'breach';
        const a = Math.random() * TAU;
        e.hx = e.bx; e.hz = e.bz; e.hy = W.height(e.bx, e.bz) - 1;
        e.hvx = Math.cos(a) * 7; e.hvz = Math.sin(a) * 7; e.hvy = 19;
        game.shake(0.9);
        game.audio.play('roar');
        game.particles.burst(e.hx, e.hy + 1, e.hz, 60, { speed: 12, color: game.dim.ash, shape: SHAPE.CHUNK, size: 0.18, life: 1.4, grav: 18, bounce: 0.3, additive: false });
        game.particles.burst(e.hx, e.hy + 1, e.hz, 40, { speed: 9, color: game.dim.env.moonCol, shape: SHAPE.SPARK, size: 0.1, life: 0.9, grav: 6 });
      }
    } else if (e.mode === 'breach') {
      e.hvy -= 18 * dt;
      e.hx += e.hvx * dt; e.hy += e.hvy * dt; e.hz += e.hvz * dt;
      e.jaw = 1;
      if (e.hy < W.height(e.hx, e.hz) - 2 && e.hvy < 0) {
        e.breaches++;
        game.shake(0.5);
        if (e.breaches >= (e.phase2 ? 3 : 2)) {
          e.mode = 'surface'; e.modeT = 9; e.breaches = 0;
          e.hy = W.height(e.hx, e.hz) + 1.5;
        } else { e.mode = 'submerged'; e.modeT = 1.6; }
      }
    } else if (e.mode === 'surface') {
      // slither in a wide circle around the player, spitting and lunging
      const dx = p.x - e.hx, dz = p.z - e.hz, d = Math.hypot(dx, dz) || 1;
      const tx = -dz / d, tz = dx / d;
      const pull = d > 12 ? 1 : d < 7 ? -0.8 : 0;
      if (e.state === 'chase') {
        e.hvx = lerp(e.hvx, (tx + (dx / d) * pull) * 9, dt * 3);
        e.hvz = lerp(e.hvz, (tz + (dz / d) * pull) * 9, dt * 3);
      } else if (e.state === 'attack') {
        // lunge
      } else { e.hvx *= 0.9; e.hvz *= 0.9; }
      e.hx += e.hvx * dt; e.hz += e.hvz * dt;
      e.hy = lerp(e.hy, W.height(e.hx, e.hz) + 1.6 + (e.state === 'windup' ? 1.2 : 0), dt * 5);
      if (e.state === 'chase' && e.atkCd <= 0) {
        if (Math.random() < 0.5) { e.windup(0.9, true); e.atk = 'bite'; } else { e.windup(0.7, false); e.atk = 'spit'; }
      }
      if (e.modeT <= 0 && e.state === 'chase') { e.mode = 'submerged'; e.modeT = 2.2; }
    }
    W.clampToBounds({ get x() { return e.hx; }, set x(v) { e.hx = v; }, get z() { return e.hz; }, set z(v) { e.hz = v; } });
    e.x = e.hx; e.z = e.hz;
    e.wantYaw = Math.atan2(e.hvx, e.hvz);
    e.surfaced = e.hy > ground - 0.5;
    e.untargetable = !e.surfaced;
  },
  onInterrupt(e) { e.atk = null; },
  strike(e, game) {
    const p = game.player;
    if (!e.atk) { e.recover(0.5); return; }
    if (e.atk === 'bite') {
      const dx = p.x - e.hx, dz = p.z - e.hz, d = Math.hypot(dx, dz) || 1;
      e.hvx = (dx / d) * 24; e.hvz = (dz / d) * 24;
      e.state = 'attack'; e.stateT = 0.35; e.bit = false;
      e.onAttackEnd = () => { e.recover(0.8); e.atkCd = 1.2; };
    } else {
      const n = e.phase2 ? 9 : 5;
      for (let i = 0; i < n; i++) {
        const a = Math.atan2(p.x - e.hx, p.z - e.hz) + (i - (n - 1) / 2) * 0.16;
        game.spawnProjectile({ x: e.hx, y: e.hy + 0.5, z: e.hz, vx: Math.sin(a) * 15, vy: 1.5, vz: Math.cos(a) * 15, grav: 4, r: 0.45, dmg: e.dmg * 0.6, life: 2.5, owner: 'enemy', color: game.dim.env.moonCol, kind: 'bolt' });
      }
      game.audio.play('bolt');
      e.recover(0.6);
      e.atkCd = 1.0;
    }
  },
  hitTest(e, x, z, r) {
    if (!e.surfaced && e.mode !== 'breach') return false;
    const P = e.pts;
    for (let i = 0; i < SEGS; i += 2) {
      const dx = P[i * 3] - x, dz = P[i * 3 + 2] - z;
      if (dx * dx + dz * dz < (r + 1.2) * (r + 1.2)) return true;
    }
    return false;
  },
  animate(e, dt, game) {
    const P = e.pts;
    if (e.state === 'attack' && !e.bit) {
      const p = game.player;
      if (Math.hypot(p.x - e.hx, p.z - e.hz) < 2.5) { e.bit = true; game.damagePlayer(e.dmg, e); }
    }
    e.jaw = lerp(e.jaw, e.state === 'windup' || e.state === 'attack' || e.mode === 'breach' ? 1 : 0.15, Math.min(1, dt * 8));
    P[0] = e.hx; P[1] = e.hy; P[2] = e.hz;
    const segLen = 1.15;
    for (let i = 1; i < SEGS; i++) {
      const o = i * 3, q = (i - 1) * 3;
      let dx = P[o] - P[q], dy = P[o + 1] - P[q + 1], dz = P[o + 2] - P[q + 2];
      const d = Math.hypot(dx, dy, dz) || 1;
      // undulation
      const und = Math.sin(game.time * 4 - i * 0.6) * 0.08;
      P[o] = P[q] + (dx / d) * segLen + und * -dz / d;
      P[o + 1] = P[q + 1] + (dy / d) * segLen;
      P[o + 2] = P[q + 2] + (dz / d) * segLen + und * dx / d;
      // body rests on ground when surfaced, sinks when submerged
      const g = game.world.height(P[o], P[o + 2]);
      if (e.mode === 'surface' && P[o + 1] < g + 0.6) P[o + 1] = lerp(P[o + 1], g + 0.6, 0.3);
    }
    // jaws
    const yaw = Math.atan2(P[0] - P[3], P[2] - P[5]);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const j = e.jaw;
    const setp = (i, x, y, z) => { P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z; };
    setp(SEGS, e.hx + fx * 1.6, e.hy + 0.25 + j * 0.9, e.hz + fz * 1.6);
    setp(SEGS + 1, e.hx + fx * 1.6, e.hy - 0.25 - j * 0.9, e.hz + fz * 1.6);
    setp(SEGS + 2, e.hx + fx * 2.4, e.hy + 0.1 + j * 1.4, e.hz + fz * 2.4);
    setp(SEGS + 3, e.hx + fx * 2.4, e.hy - 0.1 - j * 1.4, e.hz + fz * 2.4);
    e.headYaw = yaw;
  },
  draw(e, R, game) {
    const P = e.pts;
    const fx = Math.sin(e.headYaw || 0), fz = Math.cos(e.headYaw || 0);
    const glow = game.dim.env.moonCol;
    // eyes cluster
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      R.ball(P[0] + fx * 0.6 + Math.cos(a) * -fz * 0.7, P[1] + 0.7 + Math.sin(a) * 0.25, P[2] + fz * 0.6 + Math.cos(a) * fx * 0.7, 0.13, glow, 3);
    }
    // teeth
    for (const side of [SEGS, SEGS + 1]) {
      for (let k = 0; k < 5; k++) {
        const t = k / 4;
        const x = lerp(P[0], P[side * 3], t), y = lerp(P[1], P[side * 3 + 1], t), z = lerp(P[2], P[side * 3 + 2], t);
        const dir = side === SEGS ? -1 : 1;
        R.segPrim(PRIM.CONE, x, y, z, x, y + dir * 0.45, z, 0.07, [0.95, 0.92, 0.85]);
      }
    }
    // dorsal fins
    for (let i = 2; i < SEGS - 2; i += 2) {
      const o = i * 3;
      R.segPrim(PRIM.CONE, P[o], P[o + 1] + 0.6, P[o + 2], P[o], P[o + 1] + 1.6 * (1 - i / SEGS), P[o + 2], 0.18, [0.1, 0.35, 0.35], 0.2);
    }
    if (e.surfaced || e.mode === 'breach') R.light(P[0], P[1] + 1.5, P[2], 16, glow[0], glow[1], glow[2], 1.6);
  },
};

// ================================================================== Oculus Primordial
const oculus = {
  boss: true,
  name: 'Oculus Primordial',
  title: 'The Unblinking, Who Watches Between Stars',
  hp: 2800, dmg: 22, speed: 4.5, radius: 3.0, size: 1, xp: 300, shard: 60, poise: true, spawnTime: 2.0, flying: true,
  palette: (dim) => [pal([0.9, 0.86, 0.8], 0.1), pal([0.3, 0.1, 0.25], 0.2)],
  init(e, game) {
    const n = 6, segPer = 6;
    const segs = [];
    for (let t = 0; t < n; t++) {
      const b = 1 + t * segPer;
      segs.push([0, b, 0.25, 1]);
      for (let k = 0; k < segPer - 1; k++) segs.push([b + k, b + k + 1, 0.2 - k * 0.03, 1]);
    }
    e.topo = new Topology(1 + n * segPer, segs, [[0, 3.0, 0, 1]]);
    e.pts = new Float32Array((1 + n * segPer) * 3);
    e.hover = 4.2;
    e.pattern = 0;
    e.beam = null;
    e.blink = 0;
    e.phase2 = false;
    e.minions = [];
  },
  think(e, dt, game) {
    const p = game.player;
    if (!e.phase2 && e.hp < e.maxHp * 0.5) { e.phase2 = true; game.bossRoar(e, 'The Oculus splits its gaze'); }
    if (e.burstWaves > 0) {
      e.burstT -= dt;
      if (e.burstT <= 0) {
        const w = e.burstIndex++;
        e.burstWaves--;
        e.burstT = 0.42;
        const n = 14;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + w * 0.22;
          game.spawnProjectile({ x: e.x, y: e.y + e.hover - 1, z: e.z, vx: Math.sin(a) * 10, vy: -1.2, vz: Math.cos(a) * 10, r: 0.4, dmg: e.dmg * 0.6, life: 4, owner: 'enemy', color: [0.85, 0.5, 1], kind: 'bolt', groundSkim: true });
        }
        game.audio.play('bolt');
      }
    }
    const t = toPlayer(e, game);
    e.wantYaw = Math.atan2(t.dx, t.dz);
    if (e.state === 'chase') {
      const fwd = t.d > 12 ? 1 : t.d < 7 ? -0.7 : 0;
      e.mvx = (t.dx * fwd - t.dz * 0.5) * e.speed;
      e.mvz = (t.dz * fwd + t.dx * 0.5) * e.speed;
    } else { e.mvx = e.mvz = 0; }
    // beam sweep
    if (e.beam) {
      const b = e.beam;
      b.t += dt;
      if (b.t > b.warn) {
        b.ang += b.spin * dt;
        const ex = e.x, ez = e.z;
        const bx = Math.sin(b.ang), bz = Math.cos(b.ang);
        const px = p.x - ex, pz = p.z - ez;
        const along = px * bx + pz * bz;
        const perp = Math.abs(px * bz - pz * bx);
        if (along > 0 && along < 34 && perp < 1.2 && !p.invuln()) game.damagePlayer(e.dmg * dt * 2.2, e, { tick: true });
      }
      if (b.t > b.warn + b.dur) e.beam = null;
    }
    if (e.state !== 'chase' || e.atkCd > 0 || e.beam) return;
    const pick = e.pattern++ % (e.phase2 ? 4 : 3);
    if (pick === 0) {
      e.windup(0.4, false);
      e.beam = { t: 0, warn: 1.1, dur: e.phase2 ? 3.2 : 2.4, ang: Math.atan2(t.dx, t.dz) - 0.5, spin: (Math.random() < 0.5 ? 1 : -1) * (e.phase2 ? 0.7 : 0.5) };
      if (e.beam.spin < 0) e.beam.ang += 1;
      e.next = e.beam.warn + e.beam.dur;
    } else if (pick === 1) {
      e.windup(0.9, false);
      e.burst = e.phase2 ? 4 : 3;
      e.next = 0.4;
    } else if (pick === 2) {
      // eye rain: hazards around the player
      e.windup(0.6, false);
      const n = e.phase2 ? 9 : 6;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, r = Math.random() * 7;
        game.addHazard({ x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r, r: 2.2, t: 1.0 + i * 0.15, dmg: e.dmg, kind: 'pillar', owner: 'enemy', color: [0.85, 0.4, 1], src: e });
      }
      e.next = 1.4;
    } else {
      // counterable gaze: dive at the player
      e.windup(1.0, true);
      e.dive = true;
      e.next = 1.2;
    }
  },
  strike(e, game) {
    const p = game.player;
    if (e.burst) {
      e.burstWaves = e.burst;
      e.burstIndex = 0;
      e.burstT = 0;
      e.burst = 0;
    }
    if (e.dive) {
      e.dive = false;
      game.addHazard({ x: p.x, z: p.z, r: 3.5, t: 0.01, dmg: e.dmg * 1.4, kind: 'slam', owner: 'enemy', color: [0.85, 0.4, 1] });
      e.x = p.x - Math.sin(e.yaw) * 3; e.z = p.z - Math.cos(e.yaw) * 3;
      game.shake(0.6);
    }
    if (e.phase2 && Math.random() < 0.4 && game.enemies.length < 30) {
      for (let i = 0; i < 2; i++) game.spawnEnemy('gazer', e.x + (Math.random() - 0.5) * 8, e.z + (Math.random() - 0.5) * 8, { instant: true });
    }
    e.recover(e.next || 1);
    e.atkCd = e.phase2 ? 0.7 : 1.2;
  },
  hitTest(e, x, z, r) {
    return Math.hypot(e.x - x, e.z - z) < r + 3.1;
  },
  onInterrupt(e) { e.dive = false; e.burst = 0; },
  animate(e, dt, game) {
    const P = e.pts;
    const y = e.y + e.hover + Math.sin(game.time * 1.2) * 0.4 - (e.state === 'stagger' ? 2.2 : 0);
    e.cy = y;
    P[0] = e.x; P[1] = y; P[2] = e.z;
    const n = 6, segPer = 6;
    for (let t = 0; t < n; t++) {
      const a = (t / n) * TAU + game.time * 0.3;
      let px = e.x + Math.cos(a) * 2.6, py = y - 1.2, pz = e.z + Math.sin(a) * 2.6;
      for (let k = 0; k < segPer; k++) {
        const sw = Math.sin(game.time * 1.8 + t + k * 0.6);
        px += Math.cos(a + sw * 0.5) * 0.7;
        pz += Math.sin(a + sw * 0.5) * 0.7;
        py = Math.max(game.world.height(px, pz) + 0.2, py - 0.55 + sw * 0.2);
        const i = 1 + t * segPer + k;
        P[i * 3] = px; P[i * 3 + 1] = py; P[i * 3 + 2] = pz;
      }
    }
  },
  draw(e, R, game) {
    const p = game.player;
    const cy = e.cy;
    let dx = p.x - e.x, dy = p.y + 1 - cy, dz = p.z - e.z;
    if (e.beam && e.beam.t > 0) {
      const b = e.beam;
      dx = Math.sin(b.ang) * 10; dz = Math.cos(b.ang) * 10; dy = -cy + e.y;
    }
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    const iris = [0.85, 0.3, 1];
    R.segPrim(PRIM.ORB, e.x + dx * 2.4, cy + dy * 2.4, e.z + dz * 2.4, e.x + dx * 2.95, cy + dy * 2.95, e.z + dz * 2.95, 1.35, iris, 1.2);
    R.segPrim(PRIM.ORB, e.x + dx * 2.85, cy + dy * 2.85, e.z + dz * 2.85, e.x + dx * 3.1, cy + dy * 3.1, e.z + dz * 3.1, 0.55, [0.02, 0, 0.03], 0);
    // orbiting rings of smaller eyes
    for (let r = 0; r < 2; r++) {
      const n = 10 + r * 4;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + game.time * (r ? -0.4 : 0.6);
        const rad = 4.2 + r * 1.3;
        const tilt = r ? 0.5 : -0.3;
        const x = e.x + Math.cos(a) * rad, z = e.z + Math.sin(a) * rad * Math.cos(tilt), y = cy + Math.sin(a) * rad * Math.sin(tilt);
        R.ball(x, y, z, 0.28, [0.9, 0.85, 0.8], 0.2);
        R.ball(x + (p.x - x) * 0.02, y + 0.02, z + (p.z - z) * 0.02, 0.13, iris, 2.5);
      }
    }
    R.light(e.x, cy, e.z, 22, iris[0], iris[1], iris[2], 2);
    // beam
    if (e.beam) {
      const b = e.beam;
      const bx = Math.sin(b.ang), bz = Math.cos(b.ang);
      const gy = game.world.height(e.x, e.z);
      if (b.t < b.warn) {
        R.decal(e.x + bx * 17, gy + 0.1, e.z + bz * 17, 1.2, 1, 0.2, 0.8, 0.35 + 0.3 * Math.sin(game.time * 20), 7, -b.ang + Math.PI, 14);
      } else {
        const ex = e.x + bx * 34, ez = e.z + bz * 34;
        for (let k = 0; k < 12; k++) {
          const t0 = k / 12, t1 = (k + 1) / 12;
          const x0 = lerp(e.x, ex, t0), z0 = lerp(e.z, ez, t0), x1 = lerp(e.x, ex, t1), z1 = lerp(e.z, ez, t1);
          const y0 = k === 0 ? cy : game.world.height(x0, z0) + 0.8, y1 = game.world.height(x1, z1) + 0.8;
          R.seg(x0, y0, z0, x1, y1, z1, 0.32 + Math.sin(game.time * 40 + k) * 0.06, [0.95, 0.35, 0.9], 1.8);
        }
        for (let k = 0; k < 4; k++) {
          const t = Math.random();
          const x = lerp(e.x, ex, t), z = lerp(e.z, ez, t);
          game.particles.emit({ x, y: game.world.height(x, z) + 0.2, z, vx: (Math.random() - 0.5) * 6, vy: 4 + Math.random() * 4, vz: (Math.random() - 0.5) * 6, life: 0.5, size: 0.08, color: [1, 0.6, 1], shape: SHAPE.SPARK, grav: 10 });
        }
        R.light(e.x + bx * 10, gy + 1, e.z + bz * 10, 20, 1, 0.5, 1, 2.5);
      }
    }
  },
};

export const BOSSES = { shepherd, leviathan, oculus };
