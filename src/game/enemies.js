// Enemy base class + creature roster. Each type defines a rig, procedural animation, AI and attacks.
import { Topology, drawRig, drawFlesh } from './rig.js';
import { Anatomy, BODIES, castBody, drawBody } from './anatomy.js';
import { HumanoidAnimator, humanoidTopology, CLIPS, STANCE, J } from './humanoid.js';
import { Legs } from './legs.js';
import { PRIM } from '../gfx/renderer.js';
import { SHAPE } from '../gfx/particles.js';
import { dampAngle, mixRgb, TAU, lerp } from '../core/math.js';

const pal = (c, e = 0) => ({ c, e });

// ------------------------------------------------------------------ shared helpers
function toPlayer(e, game) {
  const p = game.player;
  const dx = p.x - e.x, dz = p.z - e.z;
  const d = Math.hypot(dx, dz) || 1e-4;
  return { dx: dx / d, dz: dz / d, d };
}

function chase(e, game, speed, stopAt = 0) {
  const t = toPlayer(e, game);
  const s = t.d > stopAt ? speed : 0;
  e.mvx = t.dx * s; e.mvz = t.dz * s;
  e.wantYaw = Math.atan2(t.dx, t.dz);
  return t;
}

function strafe(e, game, speed, minD, maxD) {
  const t = toPlayer(e, game);
  let fwd = 0;
  if (t.d < minD) fwd = -1; else if (t.d > maxD) fwd = 1;
  const side = Math.sin(e.seed + game.time * 0.5) > 0 ? 1 : -1;
  e.mvx = (t.dx * fwd + -t.dz * side * 0.6) * speed;
  e.mvz = (t.dz * fwd + t.dx * side * 0.6) * speed;
  e.wantYaw = Math.atan2(t.dx, t.dz);
  return t;
}

function inFront(e, game, range, arcDeg) {
  const t = toPlayer(e, game);
  if (t.d > range + game.player.radius) return false;
  const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
  return t.dx * fx + t.dz * fz >= Math.cos((arcDeg * Math.PI) / 360);
}

function drawEyes(R, x, y, z, yaw, size, col, spread = 0.07, fwd = 0.14) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (const side of [-1, 1]) {
    const ox = side * spread * size, oz = fwd * size;
    R.ball(x + ox * c + oz * s, y, z - ox * s + oz * c, 0.035 * size, col, 3);
  }
}

// ------------------------------------------------------------------ humanoid helper
function humanoidRig(e, size, stance, style, limb = 0.045, head = 0.16) {
  e.topo = humanoidTopology(limb, head);
  e.anim = new HumanoidAnimator(size, stance);
  e.anim.style = style;
  e.pts = e.anim.pts;
}

function animateHumanoid(e, dt, game) {
  const c = Math.cos(e.yaw), s = Math.sin(e.yaw);
  const vx = e.vx, vz = e.vz;
  e.anim.update(dt, {
    fwdSpeed: vx * s + vz * c, sideSpeed: vx * c - vz * s, accF: 0, accS: 0, combat: 1,
    x: e.x, y: e.y, z: e.z, yaw: e.yaw, ground: (x, z) => game.world.height(x, z),
  });
}

