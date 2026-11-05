// Game orchestrator: run lifecycle, dimensions, waves and scaling, camera and lock-on, combat resolution, hazards,
// projectiles, pickups and rendering.
import { L } from '../core/i18n.js';
import { RNG } from '../core/rng.js';
import { SpatialHash } from '../core/spatial.js';
import { clamp, lerp, damp, dampAngle, TAU } from '../core/math.js';
import { Particles, SHAPE } from '../gfx/particles.js';
import { PRIM } from '../gfx/renderer.js';
import { World, CHEST_TIERS } from './world.js';
import { dimensionFor } from './dimensions.js';
import { Player } from './player.js';
import { Enemy, ENEMY_TYPES } from './enemies.js';
import { BOSSES } from './bosses.js';
import { Ragdolls } from './rig.js';
import { J, ANIM, tickAnimClock } from './humanoid.js';
import { BODIES, drawBody } from './anatomy.js';
import { strike, drawProjectile, ITEMS, ITEM_IDS } from './arsenal.js';
import { Spawner } from './spawner.js';
import { PLAYER_BASE } from './config.js';
import { rollOffers, applyOffer } from './upgrades.js';
import { echoesForRun } from './meta.js';

export class Game {
  constructor(R, input, audio, ui, meta) {
    this.R = R;
    this.input = input;
    this.audio = audio;
    this.ui = ui;
    this.meta = meta;
    this.particles = new Particles(R);
    this.ragdolls = new Ragdolls(56);
    this.enemyHash = new SpatialHash(4);
    this.state = 'title';
    this.time = 0;
    this.camYaw = 0.6;
    this.camPitch = 0.38;
    this.camDist = 7.5;
    this.camTarget = [0, 1.6, 0];
    this.camPos = [0, 5, -8];
    this.camFwd = [0, 0, 1];
    this.shakeAmt = 0;
    this.fovKick = 0;
    this.hitstopT = 0;
    this.slowT = 0;
    this.slowScale = 1;
    this.numbers = [];
    this.bolts = [];
    this.splats = [];
    this.wells = [];
    this.vp = R.vp;
    this.titleOrbit = 0;
    this.lock = null;
    this.lockAcc = 0;
    this.lockYawOfs = 0;
    this.timeStopT = 0;
    this.blasts = [];
    this.trail = [];
    this.trailT = 0;
    this._dirOut = [0, 0];
    this._axis = [0, 0];
    this._mouse = [0, 0];
    this.settings = meta.data.settings;
    this._buildTitleWorld();
  }

  /** Apply an art-style preset (renderer, animation drawing rate, SFX set). */
  setStyle(id) {
    const st = this.R.setStyle(id);
    if (!st.toon) this.R.setQuality(this.settings.quality);
    ANIM.stepRate = st.onTwos || 0;
    this.audio.setStyle(st.sfx || (st.toon ? 'anime' : 'retro'));
    this.style = st;
    if (this.ui && this.ui.setPack) this.ui.setPack(st);
    return st;
  }

  /** Anime impact frame: a couple of two-tone frames on decisive hits (throttled so it never strobes). */
  impact(strength = 1) {
    if (!this.style || !this.style.toon) return;
    if (this.time - (this.lastImpact || -9) < 0.45) return;
    this.lastImpact = this.time;
    this.impactT = 0.07 * strength;
  }

