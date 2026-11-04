// Game orchestrator: run lifecycle, dimensions, camera, combat resolution, hazards, projectiles, pickups and rendering.
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
import { Abilities } from './abilities.js';
import { Spawner } from './spawner.js';
import { PLAYER_BASE } from './config.js';
import { rollOffers, applyOffer } from './upgrades.js';
import { WEAPON_IDS } from './weapons.js';
import { echoesForRun } from './meta.js';

const COMBO_RANKS = [[0, ''], [5, 'Fervent'], [10, 'Unhinged'], [20, 'Abyssal'], [35, 'Apotheosis'], [60, 'Godslayer']];

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
    this.abilities = new Abilities(this);
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
    if (stats.startWeapon) this.player.equip(this.rng.pick(WEAPON_IDS), 1);
    this.rerolls = stats.rerolls;
    this.revives = stats.revives;
    this.abilities = new Abilities(this);
    this.spawner = new Spawner(this);
    this.run = { kills: 0, level: 1, depth: 0, bosses: 0, time: 0, chests: 0, dmgDealt: 0, maxCombo: 0 };
    this.combo = 0;
    this.comboT = 0;
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
    if (mode === 'open') this.ui.title(this.dim.name, this.dim.sub, `Depth ${depth + 1}`);
    else this.ui.title('Rift Sanctum', 'Something vast stirs beyond the rim', `Depth ${depth + 1}`);
  }

  _refreshScaling() {
    const d = this.depth;
    this.scaling = {
      hp: 1 + 0.85 * d + this.dimTime / 210,
      dmg: 1 + 0.32 * d + this.dimTime / 520,
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

  /** Freeflow target selection: prefer enemies in the input direction, then nearest to camera forward. */
  findTarget(x, z, dx, dz, range) {
    let ix = dx, iz = dz;
    if (Math.hypot(ix, iz) < 0.1) { ix = this.camFwd[0]; iz = this.camFwd[2]; }
    const il = Math.hypot(ix, iz) || 1;
    ix /= il; iz /= il;
    let best = null, bs = Infinity;
    for (const e of this.enemies) {
      if (!e.alive || e.state === 'spawn' || e.untargetable) continue;
      const ex = e.x - x, ez = e.z - z;
      const d = Math.hypot(ex, ez);
      if (d > range + e.radius) continue;
      const dot = d > 0.01 ? (ex * ix + ez * iz) / d : 1;
      if (dot < -0.2 && d > 2.5) continue;
      const score = d + (1 - dot) * 5 - (e.telegraph ? 1.5 : 0) - (e.boss ? 1 : 0);
      if (score < bs) { bs = score; best = e; }
    }
    return best;
  }

  counterableEnemies(x, z, range) {
    const list = [];
    for (const e of this.enemies) {
      if (!e.alive || !e.counterable || e.state !== 'windup') continue;
      const d = Math.hypot(e.x - x, e.z - z);
      if (d < range + e.radius) list.push({ e, d });
    }
    list.sort((a, b) => a.d - b.d);
    return list.map((l) => l.e);
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
  comboRank() {
    let r = '';
    for (const [n, name] of COMBO_RANKS) if (this.combo >= n) r = name;
    return r;
  }

  playerStrike(p, move, hitIndex) {
    const st = p.stats;
    const w = p.weapon;
    const reach = w.reach * move.reach * st.reach;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    const arcCos = move.arc >= 360 ? -2 : Math.cos(((move.arc * Math.PI) / 360) * (1 + (st.areaMul - 1) * 0.5));
    const cx = p.x + fx * reach * 0.25, cz = p.z + fz * reach * 0.25;
    const baseDmg = w.dmg * move.dmg * st.dmgMul * (move.ultimate ? 6 : 1);
    let hits = 0;
    const hitR = move.ultimate ? 11 * st.areaMul : reach;
    const checked = new Set();
    const tryHit = (e) => {
      if (checked.has(e)) return;
      checked.add(e);
      const dx = e.x - p.x, dz = e.z - p.z;
      const d = Math.hypot(dx, dz) || 1e-4;
      if (!move.ultimate && arcCos > -1 && d > e.radius + 0.6 && (dx * fx + dz * fz) / d < arcCos && !e.def.hitTest) return;
      const comboMul = 1 + Math.min(1.5, this.combo * st.comboDmg);
      const crit = move.name === 'finisher' || move.counter || Math.random() < st.critChance;
      let dmg = baseDmg * comboMul * (crit ? st.critMul : 1) * (move.counter ? 1.3 : 1) * (0.92 + Math.random() * 0.16);
      if (e.state === 'stagger') dmg *= 1.15;
      const info = { dmg, crit, dirX: dx / d, dirZ: dz / d, kb: move.kb * st.knockback * (1.2 - (hitIndex ? 0.4 : 0)), launch: move.launch, heavy: !!move.heavy || (move.dmg >= 1.8), counter: !!move.counter, source: 'melee', color: w.trailColor, impact: move.name === 'finisher' || !!move.ultimate };
      this.damageEnemy(e, info);
      hits++;
    };
    this.forEnemiesNear(cx, cz, hitR, tryHit);
    if (this.boss && this.boss.alive && !checked.has(this.boss) && this.boss.def.hitTest && this.boss.def.hitTest(this.boss, cx, cz, hitR)) tryHit(this.boss);
    // destructibles
    this.world.hitDestructibles(cx, cz, hitR, baseDmg, this, fx, fz, arcCos);
    // shockwave
    if (move.shock || move.ultimate) {
      const r = move.ultimate ? 11 : move.shock * st.areaMul;
      this.shockwave(p.x + fx * reach * 0.7, p.z + fz * reach * 0.7, r, w.trailColor, move.ultimate);
      if (move.shock && !move.ultimate) {
        this.forEnemiesNear(p.x + fx * reach * 0.7, p.z + fz * reach * 0.7, r, (e) => {
          if (checked.has(e)) return;
          checked.add(e);
          this.damageEnemy(e, { dmg: baseDmg * 0.45, dirX: e.x - p.x, dirZ: e.z - p.z, kb: 6, source: 'shock', color: w.trailColor });
        });
      }
    }
    if (move.heavy || move.name === 'slam' || move.name === 'overhead') this.abilities.onHeavy(p.x + fx * 2, p.z + fz * 2);
    if (hits > 0) {
      const big = move.name === 'finisher' || move.counter || move.ultimate;
      this.hitstop(big ? 0.12 : 0.045 + Math.min(0.04, hits * 0.01));
      this.shake(big ? 0.7 : 0.18 + move.dmg * 0.08);
      if (w.def.leech) p.hp = Math.min(st.maxHp, p.hp + hits * w.def.leech * st.maxHp * 0.1);
    }
  }

  damageEnemy(e, info) {
    if (!e.alive) return;
    const p = this.player;
    const killed = e.takeHit(info, this);
    this.run && (this.run.dmgDealt += info.dmg);
    if (p.stats.lifesteal > 0 && info.source === 'melee') p.hp = Math.min(p.stats.maxHp, p.hp + info.dmg * p.stats.lifesteal);
    // feedback
    const y = e.y + (e.boss ? (e.cy ? e.cy - e.y : 2.5 * e.size) : 1.2 * e.size);
    if (!info.quiet || Math.random() < 0.25) this.number(e.x, y + 0.6, e.z, info.dmg, info.crit, info.color);
    if (info.source === 'melee' || info.source === 'shock' || info.crit) {
      const n = info.crit ? 22 : 10;
      this.particles.burst(e.x, y, e.z, n, { speed: info.crit ? 9 : 6, dir: [info.dirX, 0.4, info.dirZ], spread: 0.8, color: this.dim.blood, shape: SHAPE.CHUNK, size: 0.08, life: 0.7, grav: 16, bounce: 0.15, additive: false });
      this.particles.burst(e.x, y, e.z, info.crit ? 14 : 6, { speed: 10, dir: [info.dirX, 0.2, info.dirZ], spread: 1, color: info.color || [1, 1, 1], shape: SHAPE.SPARK, size: 0.07, life: 0.35, grav: 4 });
      this.particles.emit({ x: e.x, y, z: e.z, life: 0.12, size: info.crit ? 1.6 : 0.9, size1: 0.2, color: info.color || [1, 1, 1], shape: SHAPE.STAR });
      this.audio.play(info.crit ? 'crit' : 'hit', info.crit ? 1 : 0.8);
      if (Math.random() < 0.5) this.splat(e.x + info.dirX * 1.2, e.z + info.dirZ * 1.2, 0.5 + Math.random() * 0.7);
    }
    if (info.source === 'melee') {
      this.combo++;
      this.comboT = 3.2;
      if (this.run) this.run.maxCombo = Math.max(this.run.maxCombo, this.combo);
      p.ult = Math.min(1, p.ult + (info.crit ? 0.02 : 0.012) * p.stats.ultCharge * (info.counter ? 3 : 1));
      this.abilities.onHit(e, info);
    }
    if (info.burn) { e.burnT = 2.5; e.burnDps = info.burn; }
    if (info.impact || (info.counter && info.source === 'melee')) this.impact();
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
    this.splat(e.x, e.z, 1 + Math.random() * 0.8 * e.size);
    this.audio.play('death');
    if (this.run) this.run.kills++;
    // rewards
    const xp = e.xp * p.stats.xpMul * (1 + this.depth * 0.25);
    const orbs = e.boss ? 30 : Math.max(1, Math.round(xp / 6));
    for (let i = 0; i < orbs; i++) this.drop('xp', e.x, y, e.z, xp / orbs);
    let sh = e.def.shard * p.stats.shardMul * (e.elite ? 5 : 1) * (1 + this.depth * 0.3);
    while (sh > 0) {
      if (sh >= 1 || Math.random() < sh) this.drop('shard', e.x, y, e.z, 1);
      sh -= 1;
    }
    if (Math.random() < 0.025 || e.elite) this.drop('heal', e.x, y, e.z, 0.12);
    this.abilities.onKill(e);
    if (e.boss) this.onBossKilled(e);
  }

  damagePlayer(dmg, src, opts = {}) {
    const p = this.player;
    if (!p.alive || this.state !== 'play') return;
    if (!opts.tick && p.invuln()) return;
    if (opts.tick && (p.state === 'dodge')) return;
    const real = dmg * (1 - p.stats.armor);
    if (opts.tick) { p.hp -= real; } else {
      p.hurt(real, src ? src.x : p.x, src ? src.z : p.z);
      this.combo = 0;
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
    e.maxHp = e.hp = def.hp * (1 + this.depth * 1.1);
    e.dmg = def.dmg * (1 + this.depth * 0.3);
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
  lungeFx(p) {
    this.fovKick = 0.12;
    if (Math.random() < 0.9) {
      const P = p.anim.pts;
      const i = ((Math.random() * 16) | 0) * 3;
      this.particles.emit({ x: P[i], y: P[i + 1], z: P[i + 2], life: 0.18, size: 0.2, size1: 0, color: p.weapon.trailColor, alpha: 0.5, shape: SHAPE.GLOW });
    }
    this.particles.emit({ x: p.x, y: p.y + 0.1, z: p.z, vx: -p.vx * 0.1, vy: 1, vz: -p.vz * 0.1, life: 0.4, size: 0.3, size1: 0.6, color: this.dim.ash, shape: SHAPE.SMOKE, additive: false, alpha: 0.4 });
  }

  counterFx(p, t) {
    this.audio.play('counter');
    this.slowmo(0.35, 0.25);
    this.R.post_.aberr = 1.6;
    this.particles.burst(t.x, t.y + 1.6 * t.size, t.z, 30, { speed: 7, color: [0.6, 0.95, 1], shape: SHAPE.SPARK, size: 0.07, life: 0.4 });
    this.particles.emit({ x: t.x, y: t.y + 1.6 * t.size, z: t.z, life: 0.25, size: 2.5, size1: 0.2, color: [0.7, 1, 1], shape: SHAPE.STAR });
    this.particles.emit({ x: t.x, y: t.y + 0.1, z: t.z, life: 0.4, size: 0.3, size1: 4, color: [0.6, 0.95, 1], shape: SHAPE.RING });
  }

  onDodge(p) {
    this.abilities.onDodge(p);
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
    if (intro) this.ui.title(e.name, text, 'BOSS');
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
      p.xpNext = Math.floor(8 + p.level * 5 + Math.pow(p.level, 1.65) * 1.8);
      this.pendingLevels++;
      if (this.run) this.run.level = p.level;
    }
  }

  _openOffers(kind, opts) {
    const p = this.player;
    const n = 3 + (p.stats.extraChoice || 0);
    const offers = rollOffers(this.rng, p, n, { luck: p.stats.luck + (opts.luck || 0), minTier: opts.minTier || 0, weaponChance: opts.weaponChance });
    this.state = 'levelup';
    this.input.releaseLock();
    this.audio.play(kind === 'level' ? 'levelup' : 'chest');
    this.ui.showOffers({
      title: opts.title, subtitle: opts.subtitle, offers, rerolls: this.rerolls,
      onPick: (o) => {
        const swapped = applyOffer(p, o);
        this.audio.play('select');
        this.particles.burst(p.x, p.y + 1, p.z, 40, { speed: 6, color: o.color ? hex(o.color) : [1, 1, 1], shape: SHAPE.SPARK, size: 0.08, life: 0.7, grav: 3 });
        if (swapped) this.announce(`${o.name} equipped`, 'loot');
        this.ui.hideOffers();
        this.state = 'play';
        this.input.requestLock();
        this._checkQueues();
      },
      onReroll: () => {
        if (this.rerolls <= 0) return null;
        this.rerolls--;
        this.audio.play('ui');
        return rollOffers(this.rng, p, n, { luck: p.stats.luck + (opts.luck || 0), minTier: opts.minTier || 0, weaponChance: opts.weaponChance });
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
      this._openOffers('level', { title: `Level ${this.player.level - this.pendingLevels}`, subtitle: 'The abyss offers a gift. Choose one.' });
    }
  }

  tryOpenChest(c) {
    const p = this.player;
    const cost = this.world.chestCost(c, p.stats.chestDiscount);
    if (p.shards < cost) {
      this.announce(`Requires ${cost} shards`, 'warn');
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
    this.offerQueue.push({ kind: 'chest', title: t.name, subtitle: 'Its contents whisper your name.', minTier: t.minTier, luck: t.luck, weaponChance: 0.35 });
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
    this.announce(`${e.name} has fallen`, 'boss');
    this.offerQueue.push({ kind: 'chest', title: 'Relic of the Fallen', subtitle: 'Power torn from a dying god.', minTier: 3, luck: 1, weaponChance: 0.45 });
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
      this.announce('Second Breath', 'boss');
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
    // camera look
    const m = input.takeMouse(this._mouse);
    const sens = this.settings.sensitivity ?? 1;
    this.camYaw -= m[0] * sens;
    this.camPitch = clamp(this.camPitch + m[1] * sens, -0.1, 1.15);
    if (Math.abs(m[0]) + Math.abs(m[1]) > 1e-4) this.lastLookT = this.time;
    // soft boss framing: when the player isn't steering the camera, swing it to keep the boss in view
    const b = this.boss;
    if (b && b.alive && b.state !== 'spawn' && this.time - (this.lastLookT || 0) > 1.2) {
      const want = Math.atan2(b.x - this.player.x, b.z - this.player.z);
      this.camYaw = dampAngle(this.camYaw, want, 1.6, rawDt);
    }

    this.player.update(dt, input);
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }
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
    // enemies
    for (const e of this.enemies) if (e.alive) e.update(dt, this);
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
    if (this.state === 'play') {
      this.spawner.update(dt);
      this.abilities.update(dt);
    }
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

  _updateHazards(dt) {
    const p = this.player;
    for (const h of this.hazards) {
      if (h.cancelled) { h.done = true; continue; }
      h.t -= dt;
      if (h.t > 0 || h.done) continue;
      h.done = true;
      const y = this.world.height(h.x, h.z);
      const c = h.color;
      if (h.owner === 'enemy') {
        const d = Math.hypot(p.x - h.x, p.z - h.z);
        if (d < h.r + p.radius * 0.5) this.damagePlayer(h.dmg, h.src || { x: h.x, z: h.z });
      } else {
        this.forEnemiesNear(h.x, h.z, h.r, (e) => this.damageEnemy(e, { dmg: h.dmg, dirX: e.x - h.x, dirZ: e.z - h.z, kb: 6, source: h.kind, color: c, burn: h.burn, crit: h.kind === 'star' && Math.random() < p.stats.critChance }));
        this.world.hitDestructibles(h.x, h.z, h.r, h.dmg, this);
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
    for (const pr of this.projectiles) {
      pr.life -= dt;
      if (pr.homing) {
        const t = pr.target && pr.target.alive ? pr.target : (pr.target = this.nearestEnemy(pr.x, pr.z, 25));
        if (t) {
          const dx = t.x - pr.x, dy = t.y + 1 * t.size - pr.y, dz = t.z - pr.z;
          const l = Math.hypot(dx, dy, dz) || 1;
          const sp = 18;
          pr.vx += ((dx / l) * sp - pr.vx) * Math.min(1, dt * pr.homing * 0.4);
          pr.vy += ((dy / l) * sp - pr.vy) * Math.min(1, dt * pr.homing * 0.4);
          pr.vz += ((dz / l) * sp - pr.vz) * Math.min(1, dt * pr.homing * 0.4);
        }
      }
      if (pr.grav) pr.vy -= pr.grav * dt;
      pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.z += pr.vz * dt;
      const g = W.height(pr.x, pr.z);
      if (pr.groundSkim && pr.y < g + 0.9) { pr.y = g + 0.9; pr.vy = 0; }
      if (pr.y < g) { pr.life = 0; this.particles.burst(pr.x, g + 0.1, pr.z, 8, { speed: 4, color: pr.color, shape: SHAPE.SPARK, size: 0.05, life: 0.4, grav: 8 }); continue; }
      if (pr.owner === 'enemy') {
        const dx = p.x - pr.x, dy = p.y + 1.1 - pr.y, dz = p.z - pr.z;
        if (dx * dx + dy * dy + dz * dz < (pr.r + 0.45) ** 2) {
          if (!p.invuln()) { this.damagePlayer(pr.dmg, { x: pr.x - pr.vx, z: pr.z - pr.vz, alive: false }); pr.life = 0; }
        }
      } else {
        this.forEnemiesNear(pr.x, pr.z, pr.r, (e) => {
          if (pr.life <= 0) return;
          this.damageEnemy(e, { dmg: pr.dmg, dirX: pr.vx, dirZ: pr.vz, kb: 3, source: pr.kind, color: pr.color });
          pr.life = 0;
        });
      }
      if (pr.life <= 0) this.particles.burst(pr.x, pr.y, pr.z, 10, { speed: 4, color: pr.color, shape: SHAPE.SPARK, size: 0.06, life: 0.35 });
    }
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
          this.announce(left ? `Obelisk awakened — the Rift draws nearer (${left} remain)` : 'All obelisks awakened — the Rift tears open', 'objective');
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
        this.announce('A Rift has opened. Reach it before it closes!', 'objective');
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
        this.announce('The Rift collapsed. Something hunts you now...', 'warn');
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
    if (dt > 0) W.ambient(this, this.player.x, this.player.y, this.player.z, dt);
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
        const k = 1 - Math.max(0, e.stateT) / (e.windupTime || 1);
        const hy = e.y + (e.boss ? (e.cy ? e.cy - e.y + 3.5 : 3.6 * e.size + 1) : 2.3 * e.size);
        if (e.counterable) {
          const pulse = 0.6 + Math.sin(this.time * 30) * 0.4;
          R.glow(e.x, hy, e.z, 0.6 + k * 0.5, 0.6, 1, 1, pulse, SHAPE.STAR);
          R.glow(e.x, hy, e.z, 1.2, 0.3, 0.8, 1, 0.4, SHAPE.GLOW);
          R.decal(e.x, e.y + 0.08, e.z, e.radius * 2.2, 0.5, 0.95, 1, 0.6, SHAPE.RING);
        } else {
          R.glow(e.x, hy, e.z, 0.5 + k * 0.4, 1, 0.2, 0.15, 0.9, SHAPE.STAR);
        }
      }
    }
    // player
    if (this.player.alive) {
      this.player.draw(R);
      R.decal(this.player.x, this.player.y + 0.05, this.player.z, 0.65, 0, 0, 0, 0.5, 0);
    }
    this.ragdolls.draw(R, !!(this.style && this.style.models), (x, z) => this.world.height(x, z), drawBody);
    this.abilities.draw(R);
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