// ------------------------------------------------------------------ type registry
export const ENEMY_TYPES = {
  husk: {
    name: 'Strung Husk', hp: 34, dmg: 11, speed: 3.1, radius: 0.45, size: 1, xp: 3, shard: 0.25,
    palette: (dim, elite) => [pal(elite ? [0.3, 0.15, 0.2] : [0.17, 0.15, 0.16], elite ? 0.3 : 0)],
    init(e) { humanoidRig(e, e.size, STANCE.fists, 'shamble'); },
    think(e, dt, game) {
      if (e.state === 'chase') {
        const t = chase(e, game, e.speed, 1.6 * e.size);
        if (t.d < 2.1 * e.size && e.atkCd <= 0) {
          e.windup(0.62, true);
          e.anim.play(CLIPS.claw, (CLIPS.claw.hitT * CLIPS.claw.dur) / 0.62);
        }
      } else { e.mvx = e.mvz = 0; }
    },
    strike(e, game) {
      if (inFront(e, game, 2.2 * e.size, 120)) game.damagePlayer(e.dmg, e);
      e.recover(0.7);
      e.atkCd = 1.2 + Math.random();
    },
    animate: animateHumanoid,
    draw(e, R, game) {
      const p = e.pts;
      // marionette strings to the void above
      const cam = game.camPos;
      if ((e.x - cam[0]) ** 2 + (e.z - cam[2]) ** 2 > 36) {
        for (const j of [J.HEAD, J.LHA, J.RHA]) {
          const i = j * 3;
          const sway = Math.sin(game.time * 0.7 + e.seed + j) * 1.5;
          R.seg(p[i], p[i + 1], p[i + 2], p[i] + sway, p[i + 1] + 22, p[i + 2] + sway * 0.5, 0.007, [0.45, 0.4, 0.4], 0);
        }
      }
      drawEyes(R, p[J.HEAD * 3], p[J.HEAD * 3 + 1] + 0.02, p[J.HEAD * 3 + 2], e.yaw, e.size, game.dim.env.moonCol);
    },
  },

  brute: {
    name: 'Bellwether Brute', hp: 190, dmg: 26, speed: 2.5, radius: 0.85, size: 1.75, xp: 14, shard: 1, poise: true,
    palette: (dim, elite) => [pal(elite ? [0.35, 0.12, 0.12] : [0.24, 0.19, 0.18], elite ? 0.3 : 0)],
    init(e) { humanoidRig(e, e.size, STANCE.heavy, 'brute', 0.045, 0.09); },
    think(e, dt, game) {
      if (e.state === 'chase') {
        const t = chase(e, game, e.speed, 2.6);
        if (t.d < 4.2 && e.atkCd <= 0) {
          e.windup(1.05, false);
          e.anim.play(CLIPS.slam, (CLIPS.slam.hitT * CLIPS.slam.dur) / 1.05);
          const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
          e.slamX = e.x + fx * 2.4; e.slamZ = e.z + fz * 2.4;
          game.addHazard({ x: e.slamX, z: e.slamZ, r: 3.6, t: 1.05, dmg: e.dmg, kind: 'slam', owner: 'enemy', color: [1, 0.15, 0.1], src: e });
        }
      } else { e.mvx = e.mvz = 0; }
    },
    strike(e, game) {
      game.shake(0.5);
      e.recover(1.1);
      e.atkCd = 2.2 + Math.random();
    },
    animate: animateHumanoid,
    draw(e, R, game) {
      const p = e.pts;
      const hx = p[J.RHA * 3], hy = p[J.RHA * 3 + 1], hz = p[J.RHA * 3 + 2];
      const w = e.anim.wdir;
      const bx = hx + w[0] * 1.6, by = hy + w[1] * 1.6, bz = hz + w[2] * 1.6;
      R.seg(hx, hy, hz, bx, by, bz, 0.05, [0.3, 0.28, 0.25]);
      R.segPrim(PRIM.CONE, bx + w[0] * 0.7, by + w[1] * 0.7, bz + w[2] * 0.7, bx - w[0] * 0.1, by - w[1] * 0.1, bz - w[2] * 0.1, 0.7, [0.35, 0.3, 0.22], 0.05);
      R.ball(bx + w[0] * 0.15, by + w[1] * 0.15, bz + w[2] * 0.15, 0.22, game.dim.terrain.accent, 1.5);
      drawEyes(R, p[J.HEAD * 3], p[J.HEAD * 3 + 1], p[J.HEAD * 3 + 2], e.yaw, e.size * 0.9, [1, 0.3, 0.1]);
      // hunch spikes
      const cx = p[J.CHEST * 3], cy = p[J.CHEST * 3 + 1], cz = p[J.CHEST * 3 + 2];
      for (let i = -1; i <= 1; i++) R.segPrim(PRIM.CONE, cx - Math.sin(e.yaw) * 0.15 + Math.cos(e.yaw) * i * 0.2, cy + 0.05, cz - Math.cos(e.yaw) * 0.15 - Math.sin(e.yaw) * i * 0.2, cx - Math.sin(e.yaw) * 0.5 + Math.cos(e.yaw) * i * 0.3, cy + 0.55, cz - Math.cos(e.yaw) * 0.5 - Math.sin(e.yaw) * i * 0.3, 0.07, [0.8, 0.75, 0.65]);
    },
  },

  choir: {
    name: 'Hollow Chorister', hp: 48, dmg: 18, speed: 3.6, radius: 0.45, size: 1.3, xp: 8, shard: 0.6, ranged: true,
    palette: (dim, elite) => [pal(elite ? [0.95, 0.85, 1] : [0.82, 0.8, 0.74], elite ? 0.4 : 0.05)],
    init(e) { humanoidRig(e, e.size, STANCE.fists, 'float', 0.028, 0.12); e.blinkCd = 2; },
    think(e, dt, game) {
      e.blinkCd -= dt;
      if (e.state === 'chase') {
        const t = strafe(e, game, e.speed, 8, 14);
        if (t.d < 4 && e.blinkCd <= 0) {
          game.blink(e, 10);
          e.blinkCd = 4;
        } else if (t.d < 18 && e.atkCd <= 0) {
          e.windup(0.6, false);
          e.anim.play(CLIPS.cast, 1);
          const p = game.player;
          const lead = 0.6;
          game.addHazard({ x: p.x + p.vx * lead, z: p.z + p.vz * lead, r: 2.3, t: 1.3, dmg: e.dmg, kind: 'pillar', owner: 'enemy', color: [0.75, 0.3, 1], src: e });
        }
      } else { e.mvx = e.mvz = 0; }
    },
    strike(e) { e.recover(0.6); e.atkCd = 2.6 + Math.random() * 1.5; },
    animate: animateHumanoid,
    draw(e, R, game) {
      const p = e.pts;
      const hx = p[J.HEAD * 3], hy = p[J.HEAD * 3 + 1], hz = p[J.HEAD * 3 + 2];
      const n = 7;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + game.time * 0.8;
        const r = 0.32 * e.size;
        R.ball(hx + Math.cos(a) * r, hy + 0.15 + Math.sin(a * 2 + game.time) * 0.04, hz + Math.sin(a) * r, 0.05 * e.size, [1, 0.95, 0.85], 0.4);
        R.ball(hx + Math.cos(a) * r * 1.12, hy + 0.15, hz + Math.sin(a) * r * 1.12, 0.022 * e.size, [0.1, 0, 0.1], 0);
      }
      // trailing robe tendrils
      const px = p[J.PELVIS * 3], py = p[J.PELVIS * 3 + 1], pz = p[J.PELVIS * 3 + 2];
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + e.seed;
        const sw = Math.sin(game.time * 2 + i) * 0.2;
        R.seg(px, py, pz, px + Math.cos(a) * 0.25 + sw, py - 1.1, pz + Math.sin(a) * 0.25, 0.02, [0.7, 0.68, 0.62], 0);
      }
      R.light(hx, hy, hz, 4, 0.8, 0.5, 1, 0.5);
    },
  },

  hound: {
    name: 'Gloomhound', hp: 26, dmg: 12, speed: 8.4, radius: 0.55, size: 1, xp: 4, shard: 0.3,
    palette: (dim, elite) => [pal(elite ? [0.3, 0.12, 0.12] : [0.2, 0.16, 0.16], elite ? 0.3 : 0), pal([0.82, 0.78, 0.68]), pal(dim.terrain.accent, 1.6)],
    init(e) {
      const segs = [
        [0, 1, 0.09, 0], [1, 2, 0.1, 0], [2, 3, 0.07, 0], [3, 4, 0.08, 1], [4, 5, 0.05, 1], [4, 6, 0.035, 1],
        [0, 7, 0.04, 0], [7, 8, 0.03, 0], [8, 9, 0.02, 0],
      ];
      for (let l = 0; l < 4; l++) {
        const b = 10 + l * 3;
        segs.push([b, b + 1, 0.05, 0], [b + 1, b + 2, 0.035, 1]);
        segs.push([l < 2 ? 2 : 0, b, 0.05, 0]);
      }
      // ribs
      const balls = [[4, 0.13, 1, 1], [1, 0.14, 0, 0], [2, 0.12, 0, 0], [0, 0.1, 0, 0]];
      e.topo = new Topology(22, segs, balls, [[0, 2], [1, 3], [0, 4]], [3, 6]);
      e.pts = new Float32Array(22 * 3);
      e.legs = new Legs([
        { hip: [0.2, 0.75, 0.45], rest: [0.24, 0.55], l1: 0.42, l2: 0.42, group: 0 },
        { hip: [-0.2, 0.75, 0.45], rest: [-0.24, 0.55], l1: 0.42, l2: 0.42, group: 1 },
        { hip: [0.2, 0.7, -0.5], rest: [0.24, -0.5], l1: 0.42, l2: 0.42, group: 1 },
        { hip: [-0.2, 0.7, -0.5], rest: [-0.24, -0.5], l1: 0.42, l2: 0.42, group: 0 },
      ], { stepTime: 0.16, stepDist: 0.5, lift: 0.25, knee: -1, lead: 0.8 });
      e.jaw = 0;
      e.crouch = 0;
    },
    think(e, dt, game) {
      if (e.state === 'chase') {
        const t = chase(e, game, e.speed, 1.2);
        if (e.atkCd <= 0 && t.d < 6.5) {
          // pounce from range, snap with a quick bite when already close
          e.closeBite = t.d <= 2;
          e.windup(e.closeBite ? 0.35 : 0.5, true);
        }
      } else if (e.state === 'attack') {
        // mid-leap: keep momentum, bite on contact
        const t = toPlayer(e, game);
        if (!e.bit && t.d < 1.3) { e.bit = true; game.damagePlayer(e.dmg, e); }
      } else { e.mvx = e.mvz = 0; }
    },
    onInterrupt(e) { e.closeBite = false; },
    strike(e, game) {
      if (e.closeBite) {
        e.closeBite = false;
        if (inFront(e, game, 2.0, 140)) game.damagePlayer(e.dmg, e);
        e.recover(0.5);
        e.atkCd = 1.4 + Math.random();
        return;
      }
      const t = toPlayer(e, game);
      e.state = 'attack';
      e.stateT = 0.38;
      e.bit = false;
      e.mvx = e.vx = t.dx * 17; e.mvz = e.vz = t.dz * 17;
      e.airVy = 4.5;
      game.audio.play('heavyWhoosh', 0.5);
      e.onAttackEnd = () => { e.recover(0.6); e.atkCd = 1.6 + Math.random(); };
    },
    animate(e, dt, game) {
      const s = e.size;
      e.crouch = lerp(e.crouch, e.state === 'windup' ? 1 : 0, Math.min(1, dt * 10));
      e.jaw = lerp(e.jaw, e.state === 'windup' || e.state === 'attack' ? 1 : 0.1 + Math.sin(game.time * 8 + e.seed) * 0.05, Math.min(1, dt * 12));
      const body = { x: e.x, y: e.y - e.crouch * 0.25 * s, z: e.z, yaw: e.yaw, scale: s };
      e.legs.update(dt, body, e.vx, e.vz, (x, z) => game.world.height(x, z) + (e.airY || 0));
      const c = Math.cos(e.yaw), sn = Math.sin(e.yaw);
      const P = e.pts;
      const sp = Math.hypot(e.vx, e.vz);
      const bob = Math.sin(game.time * 14 + e.seed) * 0.04 * Math.min(1, sp / 4);
      const put = (i, lx, ly, lz) => {
        P[i * 3] = e.x + (lx * c + lz * sn) * s;
        P[i * 3 + 1] = body.y + ly * s + bob;
        P[i * 3 + 2] = e.z + (-lx * sn + lz * c) * s;
      };
      put(0, 0, 0.72, -0.5);
      put(1, 0, 0.82 + Math.sin(game.time * 3) * 0.02, 0);
      put(2, 0, 0.8, 0.45);
      put(3, 0, 0.95 - e.crouch * 0.15, 0.7);
      put(4, 0, 1.0 - e.crouch * 0.2, 0.85);
      put(5, 0, 0.98 - e.crouch * 0.2, 1.15);
      put(6, 0, 0.88 - e.crouch * 0.2 - e.jaw * 0.12, 1.08);
      const tw = Math.sin(game.time * 6 + e.seed) * 0.15;
      put(7, tw * 0.5, 0.82, -0.75);
      put(8, tw, 0.9, -1.0);
      put(9, tw * 1.6, 0.85, -1.25);
      e.legs.write(P, 10);
    },
    draw(e, R, game) {
      const P = e.pts;
      drawEyes(R, P[12], P[13] + 0.05, P[14], e.yaw, 1.1, game.dim.terrain.accent, 0.08, 0.05);
      // spine ridges
      for (let i = 0; i < 3; i++) {
        const a = i, b = i + 1;
        const mx = (P[a * 3] + P[b * 3]) / 2, my = (P[a * 3 + 1] + P[b * 3 + 1]) / 2, mz = (P[a * 3 + 2] + P[b * 3 + 2]) / 2;
        R.segPrim(PRIM.CONE, mx, my, mz, mx, my + 0.28, mz, 0.05, [0.8, 0.76, 0.66]);
      }
    },
  },

  crawler: {
    name: 'Skitterling', hp: 15, dmg: 7, speed: 6.8, radius: 0.5, size: 0.85, xp: 2, shard: 0.15,
    palette: (dim, elite) => [pal(elite ? [0.25, 0.08, 0.18] : [0.1, 0.09, 0.11], elite ? 0.3 : 0), pal(mixRgb(dim.terrain.accent, [0.1, 0.1, 0.1], 0.3), 0.6)],
    init(e) {
      const segs = [[0, 1, 0.12, 0], [0, 2, 0.08, 0], [2, 3, 0.025, 1], [2, 4, 0.025, 1]];
      const balls = [[0, 0.3, 0, 0], [1, 0.42, 1, 1], [2, 0.17, 0, 0]];
      const legDefs = [];
      for (let i = 0; i < 6; i++) {
        const side = i < 3 ? 1 : -1;
        const k = i % 3;
        const hz = 0.18 - k * 0.18;
        legDefs.push({ hip: [side * 0.2, 0.55, hz], rest: [side * 0.85, hz * 2.6 + 0.1], l1: 0.55, l2: 0.7, group: (k + (side > 0 ? 0 : 1)) % 2 });
        const b = 5 + i * 3;
        segs.push([0, b, 0.04, 0], [b, b + 1, 0.035, 0], [b + 1, b + 2, 0.02, 0]);
      }
      e.topo = new Topology(23, segs, balls, [[0, 2], [1, 2]], [5, 8, 11]);
      e.pts = new Float32Array(23 * 3);
      e.legs = new Legs(legDefs, { stepTime: 0.11, stepDist: 0.4, lift: 0.35, knee: 1, lead: 0.7 });
    },
    think(e, dt, game) {
      if (e.state === 'chase') {
        const t = chase(e, game, e.speed, 1.1);
        // erratic skitter
        e.mvx += Math.sin(game.time * 7 + e.seed) * 2; e.mvz += Math.cos(game.time * 6 + e.seed) * 2;
        if (t.d < 1.7 && e.atkCd <= 0) e.windup(0.38, true);
      } else { e.mvx = e.mvz = 0; }
    },
    strike(e, game) {
      if (inFront(e, game, 1.8, 140)) game.damagePlayer(e.dmg, e);
      e.recover(0.4);
      e.atkCd = 0.9 + Math.random() * 0.8;
    },
    animate(e, dt, game) {
      const s = e.size;
      const rear = e.state === 'windup' ? 0.25 : 0;
      const body = { x: e.x, y: e.y, z: e.z, yaw: e.yaw, scale: s };
      e.legs.update(dt, body, e.vx, e.vz, (x, z) => game.world.height(x, z));
      const c = Math.cos(e.yaw), sn = Math.sin(e.yaw);
      const P = e.pts;
      const put = (i, lx, ly, lz) => {
        P[i * 3] = e.x + (lx * c + lz * sn) * s;
        P[i * 3 + 1] = e.y + ly * s;
        P[i * 3 + 2] = e.z + (-lx * sn + lz * c) * s;
      };
      const bob = Math.sin(game.time * 20 + e.seed) * 0.03;
      put(0, 0, 0.55 + bob + rear * 0.5, 0);
      put(1, 0, 0.7 + bob + Math.sin(game.time * 3 + e.seed) * 0.03, -0.62);
      put(2, 0, 0.55 + rear, 0.36);
      const f = e.state === 'windup' ? 0.15 : Math.sin(game.time * 10) * 0.03;
      put(3, 0.07 + f, 0.42 + rear, 0.55);
      put(4, -0.07 - f, 0.42 + rear, 0.55);
      e.legs.write(P, 5);
    },
    draw(e, R, game) {
      const P = e.pts;
      drawEyes(R, P[6], P[7] + 0.07, P[8], e.yaw, e.size, [1, 0.3, 0.2], 0.06, 0.1);
      drawEyes(R, P[6], P[7] + 0.12, P[8], e.yaw, e.size * 0.8, [1, 0.3, 0.2], 0.03, 0.08);
    },
  },

  gazer: {
    name: 'Drifting Gazer', hp: 30, dmg: 13, speed: 3.4, radius: 0.6, size: 1, xp: 5, shard: 0.4, ranged: true, flying: true,
    palette: (dim, elite) => [pal(elite ? [1, 0.85, 0.8] : [0.88, 0.84, 0.78], elite ? 0.3 : 0.05), pal(mixRgb(dim.terrain.accent, [0.2, 0.05, 0.1], 0.4), 0.3)],
    init(e) {
      const segs = [];
      for (let t = 0; t < 5; t++) {
        const b = 1 + t * 4;
        segs.push([0, b, 0.05, 1], [b, b + 1, 0.04, 1], [b + 1, b + 2, 0.03, 1], [b + 2, b + 3, 0.02, 1]);
      }
      e.topo = new Topology(21, segs, [[0, 0.62, 0, 1]], [], [0, 4, 8]);
      e.pts = new Float32Array(21 * 3);
      e.hover = 2.6 + Math.random();
      e.charge = 0;
    },
    think(e, dt, game) {
      if (e.state === 'chase') {
        const t = strafe(e, game, e.speed, 8, 13);
        if (t.d < 20 && e.atkCd <= 0) e.windup(0.85, false);
      } else { e.mvx *= 0.9; e.mvz *= 0.9; }
      e.charge = e.state === 'windup' ? 1 - e.stateT / 0.85 : Math.max(0, e.charge - dt * 3);
    },
    strike(e, game) {
      const p = game.player;
      const ex = e.x, ey = e.y + e.hover, ez = e.z;
      const n = e.elite ? 3 : 1;
      for (let i = 0; i < n; i++) {
        const spread = (i - (n - 1) / 2) * 0.25;
        let dx = p.x - ex, dy = p.y + 1.1 - ey, dz = p.z - ez;
        const l = Math.hypot(dx, dy, dz);
        dx /= l; dy /= l; dz /= l;
        const c = Math.cos(spread), s = Math.sin(spread);
        const rx = dx * c + dz * s, rz = -dx * s + dz * c;
        game.spawnProjectile({ x: ex + rx * 0.7, y: ey + dy * 0.7, z: ez + rz * 0.7, vx: rx * 14, vy: dy * 14, vz: rz * 14, r: 0.35, dmg: e.dmg, life: 3, owner: 'enemy', color: game.dim.env.moonCol, kind: 'bolt' });
      }
      game.audio.play('bolt');
      e.recover(0.5);
      e.atkCd = 2.4 + Math.random() * 1.2;
    },
    animate(e, dt, game) {
      const P = e.pts;
      const y = e.y + e.hover + Math.sin(game.time * 1.7 + e.seed) * 0.25;
      P[0] = e.x; P[1] = y; P[2] = e.z;
      for (let t = 0; t < 5; t++) {
        const a = (t / 5) * TAU + e.seed;
        let px = e.x + Math.cos(a) * 0.35, py = y - 0.35, pz = e.z + Math.sin(a) * 0.35;
        for (let k = 0; k < 4; k++) {
          const sw = Math.sin(game.time * 2.5 + t * 1.3 + k * 0.8) * 0.18 * (k + 1);
          px += Math.cos(a) * 0.12 + sw * 0.3 - e.vx * 0.02 * k;
          py -= 0.32;
          pz += Math.sin(a) * 0.12 + Math.cos(game.time * 2 + t + k) * 0.1 - e.vz * 0.02 * k;
          const i = 1 + t * 4 + k;
          P[i * 3] = px; P[i * 3 + 1] = py; P[i * 3 + 2] = pz;
        }
      }
    },
    draw(e, R, game) {
      const P = e.pts;
      const p = game.player;
      let dx = p.x - P[0], dy = p.y + 1.2 - P[1], dz = p.z - P[2];
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      const r = 0.6 * e.size;
      const accent = game.dim.env.moonCol;
      const glow = 0.8 + e.charge * 4;
      R.segPrim(PRIM.ORB, P[0] + dx * r * 0.82, P[1] + dy * r * 0.82, P[2] + dz * r * 0.82, P[0] + dx * r * 0.98, P[1] + dy * r * 0.98, P[2] + dz * r * 0.98, r * 0.42, accent, glow);
      R.segPrim(PRIM.ORB, P[0] + dx * r * 0.95, P[1] + dy * r * 0.95, P[2] + dz * r * 0.95, P[0] + dx * r * 1.04, P[1] + dy * r * 1.04, P[2] + dz * r * 1.04, r * (0.18 - e.charge * 0.1), [0.02, 0, 0.02], 0);
      // veins
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + e.seed;
        R.seg(P[0] - dx * r * 0.5 + Math.cos(a) * r * 0.5, P[1] + Math.sin(a) * r * 0.5, P[2] - dz * r * 0.5, P[0] + dx * r * 0.6 + Math.cos(a) * r * 0.55, P[1] + dy * r * 0.6 + Math.sin(a) * r * 0.55, P[2] + dz * r * 0.6, 0.015, [0.7, 0.1, 0.12], 0.2);
      }
      if (e.charge > 0) {
        R.light(P[0] + dx, P[1] + dy, P[2] + dz, 6, accent[0], accent[1], accent[2], e.charge * 2);
        game.particles.emit({ x: P[0] + dx * r * 1.1 + (Math.random() - 0.5) * 0.6, y: P[1] + dy * r + (Math.random() - 0.5) * 0.6, z: P[2] + dz * r * 1.1 + (Math.random() - 0.5) * 0.6, vx: -dx * 2, vy: -dy * 2, vz: -dz * 2, life: 0.3, size: 0.1, color: accent, shape: SHAPE.GLOW });
      }
    },
  },

  maw: {
    name: 'Abyssal Maw', hp: 140, dmg: 18, speed: 0, radius: 1.1, size: 1, xp: 16, shard: 2, poise: true, stationary: true,
    palette: (dim, elite) => [pal(elite ? [0.5, 0.1, 0.18] : [0.36, 0.1, 0.14], 0.15), pal(mixRgb(dim.terrain.accent, [0.35, 0.1, 0.15], 0.5), 0.35)],
    init(e) {
      const segs = [];
      const n = 6;
      for (let t = 0; t < n; t++) {
        const b = 1 + t * 5;
        segs.push([0, b, 0.2, 0], [b, b + 1, 0.16, 1], [b + 1, b + 2, 0.12, 1], [b + 2, b + 3, 0.09, 1], [b + 3, b + 4, 0.06, 1]);
      }
      e.topo = new Topology(31, segs, [[0, 0.9, 0, 1]], [], [1, 6, 11, 16]);
      e.pts = new Float32Array(31 * 3);
      e.spawnCd = 3;
      e.children = 0;
      e.whip = 0;
    },
    think(e, dt, game) {
      e.mvx = e.mvz = 0;
      e.spawnCd -= dt;
      const t = toPlayer(e, game);
      e.wantYaw = Math.atan2(t.dx, t.dz);
      if (e.spawnCd <= 0 && game.enemies.length < game.spawner.cap) {
        e.spawnCd = 6.5;
        const a = Math.random() * TAU;
        game.spawnEnemy('crawler', e.x + Math.cos(a) * 1.8, e.z + Math.sin(a) * 1.8, { fast: true });
        game.particles.burst(e.x, e.y + 1, e.z, 20, { speed: 5, color: game.dim.blood, shape: SHAPE.CHUNK, size: 0.1, life: 0.8, grav: 12, bounce: 0.2, additive: false });
      }
      if (e.state === 'chase' && t.d < 5 && e.atkCd <= 0) {
        e.windup(0.85, false);
        game.addHazard({ x: e.x, z: e.z, r: 5.2, t: 0.85, dmg: e.dmg, kind: 'whip', owner: 'enemy', color: [1, 0.2, 0.15], src: e });
      }
      e.whip = e.state === 'windup' ? 1 - e.stateT / 0.85 : Math.max(0, e.whip - dt * 2);
    },
    strike(e) { e.recover(0.8); e.atkCd = 2.5; e.lash = 0.4; },
    animate(e, dt, game) {
      const P = e.pts;
      P[0] = e.x; P[1] = e.y + 0.5; P[2] = e.z;
      e.lash = Math.max(0, (e.lash || 0) - dt);
      const n = 6;
      for (let t = 0; t < n; t++) {
        const a = (t / n) * TAU + e.seed;
        let px = e.x + Math.cos(a) * 0.8, py = e.y + 0.3, pz = e.z + Math.sin(a) * 0.8;
        const reach = e.lash > 0 ? 1.0 : 0.55 - e.whip * 0.25;
        for (let k = 0; k < 5; k++) {
          const sw = Math.sin(game.time * 2 + t + k * 0.7) * 0.4;
          const spin = e.lash > 0 ? game.time * 18 : 0;
          const aa = a + sw * 0.4 + spin * 0.1 * k;
          px += Math.cos(aa) * reach;
          pz += Math.sin(aa) * reach;
          py += e.lash > 0 ? 0.05 : 0.45 - k * 0.12 + e.whip * 0.2;
          const i = 1 + t * 5 + k;
          P[i * 3] = px; P[i * 3 + 1] = Math.max(py, game.world.height(px, pz) + 0.1); P[i * 3 + 2] = pz;
        }
      }
    },
    draw(e, R, game) {
      const n = 10;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + game.time * 0.3;
        const x = e.x + Math.cos(a) * 0.5, z = e.z + Math.sin(a) * 0.5;
        R.segPrim(PRIM.CONE, x, e.y + 1.1, z, e.x + Math.cos(a) * 0.15, e.y + 0.9, e.z + Math.sin(a) * 0.15, 0.08, [0.95, 0.9, 0.8]);
      }
      R.ball(e.x, e.y + 0.85, e.z, 0.4, [0.02, 0, 0.02], 0);
      R.light(e.x, e.y + 1.5, e.z, 6, 1, 0.3, 0.3, 0.6);
    },
  },
};