  // ================================================================== lifecycle
  _buildTitleWorld() {
    this.rng = new RNG((Math.random() * 1e9) | 0);
    this.depth = 0;
    this.dim = dimensionFor(Math.floor(Math.random() * 4));
    this.scaling = { hp: 1, dmg: 1 };
    this.world = new World(this.dim, (Math.random() * 1e9) | 0, 'open', this.R, 0);
    this.particles.ground = (x, z) => this.world.height(x, z);
    this.enemies = [];
    this.projectiles = [];
    this.hazards = [];
    this.pickups = [];
    const stats = { ...PLAYER_BASE };
    this.player = new Player(this, stats);
    this.player.placeAt(0, 0);
    this.spawner = new Spawner(this);
    this.dimTime = 0;
    // a few idle creatures for the title vignette
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const e = new Enemy(this, i % 2 ? 'husk' : 'hound', Math.cos(a) * 9, Math.sin(a) * 9, { instant: true });
      e.state = 'idle';
      this.enemies.push(e);
    }
  }

  startRun() {
    this.audio.init();
    this.audio.resume();
    const seed = (Math.random() * 1e9) | 0;
    this.rng = new RNG(seed);
    const stats = this.meta.applyTo({ ...PLAYER_BASE });
    this.player = new Player(this, stats);
    this.player.hp = stats.maxHp;
    this.player.shards = stats.startShards || 0;
    if (stats.startArms) this.player.loadout.equip(this.rng.pick(ITEM_IDS.filter((id) => ITEMS[id].slot === 'arms')), 1);
    this.rerolls = stats.rerolls;
    this.revives = stats.revives;
    this.spawner = new Spawner(this);
    this.run = { kills: 0, level: 1, depth: 0, bosses: 0, time: 0, chests: 0, dmgDealt: 0, waves: 0, evolutions: 0 };
    this.wavesTotal = 0;
    this.bossEncounters = 0;
    this.lock = null;
    this.timeStopT = 0;
    this.pendingLevels = 0;
    this.offerQueue = [];
    this.enterDimension(0, 'open');
    this.state = 'play';
    this.input.wantLock = true;
    this.input.requestLock();
    this.ui.showHud(true);
  }

  enterDimension(depth, mode) {
    this.depth = depth;
    this.dim = dimensionFor(depth);
    this.mode = mode;
    this.ragdolls.clear();
    this.particles.clear();
    this.enemies = [];
    this.projectiles = [];
    this.hazards = [];
    this.pickups = [];
    this.wells = [];
    this.splats = [];
    this.bolts = [];
    this.boss = null;
    this.lock = null;
    this.timeStopT = 0;
    this.blasts = [];
    this.trail = [];
    this.world = new World(this.dim, this.rng.int(1, 1e9), mode, this.R, depth);
    this.particles.ground = (x, z) => this.world.height(x, z);
    this.dimTime = 0;
    this.spawner.reset();
    this.portalTimer = 165;
    this.portalOpen = false;
    this.activeObelisk = null;
    this.bossSpawnT = mode === 'arena' ? 2.0 : -1;
    this.player.placeAt(0, mode === 'arena' ? -ARENA_START : 0);
    this.camYaw = mode === 'arena' ? 0 : this.camYaw;
    this._refreshScaling();
    this.audio.setAmbience(1, mode === 'arena' ? 0.8 : 1 + depth * 0.03);
    if (mode === 'open') this.ui.title(L(this.dim.name), L(this.dim.sub), L('Depth {n}', { n: depth + 1 }));
    else this.ui.title(L('Rift Sanctum'), L('Something vast stirs beyond the rim'), L('Depth {n}', { n: depth + 1 }));
  }

  /**
   * Difficulty climbs with every wave survived (across the whole run) and every depth descended:
   * tougher, harder-hitting, faster and more aggressive enemies, with more elites.
   */
  _refreshScaling() {
    const d = this.depth, w = this.wavesTotal || 0;
    this.scaling = {
      hp: (1 + 0.6 * d) * (1 + 0.11 * w) * (1 + this.dimTime / 420),
      dmg: (1 + 0.3 * d) * (1 + 0.05 * w),
      speed: 1 + Math.min(0.35, 0.018 * w + 0.04 * d),
      aggro: 1 + Math.min(0.9, 0.03 * w + 0.08 * d),
      elite: 0.03 + 0.012 * w + 0.02 * d,
    };
  }

  transitionTo(action) {
    if (this.transition) return;
    this.transition = { t: 0, action, done: false };
    this.audio.play('portal');
  }

  // ================================================================== helpers for entities
  inputWorldDir() {
    const a = this.input.moveAxis(this._axis);
    const s = Math.sin(this.camYaw), c = Math.cos(this.camYaw);
    // forward = (s, c), right = (-c, s)
    this._dirOut[0] = s * a[1] + -c * a[0];
    this._dirOut[1] = c * a[1] + s * a[0];
    return this._dirOut;
  }

  get inCombat() { return this.enemies.length > 0 && this.nearestEnemy(this.player.x, this.player.z, 14) !== null; }

  forEnemiesNear(x, z, r, fn) {
    this.enemyHash.query(x, z, r + 3, (e) => {
      if (!e.alive || e.state === 'spawn' || e.untargetable || e.def.hitTest) return;
      const rr = r + e.radius;
      if ((e.x - x) ** 2 + (e.z - z) ** 2 < rr * rr) fn(e);
    });
    const b = this.boss;
    if (b && b.alive && !b.untargetable && b.state !== 'spawn' && b.def.hitTest && b.def.hitTest(b, x, z, r)) fn(b);
  }

  nearestEnemy(x, z, range) {
    let best = null, bd = range * range;
    for (const e of this.enemies) {
      if (!e.alive || e.state === 'spawn' || e.untargetable) continue;
      const d = (e.x - x) ** 2 + (e.z - z) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  randomEnemyNear(x, z, range) {
    const list = [];
    for (const e of this.enemies) if (e.alive && e.state !== 'spawn' && !e.untargetable && (e.x - x) ** 2 + (e.z - z) ** 2 < range * range) list.push(e);
    return list.length ? list[(Math.random() * list.length) | 0] : null;
  }

  /** Targetable enemy test shared by lock-on and aiming. */
  _targetable(e) { return e.alive && e.state !== 'spawn' && !e.untargetable; }

  /**
   * Where Arms and Arcana should go: the locked target if in range, else the enemy nearest the camera's line of
   * sight within a narrow cone, else straight ahead. Returns {x, y, z, dx, dy, dz, e}.
   */
  aim(range = 30) {
    const p = this.player;
    const y0 = p.y + 1.35;
    let e = this.lock && this._targetable(this.lock) && Math.hypot(this.lock.x - p.x, this.lock.z - p.z) < range + 6 ? this.lock : null;
    let fx = this.camFwd[0], fz = this.camFwd[2];
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl; fz /= fl;
    if (!e) {
      let best = 0.93;
      for (const o of this.enemies) {
        if (!this._targetable(o)) continue;
        const dx = o.x - p.x, dz = o.z - p.z, d = Math.hypot(dx, dz);
        if (d > range || d < 0.5) continue;
        const dot = (dx * fx + dz * fz) / d - d * 0.0015;
        if (dot > best) { best = dot; e = o; }
      }
    }
    if (e) {
      const ty = e.y + (e.boss ? 2.5 : 1.1) * e.size;
      const dx = e.x - p.x, dy = ty - y0, dz = e.z - p.z;
      const l = Math.hypot(dx, dz) || 1, l3 = Math.hypot(dx, dy, dz) || 1;
      return { x: e.x, y: ty, z: e.z, dx: dx / l, dy: dy / l3, dz: dz / l, e };
    }
    const dist = Math.min(range, 12);
    return { x: p.x + fx * dist, y: y0, z: p.z + fz * dist, dx: fx, dy: 0, dz: fz, e: null };
  }

  // ---------------------------------------------------------------- lock-on
  /** Best lock candidate: close to the screen centre and near the player. */
  _lockCandidate(exclude) {
    const p = this.player;
    let best = null, bs = Infinity;
    for (const e of this.enemies) {
      if (!this._targetable(e) || e === exclude) continue;
      const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz);
      if (d > 32) continue;
      const dot = (dx * this.camFwd[0] + dz * this.camFwd[2]) / (d || 1);
      if (dot < 0.2 && d > 6) continue;
      const score = d * 0.6 + (1 - dot) * 22 - (e.boss ? 8 : 0) - (e.elite ? 2 : 0);
      if (score < bs) { bs = score; best = e; }
    }
    return best;
  }

  toggleLock() {
    if (this.lock) { this.lock = null; this.audio.play('ui', 0.5); return; }
    this.lock = this._lockCandidate(null);
    if (this.lock) this.audio.play('select', 0.5);
  }

  /** Switch the lock to the next target on the given side of the screen (dir: -1 left, +1 right). */
  switchLock(dir) {
    const cur = this.lock;
    if (!cur) return;
    const p = this.player, R = this.R;
    const side = (e) => (e.x - p.x) * R.camRight[0] + (e.z - p.z) * R.camRight[2];
    const s0 = side(cur);
    let best = null, bd = Infinity;
    for (const e of this.enemies) {
      if (!this._targetable(e) || e === cur) continue;
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      if (d > 32) continue;
      const ds = (side(e) - s0) * dir;
      if (ds <= 0.2) continue;
      const score = ds + d * 0.3;
      if (score < bd) { bd = score; best = e; }
    }
    if (best) { this.lock = best; this.audio.play('ui', 0.4); }
  }

  _updateLock(m, dt) {
    const input = this.input;
    if (input.consume('lock')) this.toggleLock();
    const l = this.lock;
    if (l && (!this._targetable(l) || Math.hypot(l.x - this.player.x, l.z - this.player.z) > 42)) {
      // the target died or slipped away: hop to the next one nearby, else drop the lock
      this.lock = l.alive ? null : this._lockCandidate(l);
    }
    if (!this.lock) { this.lockAcc = 0; this.lockYawOfs = damp(this.lockYawOfs, 0, 4, dt); return false; }
    if (input.consume('lockNext')) this.switchLock(1);
    if (input.consume('lockPrev')) this.switchLock(-1);
    // a sharp flick of the mouse or right stick switches targets; gentle motion nudges the framing
    this.lockAcc = this.lockAcc * Math.exp(-dt * 8) + m[0];
    const flick = 0.09 / (this.settings.lockFlick ?? 1);
    if (Math.abs(this.lockAcc) > flick) { this.switchLock(this.lockAcc > 0 ? 1 : -1); this.lockAcc = 0; }
    this.lockYawOfs = clamp(this.lockYawOfs - m[0] * 0.35, -0.5, 0.5);
    this.lockYawOfs = damp(this.lockYawOfs, 0, 1.5, dt);
    return true;
  }

  // ---------------------------------------------------------------- status effects
  /** Freeze an enemy solid (bosses are only slowed). */
  freeze(e, dur) {
    if (!e.alive) return;
    if (e.boss) { e.slowT = Math.max(e.slowT, dur); return; }
    e.iceT = Math.max(e.iceT || 0, dur);
    if (e.state !== 'spawn') e.stagger(dur);
  }

  timeStop(dur) {
    this.timeStopT = dur;
    this.R.post_.desat = 0.9;
    this.R.post_.warp = 1.6;
    this.audio.play('portal');
    this.impact(1.5);
  }

  /** Push the foliage outward (negative strength pulls it in) for a short moment. */
  grassBlast(x, z, r, strength = 1) {
    if (this.blasts.length > 6) this.blasts.shift();
    this.blasts.push({ x, z, r, s: strength, t: 0.6 });
  }

  pushFromEnemies(p) {
    this.enemyHash.query(p.x, p.z, 3, (e) => {
      if (!e.alive || e.state === 'spawn' || e.untargetable || e.def.flying) return;
      const dx = p.x - e.x, dz = p.z - e.z;
      const d = Math.hypot(dx, dz);
      const m = e.radius + p.radius;
      if (d < m && d > 1e-4) {
        const k = (m - d) * 0.6;
        p.x += (dx / d) * k; p.z += (dz / d) * k;
      }
    });
  }

  // ================================================================== combat
  /** Resolve one hit threshold of the Blade slot's current cut. */
  playerStrike(p, move, hitIndex) {
    const st = p.stats;
    const w = p.weapon;
    const reach = w.reach * move.reach * st.reach;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    const arcCos = move.arc >= 360 ? -2 : Math.cos(((move.arc * Math.PI) / 360) * (1 + (st.areaMul - 1) * 0.5));
    const cx = p.x + fx * reach * 0.25, cz = p.z + fz * reach * 0.25;
    const buff = p.buffs.berserkT > 0 ? 1.25 + 0.05 * (p.buffs.berserkL || 1) : 1;
    const baseDmg = w.dmg * move.dmg * st.dmgMul * buff * (move.ultimate ? 6 : 1);
    let hits = 0;
    const hitR = move.ultimate ? 11 * st.areaMul : reach;
    const checked = new Set();
    const tryHit = (e) => {
      if (checked.has(e)) return;
      checked.add(e);
      const dx = e.x - p.x, dz = e.z - p.z;
      const d = Math.hypot(dx, dz) || 1e-4;
      if (!move.ultimate && arcCos > -1 && d > e.radius + 0.6 && (dx * fx + dz * fz) / d < arcCos && !e.def.hitTest) return;
      const crit = !!move.ultimate || Math.random() < st.critChance;
      const dmg = baseDmg * (crit ? st.critMul : 1) * (0.92 + Math.random() * 0.16);
      const info = { dmg, crit, dirX: dx / d, dirZ: dz / d, kb: move.kb * st.knockback * (1.2 - (hitIndex ? 0.4 : 0)), launch: move.launch, heavy: move.dmg >= 1.8, source: 'melee', color: w.trailColor, impact: !!move.ultimate };
      this.damageEnemy(e, info);
      hits++;
    };
    this.forEnemiesNear(cx, cz, hitR, tryHit);
    if (this.boss && this.boss.alive && !checked.has(this.boss) && this.boss.def.hitTest && this.boss.def.hitTest(this.boss, cx, cz, hitR)) tryHit(this.boss);
    this.world.hitDestructibles(cx, cz, hitR, baseDmg, this, fx, fz, arcCos);
    this.grassBlast(p.x + fx * reach * 0.6, p.z + fz * reach * 0.6, reach, 0.8);
    // shockwaves: slams with a shock-capable blade, and the ultimate
    const shockR = move.ultimate ? 11 : move.shock && w.shock ? w.shock * st.areaMul : 0;
    if (shockR > 0) {
      const sx = p.x + fx * reach * 0.7, sz = p.z + fz * reach * 0.7;
      this.shockwave(sx, sz, shockR, w.trailColor, !!move.ultimate);
      if (!move.ultimate) {
        this.forEnemiesNear(sx, sz, shockR, (e) => {
          if (checked.has(e)) return;
          checked.add(e);
          this.damageEnemy(e, { dmg: baseDmg * 0.45, dirX: e.x - p.x, dirZ: e.z - p.z, kb: 6, source: 'shock', color: w.trailColor });
        });
      }
    }
    if (!move.ultimate) p.loadout.onSwing(move, hitIndex, hits);
    if (hits > 0) {
      this.hitstop(move.ultimate ? 0.12 : 0.035 + Math.min(0.03, hits * 0.008));
      this.shake(move.ultimate ? 0.7 : 0.14 + move.dmg * 0.06);
    }
  }

  damageEnemy(e, info) {
    if (!e.alive) return;
    const p = this.player;
    // frozen in time or in ice: shattering hits land harder
    if (this.timeStopT > 0 || e.iceT > 0) info.dmg *= 1.25;
    const killed = e.takeHit(info, this);
    this.run && (this.run.dmgDealt += info.dmg);
    if (p.stats.lifesteal > 0 && info.source === 'melee') p.hp = Math.min(p.stats.maxHp, p.hp + info.dmg * p.stats.lifesteal);
    // feedback
    const y = e.y + (e.boss ? (e.cy ? e.cy - e.y : 2.5 * e.size) : 1.2 * e.size);
    if (!info.quiet || Math.random() < 0.25) this.number(e.x, y + 0.6, e.z, info.dmg, info.crit, info.color);
    if (!info.quiet) {
      const n = info.crit ? 18 : 8;
      this.particles.burst(e.x, y, e.z, n, { speed: info.crit ? 9 : 6, dir: [info.dirX, 0.4, info.dirZ], spread: 0.8, color: this.dim.blood, shape: SHAPE.CHUNK, size: 0.08, life: 0.7, grav: 16, bounce: 0.15, additive: false });
      this.particles.burst(e.x, y, e.z, info.crit ? 12 : 5, { speed: 10, dir: [info.dirX, 0.2, info.dirZ], spread: 1, color: info.color || [1, 1, 1], shape: SHAPE.SPARK, size: 0.07, life: 0.35, grav: 4 });
      this.particles.emit({ x: e.x, y, z: e.z, life: 0.12, size: info.crit ? 1.6 : 0.9, size1: 0.2, color: info.color || [1, 1, 1], shape: SHAPE.STAR });
      this.audio.play(info.crit ? 'crit' : 'hit', info.crit ? 1 : 0.7);
      if (Math.random() < 0.35) this.splat(e.x + info.dirX * 1.2, e.z + info.dirZ * 1.2, 0.5 + Math.random() * 0.7);
    }
    p.ult = Math.min(1, p.ult + (info.crit ? 0.006 : 0.003) * p.stats.ultCharge * (info.source === 'melee' ? 1.6 : 1));
    if (info.source === 'melee') p.loadout.onHit(e, info);
    if (info.burn) { e.burnT = 2.5; e.burnDps = info.burn; e.dotCol = null; }
    if (info.impact) this.impact();
    if (killed) this.killEnemy(e, info);
  }

  killEnemy(e, info) {
    if (!e.alive) return;
    if (e.boss || e.elite) this.impact(e.boss ? 2 : 1);
    // a lethal interruption must be at least as effective as a stagger: drop the pending windup attack
    if (e.state === 'windup') {
      this.cancelHazardsOf(e);
      if (e.def.onInterrupt) e.def.onInterrupt(e);
    }
    e.alive = false;
    const p = this.player;
    const isHuman = !!e.anim;
    const overkill = info.crit || info.dmg > e.maxHp * 0.8;
    const kb = (info.kb || 4) * (e.boss ? 0.3 : 1);
    this.ragdolls.spawn(e.topo, e.pts, e.palette, {
      vel: [e.vx * 0.5, 0, e.vz * 0.5],
      impulse: [(info.dirX || 0) * kb * 1.4, 3 + (info.launch || 0) + kb * 0.25, (info.dirZ || 0) * kb * 1.4],
      impulsePoint: isHuman ? J.CHEST : 0,
      dismember: overkill && !e.boss ? (info.crit && Math.random() < 0.5 ? 2 : 1) : 0,
      scaleR: e.size, life: e.boss ? 9 : 5 + Math.random() * 1.5, ash: this.dim.ash, blood: this.dim.blood,
      radius: e.boss ? 0.3 : 0.06, body: e.anatomy ? e.anatomy.body : null,
    });
    const y = e.y + 1 * e.size;
    this.particles.burst(e.x, y, e.z, overkill ? 34 : 18, { speed: overkill ? 9 : 6, color: this.dim.blood, shape: SHAPE.CHUNK, size: 0.1, life: 0.9, grav: 16, bounce: 0.2, additive: false });
    this.particles.burst(e.x, y, e.z, 10, { speed: 2, color: this.dim.ash, shape: SHAPE.SMOKE, size: 0.6, size1: 1.2, life: 1, drag: 2, grav: -0.5, additive: false, alpha: 0.5 });
    if (e.iceT > 0) this.particles.burst(e.x, y, e.z, 20, { speed: 7, color: [0.7, 0.95, 1], shape: SHAPE.CHUNK, size: 0.12, life: 0.8, grav: 14, bounce: 0.3, additive: false });
    this.splat(e.x, e.z, 1 + Math.random() * 0.8 * e.size);
    this.audio.play('death');
    if (this.run) this.run.kills++;
    // rewards: experience is lean on purpose; depth adds a little, not a lot
    const xp = e.xp * p.stats.xpMul * (1 + this.depth * 0.12);
    const orbs = e.boss ? 30 : Math.max(1, Math.round(xp / 6));
    for (let i = 0; i < orbs; i++) this.drop('xp', e.x, y, e.z, xp / orbs);
    let sh = e.def.shard * p.stats.shardMul * (e.elite ? 5 : 1) * (1 + this.depth * 0.3);
    while (sh > 0) {
      if (sh >= 1 || Math.random() < sh) this.drop('shard', e.x, y, e.z, 1);
      sh -= 1;
    }
    if (Math.random() < 0.012 || e.elite && Math.random() < 0.5) this.drop('heal', e.x, y, e.z, 0.1);
    p.loadout.onKill(e, info);
    if (e.boss) this.onBossKilled(e);
  }

  damagePlayer(dmg, src, opts = {}) {
    const p = this.player;
    if (!p.alive || this.state !== 'play') return;
    if (!opts.tick && p.invuln()) return;
    if (opts.tick && (p.state === 'dodge' || p.state === 'dash')) return;
    const real = dmg * (1 - p.stats.armor);
    if (opts.tick) { p.hp -= real; } else {
      p.hurt(real, src ? src.x : p.x, src ? src.z : p.z);
      this.shake(0.45);
      this.hitstop(0.06);
      this.R.post_.damage = 1;
      this.audio.play('hurt');
      this.particles.burst(p.x, p.y + 1.2, p.z, 14, { speed: 5, color: [0.6, 0.02, 0.05], shape: SHAPE.CHUNK, size: 0.07, life: 0.6, grav: 14, additive: false });
      this.number(p.x, p.y + 2.2, p.z, real, false, [1, 0.25, 0.25]);
      if (src && src.alive && p.stats.thorns > 0) this.damageEnemy(src, { dmg: p.stats.thorns, dirX: 0, dirZ: 0, kb: 2, source: 'thorns', color: [0.9, 0.5, 0.2] });
    }
    if (p.hp <= 0) this.onPlayerDeath();
  }

  shockwave(x, z, r, color, big = false) {
    const y = this.world.height(x, z);
    this.particles.emit({ x, y: y + 0.1, z, life: 0.35, size: 0.3, size1: r * 1.3, color, shape: SHAPE.RING, alpha: 0.9 });
    const n = big ? 60 : 24;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      this.particles.emit({ x, y: y + 0.2, z, vx: Math.cos(a) * r * 2.5, vy: 2 + Math.random() * 3, vz: Math.sin(a) * r * 2.5, life: 0.5, size: 0.25, size1: 0.05, color: this.dim.ash, shape: SHAPE.SMOKE, drag: 4, additive: false, alpha: 0.7 });
      if (big || i % 2 === 0) this.particles.emit({ x, y: y + 0.3, z, vx: Math.cos(a) * r * 3, vy: 4 + Math.random() * 6, vz: Math.sin(a) * r * 3, life: 0.6, size: 0.07, color, shape: SHAPE.SPARK, grav: 14, drag: 1.5, bounce: 0.3 });
    }
    // debris kicked up from the ground
    for (let i = 0; i < (big ? 18 : 6); i++) {
      const a = Math.random() * TAU, rr = Math.random() * r * 0.8;
      this.world.debris.spawn({ x: x + Math.cos(a) * rr, y: y + 0.2, z: z + Math.sin(a) * rr, vx: Math.cos(a) * 5, vy: 5 + Math.random() * 6, vz: Math.sin(a) * 5, sx: 0.25, sy: 0.18, sz: 0.22, c: this.dim.terrain.steep, life: 2.5 });
    }
    this.R.light(x, y + 1, z, r * 2, color[0], color[1], color[2], 3);
    this.audio.play('boom');
    if (big) {
      this.R.post_.warp = 1.4;
      this.R.post_.aberr = 2;
    }
  }

  lightning(ax, ay, az, bx, by, bz, color) {
    const pts = [[ax, ay, az]];
    const n = 6;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      pts.push([lerp(ax, bx, t) + (Math.random() - 0.5) * 0.8, lerp(ay, by, t) + (Math.random() - 0.5) * 0.8, lerp(az, bz, t) + (Math.random() - 0.5) * 0.8]);
    }
    pts.push([bx, by, bz]);
    this.bolts.push({ pts, t: 0.16, color });
  }

  addHazard(h) {
    h.max = h.t;
    this.hazards.push(h);
  }

  cancelHazardsOf(e) {
    for (const h of this.hazards) if (h.src === e && !h.done) { h.cancelled = true; }
  }

  addWell(w) { this.wells.push(w); }

  spawnProjectile(p) { this.projectiles.push(p); }

  spawnEnemy(type, x, z, opts = {}) {
    const def = ENEMY_TYPES[type];
    if (!def) return null;
    const e = new Enemy(this, type, x, z, opts);
    this.enemies.push(e);
    return e;
  }

  spawnBoss(id, x, z) {
    const def = BOSSES[id];
    const e = new Enemy(this, id, x, z, { def });
    // bosses scale with depth, with every wave the run has survived and with each guardian already slain
    const enc = this.bossEncounters || 0;
    e.maxHp = e.hp = def.hp * (1 + this.depth * 1.0) * (1 + 0.035 * (this.wavesTotal || 0)) * (1 + 0.25 * enc);
    e.dmg = def.dmg * (1 + this.depth * 0.35) * (1 + 0.1 * enc);
    e.aggro = 1 + 0.12 * this.depth + 0.15 * enc;
    this.bossEncounters = enc + 1;
    this.bossFight = { t: 0, addT: 14, enraged: false };
    this.enemies.push(e);
    this.boss = e;
    this.bossRoar(e, e.def.title, true);
    return e;
  }

  blink(e, dist) {
    const p = this.player;
    this.particles.burst(e.x, e.y + 1.5, e.z, 24, { speed: 4, color: [0.8, 0.5, 1], shape: SHAPE.GLOW, size: 0.15, life: 0.5 });
    const a = Math.random() * TAU;
    e.x = p.x + Math.cos(a) * dist; e.z = p.z + Math.sin(a) * dist;
    this.world.clampToBounds(e);
    this.particles.burst(e.x, this.world.height(e.x, e.z) + 1.5, e.z, 24, { speed: 4, color: [0.8, 0.5, 1], shape: SHAPE.GLOW, size: 0.15, life: 0.5 });
  }

  shake(a) { this.shakeAmt = Math.min(1.5, this.shakeAmt + a * (this.settings.shake ?? 1)); }
  hitstop(t) { this.hitstopT = Math.max(this.hitstopT, t); }
  slowmo(dur, scale) { this.slowT = dur; this.slowScale = scale; }

  number(x, y, z, v, crit, color) {
    if (this.numbers.length > 80) this.numbers.shift();
    this.numbers.push({ x, y, z, v: Math.max(1, Math.round(v)), crit, color: color || [1, 1, 1], t: 0.9, vy: 2.2 + Math.random(), ox: (Math.random() - 0.5) * 0.6 });
  }

  splat(x, z, size) {
    if (this.splats.length > 140) this.splats.shift();
    this.splats.push({ x, z, y: this.world.height(x, z), size, t: 25, a: Math.random() * TAU });
  }

  drop(kind, x, y, z, value) {
    const a = Math.random() * TAU, s = 2 + Math.random() * 3;
    this.pickups.push({ kind, x, y, z, vx: Math.cos(a) * s, vy: 4 + Math.random() * 3, vz: Math.sin(a) * s, value, t: 0, magnet: false });
  }

  // ================================================================== fx hooks
  onDodge(p) {
    this.particles.burst(p.x, p.y + 0.2, p.z, 10, { speed: 3, color: this.dim.ash, shape: SHAPE.SMOKE, size: 0.4, size1: 0.8, life: 0.6, drag: 3, additive: false, alpha: 0.4 });
  }

  onDestructibleBroken(d) {
    const n = d.material === 'urn' ? 3 : d.material === 'crystal' ? 2 : 1;
    for (let i = 0; i < n; i++) if (Math.random() < 0.8) this.drop('shard', d.x, d.y + 1, d.z, 1);
    if (Math.random() < 0.15) this.drop('heal', d.x, d.y + 1, d.z, 0.1);
    if (d.material === 'crystal') this.drop('xp', d.x, d.y + 1, d.z, 6 * (1 + this.depth * 0.3));
  }

  bossRoar(e, text, intro = false) {
    this.audio.play('roar');
    this.shake(1);
    if (intro) this.ui.title(L(e.name), L(text), 'BOSS');
    else this.announce(text, 'boss');
  }

  announce(text, kind = 'info') { this.ui.announce(text, kind); }

  // ================================================================== progression
  gainXp(v) {
    const p = this.player;
    p.xp += v;
    while (p.xp >= p.xpNext) {
      p.xp -= p.xpNext;
      p.level++;
      // a steep curve: levels come quickly early, then each one is a real milestone
      p.xpNext = Math.floor(14 + p.level * 8 + Math.pow(p.level, 1.85) * 2.6);
      this.pendingLevels++;
      if (this.run) this.run.level = p.level;
    }
  }

  _openOffers(kind, opts) {
    const p = this.player;
    const n = 3 + (p.stats.extraChoice || 0);
    const roll = () => rollOffers(this.rng, p, n, { luck: p.stats.luck + (opts.luck || 0), minTier: opts.minTier || 0, itemChance: opts.itemChance });
    const offers = roll();
    this.state = 'levelup';
    this.input.releaseLock();
    this.audio.play(kind === 'level' ? 'levelup' : 'chest');
    this.ui.showOffers({
      title: opts.title, subtitle: opts.subtitle, offers, rerolls: this.rerolls,
      onPick: (o) => {
        const msg = applyOffer(p, o);
        this.audio.play(o.kind === 'evolve' ? 'levelup' : 'select');
        this.particles.burst(p.x, p.y + 1, p.z, o.kind === 'evolve' ? 120 : 40, { speed: o.kind === 'evolve' ? 10 : 6, color: o.color ? hex(o.color) : [1, 1, 1], shape: SHAPE.SPARK, size: 0.08, life: 0.7, grav: 3 });
        if (o.kind === 'evolve' && this.run) this.run.evolutions++;
        if (msg) this.announce(msg, o.kind === 'evolve' ? 'boss' : 'loot');
        this.ui.hideOffers();
        this.state = 'play';
        this.input.requestLock();
        this._checkQueues();
      },
      onReroll: () => {
        if (this.rerolls <= 0) return null;
        this.rerolls--;
        this.audio.play('ui');
        return roll();
      },
    });
  }

  _checkQueues() {
    if (this.state !== 'play' || this.offerDelay > 0) return;
    if (this.offerQueue.length) {
      const o = this.offerQueue.shift();
      this._openOffers(o.kind, o);
    } else if (this.pendingLevels > 0) {
      this.pendingLevels--;
      this._openOffers('level', { title: L('Level {n}', { n: this.player.level - this.pendingLevels }), subtitle: L('The abyss offers a gift. Choose one.') });
    }
  }

  tryOpenChest(c) {
    const p = this.player;
    const cost = this.world.chestCost(c, p.stats.chestDiscount);
    if (p.shards < cost) {
      this.announce(L('Requires {n} shards', { n: cost }), 'warn');
      this.audio.play('ui');
      return;
    }
    p.shards -= cost;
    c.opened = true;
    this.world.chestsOpened++;
    if (this.run) this.run.chests++;
    const t = CHEST_TIERS[c.tier];
    this.particles.burst(c.x, c.y + 1, c.z, 50, { speed: 7, color: t.glow, shape: SHAPE.SPARK, size: 0.08, life: 1, grav: 5 });
    for (let i = 0; i < 20; i++) this.particles.emit({ x: c.x + (Math.random() - 0.5), y: c.y + 0.5, z: c.z + (Math.random() - 0.5), vy: 6 + Math.random() * 6, life: 1.2, size: 0.25, size1: 0, color: t.glow, shape: SHAPE.GLOW });
    this.shake(0.3);
    this.offerQueue.push({ kind: 'chest', title: L(t.name), subtitle: L('Its contents whisper your name.'), minTier: t.minTier, luck: t.luck, itemChance: 1.4 });
    this._checkQueues();
  }

  onBossKilled(e) {
    this.run.bosses++;
    this.slowmo(1.8, 0.2);
    this.shake(1.5);
    this.R.post_.warp = 2;
    this.R.post_.aberr = 2.5;
    this.particles.burst(e.x, e.y + 3, e.z, 160, { speed: 14, color: this.dim.env.moonCol, shape: SHAPE.SPARK, size: 0.12, life: 1.6, grav: 6 });
    this.particles.burst(e.x, e.y + 3, e.z, 60, { speed: 4, color: this.dim.ash, shape: SHAPE.SMOKE, size: 1.5, size1: 3, life: 2.5, drag: 1.5, additive: false, alpha: 0.6 });
    for (let i = 0; i < 25; i++) this.drop('shard', e.x, e.y + 2, e.z, 2);
    this.announce(L('{name} has fallen', { name: L(e.name) }), 'boss');
    this.offerQueue.push({ kind: 'chest', title: L('Relic of the Fallen'), subtitle: L('Power torn from a dying god.'), minTier: 2, luck: 0.6, itemChance: 1.6 });
    this.bossFight = null;
    this.offerDelay = 1.8;
    this.world.openExitPortal(0, 0);
    this.boss = null;
  }

  onPlayerDeath() {
    const p = this.player;
    if (!p.alive) return;
    if (this.revives > 0) {
      this.revives--;
      p.hp = p.stats.maxHp * 0.5;
      p.invulnT = 2.5;
      this.addHazard({ x: p.x, z: p.z, r: 8, t: 0.01, dmg: 120 * p.stats.dmgMul, kind: 'nova', owner: 'player', color: [1, 0.9, 0.6] });
      this.announce(L('Second Breath'), 'boss');
      this.slowmo(1, 0.3);
      return;
    }
    p.alive = false;
    p.state = 'dead';
    this.ragdolls.spawn(p.topo, p.anim.pts, p.palette, { impulse: [0, 4, 0], impulsePoint: J.CHEST, life: 30, ash: this.dim.ash, blood: this.dim.blood, body: p.anatomy ? p.anatomy.body : BODIES.hero });
    this.slowmo(2.5, 0.25);
    this.state = 'dying';
    this.dyingT = 2.4;
    this.input.releaseLock();
  }

  _finishRun() {
    const r = this.run;
    r.depth = this.depth;
    const echoes = echoesForRun(r);
    this.meta.award(echoes);
    const s = this.meta.data.stats;
    s.runs++;
    s.kills += r.kills;
    s.bosses += r.bosses;
    s.bestDepth = Math.max(s.bestDepth, r.depth + 1);
    s.bestTime = Math.max(s.bestTime, Math.floor(r.time));
    this.meta.save();
    this.state = 'dead';
    this.ui.showHud(false);
    this.ui.showGameOver({ ...r, echoes, total: this.meta.data.echoes });
  }

  abandonRun() {
    if (!this.run) return;
    this.player.alive = false;
    this._finishRun();
  }

  // ================================================================== update
  update(rawDt) {
    const input = this.input;
    input.update(rawDt);
    this.time += rawDt;
    const R = this.R;
    // post fx decay
    R.post_.damage = Math.max(0, R.post_.damage - rawDt * 2.5);
    this.impactT = Math.max(0, (this.impactT || 0) - rawDt);
    R.post_.impact = this.impactT > 0 ? 1 : 0;
    R.post_.aberr = damp(R.post_.aberr, 0.25, 3, rawDt);
    R.post_.warp = damp(R.post_.warp, 0.15, 2, rawDt);
    R.post_.desat = damp(R.post_.desat, this.state === 'dying' || this.state === 'dead' ? 0.85 : this.slowT > 0 ? 0.35 : 0, 6, rawDt);

    if (this.transition) {
      const tr = this.transition;
      tr.t += rawDt;
      R.post_.fade = tr.done ? clamp(tr.t / 0.7, 0, 1) : clamp(1 - tr.t / 0.7, 0, 1);
      if (!tr.done && tr.t >= 0.7) { tr.action(); tr.done = true; tr.t = 0; }
      else if (tr.done && tr.t >= 0.7) { this.transition = null; R.post_.fade = 1; }
    }

    if (this.state === 'title') {
      this._updateTitle(rawDt);
      return;
    }
    if (this.state === 'play' && input.consume('pause')) { this.pause(); return; }
    if (this.state === 'paused') {
      // the pause key closes an open settings panel first, keeping the game paused
      if (input.consume('pause')) {
        if (this.ui.settingsOpen) this.ui.showSettings(false);
        else this.resume();
      }
      return;
    }
    if (this.state === 'levelup') {
      for (const [k, i] of [['pick1', 0], ['pick2', 1], ['pick3', 2], ['pick4', 3]]) if (input.consume(k)) this.ui.pickIndex(i);
      if (input.consume('reroll')) this.ui.reroll();
      return;
    }
    if (this.state === 'dead') return;

    // time scaling: hitstop and slow motion
    let ts = 1;
    if (this.slowT > 0) { this.slowT -= rawDt; ts = this.slowScale; }
    if (this.hitstopT > 0) { this.hitstopT -= rawDt; ts = Math.min(ts, 0.06); }
    const dt = rawDt * ts;
    this.simDt = dt;

    if (this.state === 'dying') {
      this.dyingT -= rawDt;
      this._updateWorld(dt);
      this._updateCamera(rawDt);
      if (this.dyingT <= 0) this._finishRun();
      return;
    }

    // ---- play
    if (this.offerDelay > 0) this.offerDelay -= rawDt;
    this.dimTime += dt;
    if (this.run) this.run.time += dt;
    if (Math.floor(this.dimTime) % 5 === 0) this._refreshScaling();
    // camera look and lock-on
    const m = input.takeMouse(this._mouse);
    const sens = this.settings.sensitivity ?? 1;
    m[0] *= sens; m[1] *= sens;
    const locked = this._updateLock(m, rawDt);
    this.camPitch = clamp(this.camPitch + m[1], -0.1, 1.15);
    if (locked) {
      // the camera swings to keep the target framed beside the player; the assist strength is a setting
      const l = this.lock, p = this.player;
      const want = Math.atan2(l.x - p.x, l.z - p.z) + this.lockYawOfs;
      this.camYaw = dampAngle(this.camYaw, want, 7 * (this.settings.lockAssist ?? 1), rawDt);
    } else {
      this.camYaw -= m[0];
      if (Math.abs(m[0]) + Math.abs(m[1]) > 1e-4) this.lastLookT = this.time;
      // soft boss framing: when the player isn't steering the camera, swing it to keep the boss in view
      const b = this.boss;
      if (b && b.alive && b.state !== 'spawn' && this.time - (this.lastLookT || 0) > 1.2) {
        const want = Math.atan2(b.x - this.player.x, b.z - this.player.z);
        this.camYaw = dampAngle(this.camYaw, want, 1.6, rawDt);
      }
    }
    if (this.timeStopT > 0) {
      this.timeStopT -= dt;
      this.R.post_.desat = Math.max(this.R.post_.desat, 0.7);
      if (this.timeStopT <= 0) { this.audio.play('portal', 0.5); this.R.post_.warp = 1; }
    }

    this.player.update(dt, input);
    this._updateBossFight(dt);
    this._updateWorld(dt);
    this._updateObjectives(dt);
    this._updateInteract();
    this._updateCamera(rawDt);
    this._checkQueues();
  }

  _updateTitle(dt) {
    this.titleOrbit += dt * 0.06;
    this.camYaw = this.titleOrbit;
    this.camPitch = 0.22;
    this.world.update(dt, this);
    for (const e of this.enemies) {
      e.mvx = e.mvz = 0;
      e.def.animate(e, dt, this);
    }
    const p = this.player;
    p.anim.update(dt, { fwdSpeed: 0, sideSpeed: 0, combat: 1, x: p.x, y: p.y, z: p.z, yaw: this.titleOrbit + Math.PI, ground: (x, z) => this.world.height(x, z) });
    p.yaw = this.titleOrbit + Math.PI;
    p._updateScarf(dt);
    this.camDist = 6.5;
    this._updateCamera(dt);
  }

  _updateWorld(dt) {
    const W = this.world;
    W.update(dt, this);
    // spatial hash
    this.enemyHash.clear();
    for (const e of this.enemies) if (e.alive) this.enemyHash.insert(e, e.x, e.z);
    // enemies (stopped time freezes them; bosses only crawl)
    const ts = this.timeStopT > 0;
    for (const e of this.enemies) if (e.alive && !(ts && !e.boss)) e.update(ts ? dt * 0.2 : dt, this);
    // separation
    for (const e of this.enemies) {
      if (!e.alive || e.def.stationary || e.def.flying || e.boss) continue;
      this.enemyHash.query(e.x, e.z, e.radius * 2, (o) => {
        if (o === e || !o.alive || o.def.flying || o.boss) return;
        const dx = e.x - o.x, dz = e.z - o.z;
        const d = Math.hypot(dx, dz);
        const m = e.radius + o.radius;
        if (d < m && d > 1e-4) {
          const k = (m - d) * 0.25;
          e.x += (dx / d) * k; e.z += (dz / d) * k;
        }
      });
    }
    this.enemies = this.enemies.filter((e) => e.alive);
    if (this.state === 'play' && !ts) this.spawner.update(dt);
    this.ragdolls.update(dt, (x, z) => W.height(x, z), this.particles);
    this._updateHazards(dt);
    this._updateProjectiles(dt);
    this._updatePickups(dt);
    this._updateWells(dt);
    for (const n of this.numbers) { n.t -= dt; n.y += n.vy * dt; n.vy -= 3 * dt; }
    this.numbers = this.numbers.filter((n) => n.t > 0);
    for (const b of this.bolts) b.t -= dt;
    this.bolts = this.bolts.filter((b) => b.t > 0);
    for (const s of this.splats) s.t -= dt;
    // boss arena
    if (this.mode === 'arena' && this.bossSpawnT > 0) {
      this.bossSpawnT -= dt;
      if (this.bossSpawnT <= 0) {
        const id = this.dim.boss;
        this.spawnBoss(id, 0, 10);
      }
    }
  }

  /** Guardian fights escalate: periodic waves of adds, then an enrage. */
  _updateBossFight(dt) {
    const bf = this.bossFight, b = this.boss;
    if (!bf || !b || !b.alive || b.state === 'spawn' || this.timeStopT > 0) return;
    bf.t += dt;
    bf.addT -= dt;
    if (bf.addT <= 0) {
      bf.addT = Math.max(9, 18 - this.depth * 2 - (this.bossEncounters - 1) * 1.5);
      const n = 2 + this.depth * 2 + Math.floor(bf.t / 40);
      const pool = Object.entries(this.dim.enemies).filter(([k]) => k !== 'maw');
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, r = 14 + Math.random() * 10;
        const type = this.rng.weighted(pool, (e) => e[1])[0];
        this.spawnEnemy(type, Math.cos(a) * r, Math.sin(a) * r, { elite: Math.random() < this.scaling.elite * 0.5 });
      }
      this.announce(L('The guardian calls its brood'), 'warn');
    }
    if (!bf.enraged && (bf.t > 100 || b.hp < b.maxHp * 0.25)) {
      bf.enraged = true;
      b.aggro = (b.aggro || 1) * 1.5;
      b.dmg *= 1.2;
      this.bossRoar(b, L('{name} is enraged', { name: L(b.name) }));
      this.R.post_.aberr = 2;
    }
  }

  _updateHazards(dt) {
    const p = this.player;
    const ts = this.timeStopT > 0;
    for (const h of this.hazards) {
      if (h.cancelled) { h.done = true; continue; }
      if (ts && h.owner === 'enemy') continue;
      h.t -= dt;
      if (h.t > 0 || h.done) continue;
      h.done = true;
      const y = this.world.height(h.x, h.z);
      const c = h.color;
      if (h.owner === 'enemy') {
        const d = Math.hypot(p.x - h.x, p.z - h.z);
        if (d < h.r + p.radius * 0.5) this.damagePlayer(h.dmg, h.src || { x: h.x, z: h.z });
      } else {
        const hit = [];
        this.forEnemiesNear(h.x, h.z, h.r, (e) => hit.push(e));
        for (const e of hit) strike(this, e, h.dmg, { fromX: h.x, fromZ: h.z, kb: 6, source: h.kind, color: c, burn: h.burn });
        this.world.hitDestructibles(h.x, h.z, h.r, h.dmg, this);
        this.grassBlast(h.x, h.z, h.r * 1.6, 1.2);
      }
      // detonation visuals
      if (h.kind === 'pillar' || h.kind === 'star') {
        const top = h.kind === 'star' ? 22 : 7;
        for (let i = 0; i < 30; i++) this.particles.emit({ x: h.x + (Math.random() - 0.5) * h.r, y: y + Math.random() * top, z: h.z + (Math.random() - 0.5) * h.r, vy: h.kind === 'star' ? -20 : 8 + Math.random() * 6, life: 0.5, size: 0.35, size1: 0, color: c, shape: SHAPE.GLOW });
        this.particles.burst(h.x, y + 0.3, h.z, 26, { speed: 8, color: c, shape: SHAPE.SPARK, size: 0.07, life: 0.6, grav: 10 });
        this.R.light(h.x, y + 2, h.z, h.r * 4, c[0], c[1], c[2], 4);
        this.audio.play(h.kind === 'star' ? 'boom' : 'zap');
      } else if (h.kind === 'fire') {
        this.particles.burst(h.x, y + 0.3, h.z, 10, { speed: 3, up: 3, color: c, shape: SHAPE.GLOW, size: 0.3, life: 0.6, drag: 2 });
      } else {
        this.shockwave(h.x, h.z, h.r * 0.8, c, false);
      }
      this.shake(h.owner === 'enemy' ? 0.35 : 0.15);
    }
    this.hazards = this.hazards.filter((h) => !h.done);
  }

  _updateProjectiles(dt) {
    const p = this.player;
    const W = this.world;
    const ts = this.timeStopT > 0;
    const spawned = [];
    for (const pr of this.projectiles) {
      if (ts && pr.owner === 'enemy') continue;
      pr.life -= dt;
      pr.age = (pr.age || 0) + dt;
      if (pr.tick) pr.tick(pr, dt);
      if (pr.homing) {
        const t = pr.target && pr.target.alive ? pr.target : (pr.target = this.nearestEnemy(pr.x, pr.z, 25));
        if (t) {
          const dx = t.x - pr.x, dy = t.y + 1 * t.size - pr.y, dz = t.z - pr.z;
          const l = Math.hypot(dx, dy, dz) || 1;
          const sp = Math.max(18, Math.hypot(pr.vx, pr.vy, pr.vz));
          pr.vx += ((dx / l) * sp - pr.vx) * Math.min(1, dt * pr.homing * 0.4);
          pr.vy += ((dy / l) * sp - pr.vy) * Math.min(1, dt * pr.homing * 0.4);
          pr.vz += ((dz / l) * sp - pr.vz) * Math.min(1, dt * pr.homing * 0.4);
        }
      }
      // kunai storm: split three ways once
      if (pr.splitAt && pr.age >= pr.splitAt) {
        pr.splitAt = 0;
        for (const da of [-0.35, 0.35]) {
          const c = Math.cos(da), s0 = Math.sin(da);
          spawned.push({ ...pr, vx: pr.vx * c - pr.vz * s0, vz: pr.vx * s0 + pr.vz * c, hit: new Set(), splitAt: 0 });
        }
      }
      // boomerangs: fly out, then home back to the hand (and may hit everything again)
      if (pr.returnAt && pr.age >= pr.returnAt) {
        if (!pr.returning) { pr.returning = true; pr.hit = new Set(); pr.life = Math.max(pr.life, 2); }
        const dx = p.x - pr.x, dy = p.y + 1.3 - pr.y, dz = p.z - pr.z, l = Math.hypot(dx, dy, dz) || 1;
        const sp = 26;
        pr.vx = (dx / l) * sp; pr.vy = (dy / l) * sp; pr.vz = (dz / l) * sp;
        if (l < 1.2) pr.life = 0;
      }
      if (pr.grav) pr.vy -= pr.grav * dt;
      pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.z += pr.vz * dt;
      const g = W.height(pr.x, pr.z);
      if (pr.groundSkim && pr.y < g + 0.9) { pr.y = g + 0.9; pr.vy = Math.max(0, pr.vy); }
      if (pr.y < g && !pr.noGround && !pr.returning) {
        pr.life = 0;
        this.particles.burst(pr.x, g + 0.1, pr.z, 8, { speed: 4, color: pr.color, shape: SHAPE.SPARK, size: 0.05, life: 0.4, grav: 8 });
        if (pr.onEnd) pr.onEnd(pr);
        continue;
      }
      if (pr.owner === 'enemy') {
        const dx = p.x - pr.x, dy = p.y + 1.1 - pr.y, dz = p.z - pr.z;
        if (dx * dx + dy * dy + dz * dz < (pr.r + 0.45) ** 2) {
          if (!p.invuln()) { this.damagePlayer(pr.dmg, { x: pr.x - pr.vx, z: pr.z - pr.vz, alive: false }); pr.life = 0; }
        }
      } else if (pr.dmg > 0 || pr.onHit) {
        if (!pr.hit) pr.hit = new Set();
        const list = [];
        this.forEnemiesNear(pr.x, pr.z, pr.r, (e) => { if (!pr.hit.has(e)) list.push(e); });
        for (const e of list) {
          if (pr.life <= 0) break;
          if (Math.abs((e.y + 1 * e.size) - pr.y) > 2.5 * e.size + 1 && !e.boss) continue;
          pr.hit.add(e);
          if (pr.dmg > 0) strike(this, e, pr.dmg, { dirX: pr.vx, dirZ: pr.vz, kb: 3, source: pr.kind, color: pr.color, critBonus: pr.critBonus, freeze: pr.freeze });
          if (pr.onHit) pr.onHit(pr, e);
          if (pr.pierce > 0) pr.pierce--;
          else pr.life = 0;
        }
      }
      if (pr.life <= 0) {
        if (pr.onEnd && pr.owner !== 'enemy') pr.onEnd(pr);
        this.particles.burst(pr.x, pr.y, pr.z, 8, { speed: 4, color: pr.color, shape: SHAPE.SPARK, size: 0.06, life: 0.35 });
      }
    }
    for (const n of spawned) this.projectiles.push(n);
    this.projectiles = this.projectiles.filter((pr) => pr.life > 0);
  }

  _updatePickups(dt) {
    const p = this.player;
    const W = this.world;
    const mag = p.stats.magnet;
    for (const o of this.pickups) {
      o.t += dt;
      const dx = p.x - o.x, dy = p.y + 1 - o.y, dz = p.z - o.z;
      const d = Math.hypot(dx, dy, dz);
      if (o.t > 0.4 && (d < mag || o.magnet || this.mode === 'arena' && !this.boss)) o.magnet = true;
      if (o.magnet && p.alive) {
        const sp = Math.min(8 + o.t * 14, 60);
        // never step past the player: collect when this frame's move would reach or cross them
        const reach = d < 0.8 || sp * dt >= d - 0.8;
        const step = Math.min(sp, d / Math.max(dt, 1e-4));
        o.vx = (dx / d) * step; o.vy = (dy / d) * step; o.vz = (dz / d) * step;
        if (reach) {
          o.dead = true;
          if (o.kind === 'xp') { this.gainXp(o.value); this.audio.play('pickup'); }
          else if (o.kind === 'shard') { p.shards += o.value; this.audio.play('coin'); }
          else if (o.kind === 'heal') { p.hp = Math.min(p.stats.maxHp, p.hp + p.stats.maxHp * o.value); this.audio.play('select'); this.particles.burst(p.x, p.y + 1, p.z, 14, { speed: 3, color: [0.4, 1, 0.5], shape: SHAPE.GLOW, size: 0.15, life: 0.6 }); }
        }
      } else {
        o.vy -= 14 * dt;
        const k = Math.exp(-dt * 2);
        o.vx *= k; o.vz *= k;
      }
      o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
      const g = W.height(o.x, o.z) + 0.35;
      if (!o.magnet && o.y < g) { o.y = g; o.vy = Math.abs(o.vy) * 0.3; }
    }
    this.pickups = this.pickups.filter((o) => !o.dead && o.t < 90);
  }

  _updateWells(dt) {
    for (const w of this.wells) {
      w.t -= dt;
      w.tick = (w.tick || 0) - dt;
      const tick = w.tick <= 0;
      if (tick) w.tick = 0.3;
      this.forEnemiesNear(w.x, w.z, w.r, (e) => {
        if (!e.boss && !e.def.stationary) {
          const dx = w.x - e.x, dz = w.z - e.z, d = Math.hypot(dx, dz) || 1;
          e.kbx += (dx / d) * 24 * dt; e.kbz += (dz / d) * 24 * dt;
        }
        if (tick) this.damageEnemy(e, { dmg: w.dps * 0.3, dirX: 0, dirZ: 0, kb: 0, source: 'well', color: [0.6, 0.3, 1], quiet: true });
      });
    }
    this.wells = this.wells.filter((w) => w.t > 0);
  }

  _updateObjectives(dt) {
    const W = this.world;
    const p = this.player;
    if (this.mode !== 'open') {
      const ex = W.exitPortal;
      if (ex && this.state === 'play') {
        const d = Math.hypot(p.x - ex.x, p.z - ex.z);
        // arm only after the boss loot has had time to fly in and the player has stepped clear of the portal,
        // so a boss dying on top of the exit never forces an instant descent
        ex.age = (ex.age || 0) + dt;
        if (!ex.armed && ex.age > 3 && d > 3.4) ex.armed = true;
        if (ex.armed && d < 2.6) this.transitionTo(() => this.enterDimension(this.depth + 1, 'open'));
      }
      return;
    }
    // obelisks
    this.activeObelisk = null;
    for (const o of W.obelisks) {
      if (o.done) continue;
      const inside = Math.hypot(p.x - o.x, p.z - o.z) < 8;
      o.active = inside;
      if (inside) {
        this.activeObelisk = o;
        o.charge = Math.min(1, o.charge + dt / 14);
        if (Math.random() < 0.6) {
          const a = Math.random() * TAU;
          this.particles.emit({ x: o.x + Math.cos(a) * 8, y: o.y + 0.2, z: o.z + Math.sin(a) * 8, vx: -Math.cos(a) * 6, vy: 1.5, vz: -Math.sin(a) * 6, life: 1.2, size: 0.12, color: this.dim.terrain.accent, shape: SHAPE.GLOW });
        }
        if (o.charge >= 1) {
          o.done = true;
          this.portalTimer = Math.max(3, this.portalTimer - 45);
          for (let i = 0; i < 10; i++) this.drop('xp', o.x, o.y + 4, o.z, 5 * (1 + this.depth * 0.3));
          for (let i = 0; i < 8; i++) this.drop('shard', o.x, o.y + 4, o.z, 2);
          this.shockwave(o.x, o.z, 9, [0.4, 1, 0.7], false);
          const left = W.obelisks.filter((q) => !q.done).length;
          this.announce(left ? L('Obelisk awakened — the Rift draws nearer ({n} remain)', { n: left }) : L('All obelisks awakened — the Rift tears open'), 'objective');
        }
      } else {
        o.charge = Math.max(0, o.charge - dt / 40);
      }
    }
    // timed portal
    if (!this.portalOpen) {
      this.portalTimer -= dt;
      if (this.portalTimer <= 0) {
        this.portalOpen = true;
        W.openBossPortal(this.rng);
        this.announce(L('A Rift has opened. Reach it before it closes!'), 'objective');
        this.audio.play('portal');
      }
    } else if (W.portal) {
      W.portal.timer -= dt;
      if (Math.hypot(p.x - W.portal.x, p.z - W.portal.z) < 2.8 && this.state === 'play') {
        W.portal = null;
        this.transitionTo(() => this.enterDimension(this.depth, 'arena'));
      } else if (W.portal.timer <= 0) {
        W.portal = null;
        this.portalOpen = false;
        this.portalTimer = 50;
        this.spawner.hunt(2 + this.depth);
        this.announce(L('The Rift collapsed. Something hunts you now...'), 'warn');
      }
    }
  }

  _updateInteract() {
    const p = this.player;
    let near = null, nd = 2.4;
    for (const c of this.world.chests) {
      if (c.opened) continue;
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d < nd) { nd = d; near = c; }
    }
    this.nearChest = near;
    if (near && this.input.consume('interact')) this.tryOpenChest(near);
  }

  /**
   * Foliage interaction: blades part around the player, stay pressed along the last second of footsteps and spring
   * back, bow away from nearby enemies and flatten under blasts. Running through dense patches throws up blades.
   */
  _updateFoliage(dt) {
    const W = this.world, R = this.R, p = this.player;
    const F = W.foliage;
    if (!F) return;
    if (F.update(p.x, p.z) || F.dirty) { R.setFoliageInstances(F.data, F.count); F.dirty = false; }
    R.foliageFade[0] = p.x; R.foliageFade[1] = p.z; R.foliageFade[2] = F.radius;
    const out = R.push;
    let n = 0;
    const add = (x, z, r, s) => { if (n >= 16) return; out[n * 4] = x; out[n * 4 + 1] = z; out[n * 4 + 2] = r; out[n * 4 + 3] = s; n++; };
    const speed = Math.hypot(p.vx, p.vz);
    if (p.alive) add(p.x, p.z, 1.1 + (p.sprinting ? 0.4 : 0), 0.8 + Math.min(0.6, speed * 0.05));
    // footstep trail: pressed blades recover over ~1.4 s
    if (dt > 0) {
      this.trailT -= dt;
      if (this.trailT <= 0 && speed > 0.5) { this.trailT = 0.12; this.trail.push({ x: p.x, z: p.z, t: 1.4 }); if (this.trail.length > 6) this.trail.shift(); }
      for (const t of this.trail) t.t -= dt;
      this.trail = this.trail.filter((t) => t.t > 0);
      for (const b of this.blasts) { b.t -= dt; b.r *= 1 + dt * 1.5; }
      this.blasts = this.blasts.filter((b) => b.t > 0);
    }
    for (const t of this.trail) add(t.x, t.z, 0.9, 0.9 * (t.t / 1.4) ** 1.5);
    for (const b of this.blasts) add(b.x, b.z, b.r, b.s * (b.t / 0.6));
    // nearest enemies
    const near = [];
    for (const e of this.enemies) {
      if (!e.alive || e.def.flying) continue;
      const d = (e.x - p.x) ** 2 + (e.z - p.z) ** 2;
      if (d < 26 * 26) near.push([d, e]);
    }
    near.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < near.length && n < 16; i++) { const e = near[i][1]; add(e.x, e.z, e.radius + 0.7, e.boss ? 1.4 : 0.9); }
    R.nPush = n;
    // rustle: running or dodging through dense growth throws blade bits around
    if (dt > 0 && p.alive && speed > 2.5) {
      const dens = F.density(p.x, p.z);
      const rate = dens * (p.sprinting ? 34 : p.state === 'dodge' ? 50 : 10);
      const k = Math.floor(rate * dt + Math.random());
      const cols = W.dim.foliage.colors;
      for (let i = 0; i < k; i++) {
        const c = cols[(Math.random() * cols.length) | 0];
        this.particles.emit({ x: p.x + (Math.random() - 0.5) * 1.2, y: p.y + 0.3 + Math.random() * 0.6, z: p.z + (Math.random() - 0.5) * 1.2, vx: (Math.random() - 0.5) * 3 - p.vx * 0.1, vy: 1.5 + Math.random() * 2, vz: (Math.random() - 0.5) * 3 - p.vz * 0.1, life: 0.9, size: 0.06, color: c, shape: SHAPE.CHUNK, grav: 5, drag: 1.5, additive: false });
      }
    }
  }

  /** The player's wake: ambient particles part around them, and sprinting kicks up the realm and streaks the air. */
  _motionFx(dt) {
    const p = this.player, P = this.particles, F = P.field;
    const speed = Math.hypot(p.vx, p.vz);
    const sprint = p.sprinting && p.alive;
    F.x = p.x; F.y = p.y + 1; F.z = p.z; F.vx = p.vx; F.vz = p.vz;
    F.r = sprint ? 4.8 : p.state === 'dodge' || p.state === 'dash' ? 3.6 : 2.2;
    F.k = sprint ? 1.2 : p.state === 'dodge' || p.state === 'dash' ? 1 : Math.min(0.45, speed * 0.06);
    if (!sprint || this.state !== 'play') return;
    this.fovKick = Math.max(this.fovKick, 0.045);
    const kind = this.dim.ambient.kind, a = this.dim.ambient;
    const ux = p.vx / (speed || 1), uz = p.vz / (speed || 1);
    const R = Math.random;
    // footfall kick-up, themed per realm
    const n = Math.floor(40 * dt + R());
    for (let i = 0; i < n; i++) {
      const x = p.x + (R() - 0.5) * 0.8, z = p.z + (R() - 0.5) * 0.8, y = p.y + 0.1;
      const bx = -ux * (2 + R() * 2), bz = -uz * (2 + R() * 2);
      if (kind === 'embers') {
        P.emit({ x, y, z, vx: bx * 0.6, vy: 0.8 + R(), vz: bz * 0.6, life: 0.9, size: 0.35, size1: 0.9, color: this.dim.ash, shape: SHAPE.SMOKE, drag: 2.5, additive: false, alpha: 0.5 });
        if (R() < 0.5) P.emit({ x, y: y + 0.3, z, vx: bx + (R() - 0.5) * 2, vy: 2 + R() * 2, vz: bz + (R() - 0.5) * 2, life: 0.8, size: 0.06, color: a.color, shape: SHAPE.SPARK, grav: 4 });
      } else if (kind === 'bubbles') {
        P.emit({ x, y: y + 0.2, z, vx: bx * 0.3, vy: 1.5 + R() * 2, vz: bz * 0.3, life: 1.4, size: 0.08 + R() * 0.1, color: a.color, shape: SHAPE.RING, drag: 0.8 });
        if (R() < 0.4) P.emit({ x, y, z, vx: bx * 0.4, vy: 0.4, vz: bz * 0.4, life: 1.2, size: 0.4, size1: 1, color: [0.15, 0.35, 0.35], shape: SHAPE.SMOKE, drag: 2, additive: false, alpha: 0.45 });
      } else if (kind === 'stars') {
        P.emit({ x, y: y + 0.3 + R(), z, vx: bx * 0.5, vy: 0.6, vz: bz * 0.5, life: 0.7, size: 0.18, size1: 0, color: R() < 0.5 ? a.color : a.color2, shape: SHAPE.STAR, drag: 1.5 });
      } else {
        P.emit({ x, y: y + 0.2, z, vx: bx * 0.5, vy: 1 + R(), vz: bz * 0.5, life: 1.1, size: 0.12, size1: 0.02, color: a.color, shape: SHAPE.GLOW, drag: 1.5 });
        if (R() < 0.35) P.emit({ x, y: y + 0.3, z, vx: bx + (R() - 0.5) * 2, vy: 2.5, vz: bz + (R() - 0.5) * 2, life: 0.8, size: 0.06, color: this.dim.blood, shape: SHAPE.CHUNK, grav: 14, bounce: 0.1, additive: false });
      }
    }
    // speed streaks rushing past
    const m = Math.floor(30 * dt + R());
    for (let i = 0; i < m; i++) {
      const side = (R() - 0.5) * 5, up = 0.3 + R() * 2.4;
      const x = p.x + ux * 5 - uz * side, z = p.z + uz * 5 + ux * side;
      P.emit({ x, y: p.y + up, z, vx: -ux * 26, vy: 0, vz: -uz * 26, life: 0.3, size: 0.07, color: [1, 1, 1], alpha: 0.7, shape: SHAPE.SPARK, drag: 0 });
    }
  }

  _updateCamera(dt) {
    const p = this.player;
    const t = this.camTarget;
    t[0] = damp(t[0], p.x, 14, dt);
    t[1] = damp(t[1], p.y + 1.55, 10, dt);
    t[2] = damp(t[2], p.z, 14, dt);
    let dist = this.camDist;
    if (this.boss && this.boss.alive) dist += 2.5;
    let pitch = this.camPitch;
    if (this.R.ortho) {
      // pseudo-3D: a high, distant orthographic "diorama" camera; framing is set by the ortho size
      pitch = clamp(this.camPitch + 0.32, 0.55, 1.05);
      dist = 80;
      this.R.orthoDist = dist;
      // zoom follows the usual camera distance (closer framing for model sheets, wider for bosses)
      this.R.orthoSize = this.camDist * 0.75 + (this.boss && this.boss.alive ? 3 : 0);
    }
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const fx = Math.sin(this.camYaw) * cp, fy = -sp, fz = Math.cos(this.camYaw) * cp;
    let px = t[0] - fx * dist, py = t[1] - fy * dist, pz = t[2] - fz * dist;
    // keep above terrain
    const gh = this.world.height(px, pz) + 0.6;
    if (py < gh) py = gh;
    // shake
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2);
    const s = this.shakeAmt * this.shakeAmt * 0.35;
    const tt = this.time * 40;
    px += Math.sin(tt * 1.1) * s; py += Math.sin(tt * 1.7 + 1) * s; pz += Math.cos(tt * 1.3) * s;
    this.camPos[0] = px; this.camPos[1] = py; this.camPos[2] = pz;
    this.fovKick = damp(this.fovKick, 0, 6, dt);
    this.R.post_.speed = clamp(this.fovKick * 7, 0, 1);
    const fov = 1.05 + this.fovKick + (this.slowT > 0 ? -0.05 : 0);
    this.R.setCamera(px, py, pz, t[0], t[1], t[2], fov);
    this.camFwd[0] = fx; this.camFwd[1] = fy; this.camFwd[2] = fz;
  }

  pause() {
    this.state = 'paused';
    this.input.releaseLock();
    this.ui.showPause(true);
  }

  resume() {
    this.state = 'play';
    this.ui.showSettings(false);
    this.ui.showPause(false);
    this.input.requestLock();
  }

  // ================================================================== render
  render(rawDt) {
    const R = this.R;
    R.resize();
    R.beginFrame();
    const dt = this.state === 'play' || this.state === 'dying' || this.state === 'title' ? (this.simDt ?? rawDt) : 0;
    this.simDt = undefined;
    tickAnimClock(dt);
    const W = this.world;
    const cx = this.camPos[0], cz = this.camPos[2];
    W.draw(R, this, cx, cz);
    if (dt > 0) {
      W.ambient(this, this.player.x, this.player.y, this.player.z, dt);
      this._motionFx(dt);
    }
    R.focus[0] = this.player.x; R.focus[1] = this.player.y + 1.1; R.focus[2] = this.player.z;
    this._updateFoliage(dt);
    // blood splats
    for (const s of this.splats) {
      const a = Math.min(1, s.t / 5) * 0.75;
      R.decal(s.x, s.y + 0.04, s.z, s.size, this.dim.blood[0] * 0.6, this.dim.blood[1] * 0.6, this.dim.blood[2] * 0.6, a, SHAPE.SMOKE, s.a);
    }
    // enemies
    const tele = this.dim.env.moonCol;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = e.x - cx, dz = e.z - cz;
      if (dx * dx + dz * dz > 130 * 130) continue;
      e.draw(R, this);
      if (!e.def.flying && !e.boss) R.decal(e.x, e.y + 0.05, e.z, e.radius * 1.5, 0, 0, 0, 0.45, 0);
      if (e.telegraph) {
        // every enemy attack must be dodged: a red star swells as the windup completes
        const k = 1 - Math.max(0, e.stateT) / (e.windupTime || 1);
        const hy = e.y + (e.boss ? (e.cy ? e.cy - e.y + 3.5 : 3.6 * e.size + 1) : 2.3 * e.size);
        R.glow(e.x, hy, e.z, 0.5 + k * 0.6, 1, 0.2, 0.15, 0.9, SHAPE.STAR);
      }
      if (e.iceT > 0) {
        // frozen solid: a shell of ice shards
        for (let i = 0; i < 5; i++) {
          const a = i * 1.26 + e.seed;
          const r = e.radius * 0.9;
          R.segPrim(PRIM.OCTA, e.x + Math.cos(a) * r, e.y, e.z + Math.sin(a) * r, e.x + Math.cos(a) * r * 0.6, e.y + (1.2 + (i % 2) * 0.6) * e.size, e.z + Math.sin(a) * r * 0.6, 0.22 * e.size, [0.65, 0.92, 1], 0.6, 0.6);
        }
      }
    }
    // player
    if (this.player.alive) {
      this.player.draw(R);
      R.decal(this.player.x, this.player.y + 0.05, this.player.z, 0.65, 0, 0, 0, 0.5, 0);
    }
    this.ragdolls.draw(R, !!(this.style && this.style.models), (x, z) => this.world.height(x, z), drawBody);
    this.player.loadout.draw(R);
    // lock-on marker in the world: a ring at the target's feet
    if (this.lock && this.lock.alive) {
      const l = this.lock;
      R.decal(l.x, l.y + 0.09, l.z, l.radius * 2.4 + 0.4, 1, 0.3, 0.35, 0.8, SHAPE.RING, this.time * 2);
    }
    // hazards (telegraphs)
    for (const h of this.hazards) {
      const k = 1 - Math.max(0, h.t) / (h.max || 1);
      const y = this.world.height(h.x, h.z) + 0.1;
      const c = h.color;
      R.decal(h.x, y, h.z, h.r, c[0], c[1], c[2], h.owner === 'enemy' ? 0.55 : 0.3, 6);
      R.decal(h.x, y + 0.01, h.z, h.r * k, c[0], c[1], c[2], 0.35, 0);
      if (h.kind === 'star') {
        const sy = y + 24 * (1 - k);
        R.ball(h.x, sy, h.z, 0.5, c, 4);
        this.particles.emit({ x: h.x, y: sy, z: h.z, vy: 8, life: 0.3, size: 0.6, size1: 0, color: c, shape: SHAPE.GLOW });
      }
    }
    // gravity wells
    for (const w of this.wells) {
      const y = this.world.height(w.x, w.z) + 1.2;
      R.ball(w.x, y, w.z, 0.6 + Math.sin(this.time * 10) * 0.05, [0.02, 0, 0.04], 0);
      R.decal(w.x, y - 1.1, w.z, w.r, 0.5, 0.25, 1, 0.3, SHAPE.RING);
      R.light(w.x, y, w.z, w.r * 1.5, 0.5, 0.2, 1, 1.5);
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * TAU;
        this.particles.emit({ x: w.x + Math.cos(a) * w.r, y: y + (Math.random() - 0.5), z: w.z + Math.sin(a) * w.r, vx: -Math.cos(a) * w.r * 2, vz: -Math.sin(a) * w.r * 2, life: 0.5, size: 0.1, color: [0.6, 0.3, 1], shape: SHAPE.SPARK });
      }
    }
    // projectiles
    for (const pr of this.projectiles) {
      const c = pr.color;
      if (drawProjectile(R, pr, this)) {
        if (pr.kind !== 'orb') R.glow(pr.x, pr.y, pr.z, pr.kind === 'wave' ? 1.2 : 0.6, c[0], c[1], c[2], 0.45, 0);
        if (dt > 0 && pr.kind !== 'orb') this.particles.emit({ x: pr.x, y: pr.y, z: pr.z, life: 0.2, size: pr.kind === 'wave' ? 0.5 : 0.18, size1: 0, color: c, alpha: 0.6, shape: SHAPE.GLOW });
        continue;
      }
      if (pr.kind === 'blade') {
        const l = Math.hypot(pr.vx, pr.vy, pr.vz) || 1;
        R.segPrim(PRIM.OCTA, pr.x - (pr.vx / l) * 0.5, pr.y - (pr.vy / l) * 0.5, pr.z - (pr.vz / l) * 0.5, pr.x + (pr.vx / l) * 0.5, pr.y + (pr.vy / l) * 0.5, pr.z + (pr.vz / l) * 0.5, 0.08, c, 2.5);
      } else {
        R.ball(pr.x, pr.y, pr.z, pr.r * 0.6, c, 3);
      }
      R.glow(pr.x, pr.y, pr.z, pr.r * 2.2, c[0], c[1], c[2], 0.6, 0);
      if (dt > 0) this.particles.emit({ x: pr.x, y: pr.y, z: pr.z, life: 0.25, size: pr.r * 1.2, size1: 0, color: c, alpha: 0.6, shape: SHAPE.GLOW });
    }
    // pickups
    for (const o of this.pickups) {
      if (o.kind === 'xp') {
        const s = 0.12 + Math.min(0.2, o.value * 0.01);
        R.glow(o.x, o.y, o.z, s * 2.2, 0.35, 0.9, 1, 0.9, 0);
        R.glow(o.x, o.y, o.z, s * 0.8, 0.8, 1, 1, 1, 0);
      } else if (o.kind === 'shard') {
        R.trs(PRIM.OCTA, o.x, o.y, o.z, this.time * 3 + o.vx, 0, 0, 0.1, 0.2, 0.1, [1, 0.75, 0.3], 1.5);
        R.glow(o.x, o.y, o.z, 0.35, 1, 0.7, 0.2, 0.5, 0);
      } else {
        R.trs(PRIM.BOX, o.x, o.y, o.z, this.time * 2, 0, 0, 0.25, 0.08, 0.08, [0.3, 1, 0.4], 1.5);
        R.trs(PRIM.BOX, o.x, o.y, o.z, this.time * 2, 0, 0, 0.08, 0.25, 0.08, [0.3, 1, 0.4], 1.5);
      }
    }
    // lightning bolts
    for (const b of this.bolts) {
      for (let i = 1; i < b.pts.length; i++) {
        const a = b.pts[i - 1], c = b.pts[i];
        R.seg(a[0], a[1], a[2], c[0], c[1], c[2], 0.035, b.color, 5);
      }
      const m = b.pts[(b.pts.length / 2) | 0];
      R.light(m[0], m[1], m[2], 8, b.color[0], b.color[1], b.color[2], 2);
    }
    this.particles.update(dt);
    R.render(this.dim.env, rawDt);
    this.ui.drawOverlay(this);
  }
}

const ARENA_START = 16;

function hex(h) {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