// ------------------------------------------------------------------ Enemy
let seedCounter = 1;

export class Enemy {
  constructor(game, type, x, z, opts = {}) {
    const def = opts.def || ENEMY_TYPES[type];
    this.def = def;
    this.type = type;
    this.name = def.name;
    this.elite = !!opts.elite;
    this.boss = !!def.boss;
    this.size = def.size * (this.elite ? 1.3 : 1);
    const sc = game.scaling;
    this.maxHp = this.hp = def.hp * sc.hp * (this.elite ? 4.5 : 1);
    this.dmg = def.dmg * sc.dmg * (this.elite ? 1.4 : 1);
    this.speed = def.speed * (0.9 + Math.random() * 0.2) * (this.elite ? 1.08 : 1) * (opts.fast ? 1.15 : 1);
    this.radius = def.radius * (this.elite ? 1.3 : 1);
    this.x = x; this.z = z;
    this.y = game.world.height(x, z);
    this.vx = 0; this.vz = 0; this.mvx = 0; this.mvz = 0;
    this.kbx = 0; this.kbz = 0;
    this.airY = 0; this.airVy = 0;
    this.yaw = Math.random() * TAU;
    this.wantYaw = this.yaw;
    this.state = 'spawn';
    this.stateT = opts.instant ? 0.01 : def.spawnTime ?? 0.9;
    this.atkCd = 0.6 + Math.random() * 1.2;
    this.flash = 0;
    this.slowT = 0;
    this.burnT = 0;
    this.burnDps = 0;
    this.alive = true;
    this.seed = seedCounter++ * 1.618;
    this.telegraph = false;
    this.counterable = false;
    this.palette = def.palette(game.dim, this.elite);
    this.xp = def.xp * (this.elite ? 6 : 1);
    this.lastHit = 0;
    def.init(this, game);
    // humanoid enemies get a full body built on their skeleton (used by the hand-drawn styles)
    this.bodyId = def.body || type;
    if (this.anim && BODIES[this.bodyId]) this.anatomy = new Anatomy(castBody(game.style && game.style.cast, this.bodyId), this.size);
  }

  windup(time, counterable) {
    this.state = 'windup';
    this.stateT = time;
    this.windupTime = time;
    this.telegraph = true;
    this.counterable = counterable;
    this.mvx = this.mvz = 0;
  }

  recover(time) {
    this.state = 'recover';
    this.stateT = time;
    this.telegraph = false;
    this.counterable = false;
  }

  stagger(time) {
    this.state = 'stagger';
    this.stateT = time;
    this.telegraph = false;
    this.counterable = false;
    this.onAttackEnd = null;
    // drop any attack that was queued for the end of the interrupted windup
    if (this.def.onInterrupt) this.def.onInterrupt(this);
    if (this.anim) this.anim.play(CLIPS.stagger, CLIPS.stagger.dur / Math.max(0.3, time));
  }

  update(dt, game) {
    const def = this.def;
    this.flash = Math.max(0, this.flash - dt * 6);
    this.atkCd -= dt;
    if (this.slowT > 0) this.slowT -= dt;
    if (this.burnT > 0) {
      this.burnT -= dt;
      this.hp -= this.burnDps * dt;
      if (Math.random() < 0.4) game.particles.emit({ x: this.x + (Math.random() - 0.5) * 0.6, y: this.y + 0.5 + Math.random() * this.size, z: this.z + (Math.random() - 0.5) * 0.6, vy: 2, life: 0.5, size: 0.18, size1: 0.02, color: [1, 0.45, 0.1] });
      if (this.hp <= 0) { game.killEnemy(this, { dirX: 0, dirZ: 0, dmg: 1, source: 'burn' }); return; }
    }
    this.stateT -= dt;
    const slow = this.slowT > 0 ? 0.55 : 1;

    if (this.state === 'spawn') {
      this.mvx = this.mvz = 0;
      if (this.stateT <= 0) this.state = 'chase';
    } else if (this.state === 'windup') {
      if (this.stateT <= 0) { this.telegraph = false; this.counterable = false; def.strike(this, game); }
    } else if (this.state === 'attack') {
      if (this.stateT <= 0) { const cb = this.onAttackEnd; this.onAttackEnd = null; if (cb) cb(); else this.recover(0.4); }
    } else if (this.state === 'recover' || this.state === 'stagger') {
      if (this.stateT <= 0) this.state = 'chase';
    }
    if (this.state !== 'spawn' && this.state !== 'stagger') def.think(this, dt, game);
    else { this.mvx = 0; this.mvz = 0; }

    // integrate
    const acc = this.state === 'attack' ? 0 : 10;
    this.vx += (this.mvx * slow - this.vx) * Math.min(1, dt * acc);
    this.vz += (this.mvz * slow - this.vz) * Math.min(1, dt * acc);
    if (!def.stationary) {
      this.x += (this.vx + this.kbx) * dt;
      this.z += (this.vz + this.kbz) * dt;
    }
    const kbd = Math.exp(-dt * 7);
    this.kbx *= kbd; this.kbz *= kbd;
    if (this.airY > 0 || this.airVy > 0) {
      this.airVy -= 24 * dt;
      this.airY += this.airVy * dt;
      if (this.airY <= 0) { this.airY = 0; this.airVy = 0; }
    }
    if (!def.stationary) {
      game.world.resolve(this, this.radius * 0.8);
      game.world.clampToBounds(this);
    }
    const ground = game.world.height(this.x, this.z);
    this.y = ground + this.airY - (this.state === 'spawn' ? Math.max(0, this.stateT) * 2.2 * this.size : 0);
    this.yaw = dampAngle(this.yaw, this.wantYaw, this.state === 'windup' ? 4 : 10, dt);
    def.animate(this, dt, game);
    if (this.anatomy && game.style && game.style.models) {
      const body = castBody(game.style.cast, this.bodyId);
      if (this.anatomy.body !== body) this.anatomy = new Anatomy(body, this.size);
      const cp = game.camPos;
      if ((this.x - cp[0]) ** 2 + (this.z - cp[2]) ** 2 < 45 * 45) this.anatomy.update(dt, this.pts, (x, z) => game.world.height(x, z));
    }
  }

  /** Returns true when killed. */
  takeHit(info, game) {
    if (!this.alive) return false;
    this.hp -= info.dmg;
    this.flash = 1;
    this.lastHit = game.time;
    // elites keep their poise: only heavy hits and counters break them
    const poise = this.def.poise || this.boss || this.elite;
    if (!this.def.stationary && !this.boss) {
      const kbm = poise ? 0.25 : 1;
      this.kbx += info.dirX * info.kb * kbm;
      this.kbz += info.dirZ * info.kb * kbm;
      if (info.launch && !poise) this.airVy = Math.max(this.airVy, info.launch);
    }
    if (this.anim) this.anim.hitReact(Math.min(1.5, info.dmg / 20 + 0.4), Math.random() - 0.5);
    if (this.hp <= 0) return true;
    // freeflow: light hits interrupt fodder, heavy hits interrupt elites/brutes; bosses only stagger on counters
    if (this.state === 'windup' || this.state === 'chase') {
      if (this.boss) {
        if (info.counter) this.stagger(0.9);
      } else if (!poise || info.heavy || info.counter) {
        if (this.state === 'windup') game.cancelHazardsOf(this);
        this.stagger(info.counter ? 1.1 : info.heavy ? 0.7 : 0.32);
      }
    }
    return false;
  }

  draw(R, game) {
    const def = this.def;
    const flash = this.flash * 0.8;
    if (game.style && game.style.models) {
      const cp = game.camPos;
      const far = (this.x - cp[0]) ** 2 + (this.z - cp[2]) ** 2 > 45 * 45;
      if (this.anatomy) drawBody(R, this.anatomy.body, this.pts, far ? null : this.anatomy, this.size, (x, z) => game.world.height(x, z), { flash, eyeCol: game.dim.env.moonCol, lod: far ? 1 : 0 });
      else drawFlesh(R, this.topo, this.pts, this.palette, flash, this.size, this.boss ? 1.25 : 1.8);
    } else {
      drawRig(R, this.topo, this.pts, this.palette, flash, this.size);
    }
    if (def.draw) def.draw(this, R, game);
    if (this.elite) {
      const c = game.dim.env.moonCol;
      R.light(this.x, this.y + 1.2 * this.size, this.z, 5, c[0], c[1], c[2], 0.9);
      if (Math.random() < 0.5) {
        game.particles.emit({ x: this.x + (Math.random() - 0.5) * this.size, y: this.y + Math.random() * 2 * this.size, z: this.z + (Math.random() - 0.5) * this.size, vy: 1.2, life: 0.8, size: 0.14, size1: 0, color: c, shape: SHAPE.GLOW });
      }
    }
    if (this.state === 'spawn') {
      const c = game.dim.terrain.accent;
      R.decal(this.x, this.y + this.stateT * 2.2 * this.size + 0.05, this.z, 1.3 * this.size, 0.02, 0, 0.03, 0.85, 0);
      if (Math.random() < 0.8) game.particles.emit({ x: this.x + (Math.random() - 0.5) * this.size, y: game.world.height(this.x, this.z), z: this.z + (Math.random() - 0.5) * this.size, vy: 3 + Math.random() * 2, life: 0.5, size: 0.12, color: c, shape: SHAPE.SPARK });
    }
  }
}

