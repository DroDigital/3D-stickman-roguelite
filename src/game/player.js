// The player: movement, sprint, dodge, the Blade slot's melee chain, lock-on facing, animation layering,
// weapon trails and cloth scarf. The other three slots live in the Loadout (arsenal.js).
import { HumanoidAnimator, humanoidTopology, CLIPS, J } from './humanoid.js';
import { drawRig } from './rig.js';
import { Anatomy, BODIES, castBody, drawBody, drawSkeleton } from './anatomy.js';
import { makeWeapon, drawWeapon, weaponBasis, MOVES, WEAPONS } from './weapons.js';
import { Loadout, ITEMS } from './arsenal.js';
import { SHAPE } from '../gfx/particles.js';
import { clamp, dampAngle } from '../core/math.js';
import { PRIM } from '../gfx/renderer.js';

const SPRINT = 1.55;
const tmpU = [0, 0, 0], tmpV = [0, 0, 0], tmpW = [0, 0, 0], tmpRef = [0, 0, 0];

export class Player {
  constructor(game, stats) {
    this.game = game;
    this.stats = stats;
    this.hp = stats.maxHp;
    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vz = 0;
    this.yaw = 0;
    this.radius = 0.45;
    this.level = 1;
    this.xp = 0;
    this.xpNext = 14;
    this.shards = 0;
    this.taken = {};
    this.buffs = { berserkT: 0 };
    this.topo = humanoidTopology(0.042, 0.16);
    this.anim = new HumanoidAnimator(1);
    this.palette = [{ c: [0.86, 0.84, 0.8], e: 0.06 }];
    this.anatomy = new Anatomy(BODIES.hero, 1);
    this.state = 'free';
    this.stateT = 0;
    this.comboIdx = 0;
    this.comboWindow = 0;
    this.dodgeCd = 0;
    this.invulnT = 0;
    this.hurtFlash = 0;
    this.ult = 0;
    this.move = null;
    this.hitDone = 0;
    this.alive = true;
    this.sprinting = false;
    this.accF = 0; this.accS = 0;
    this.prevTip = null;
    this.prevBase = null;
    this.prevTipL = null;
    this.scarf = Array.from({ length: 8 }, () => ({ x: 0, y: 1.5, z: 0, px: 0, py: 1.5, pz: 0 }));
    this.loadout = new Loadout(game);
    this.weapon = makeWeapon('blade', 0);
    this.loadout.slots.blade = { id: 'katana', level: 1, cd: 0, state: {} };
    this.refreshBlade();
  }

  /** Rebuild the hand-held model and melee numbers from the Blade slot. */
  refreshBlade() {
    const s = this.loadout.slots.blade;
    const def = s ? ITEMS[s.id] : ITEMS.katana;
    const level = s ? s.level : 1;
    const tier = def.evolved ? 5 : Math.min(4, level - 1);
    this.weapon = makeWeapon(def.model, tier);
    const st = def.stats(level);
    this.weapon.dmg = st.dmg;
    this.weapon.speed = st.speed;
    this.weapon.combo = def.combo;
    this.weapon.shock = st.shock || 0;
    if (def.tint) { this.weapon.trailColor = def.tint; this.weapon.colors.glow = def.tint; }
    this.anim.stance = WEAPONS[def.model].stance;
    this.comboIdx = 0;
    this.palette[0].e = 0.06 + tier * 0.015;
  }

  invuln() {
    return this.invulnT > 0 || this.state === 'dodge' || this.state === 'ult' || this.state === 'dash';
  }

  get busy() { return this.state !== 'free'; }

  placeAt(x, z) {
    this.x = x; this.z = z;
    this.y = this.game.world.height(x, z);
    for (const s of this.scarf) { s.x = s.px = x; s.y = s.py = this.y + 1.4; s.z = s.pz = z; }
  }

  // ------------------------------------------------------------ actions
  _attackSpeed() {
    return this.weapon.speed * this.stats.atkSpeed * (this.buffs.berserkT > 0 ? 1.35 : 1);
  }

  _startMove(moveName, clip, flags = {}) {
    this.move = { name: moveName, ...MOVES[moveName], ...flags };
    this.hitDone = 0;
    const speed = flags.speed ?? this._attackSpeed();
    this.anim.play(clip, speed);
    this.state = flags.state || 'attack';
    this.stateT = clip.dur / speed;
    this.clip = clip;
    this.game.audio.play(this.move.sfx, 0.8);
  }

  /** Direction the player wants to act in: the lock-on target, else stick/keys, else the camera. */
  _actDir() {
    const g = this.game;
    const t = g.lock;
    if (t && t.alive) return [t.x - this.x, t.z - this.z];
    const d = g.inputWorldDir();
    if (Math.hypot(d[0], d[1]) > 0.1) return [d[0], d[1]];
    return [g.camFwd[0], g.camFwd[2]];
  }

  /** Blade slot: the next cut in the chain. No lunging: the cut lands where you stand. */
  tryAttack() {
    const w = this.weapon;
    const chaining = this.state === 'attack';
    if (this.comboWindow <= 0 && !chaining) this.comboIdx = 0;
    const moveName = w.combo[this.comboIdx % w.combo.length];
    this.comboIdx++;
    const d = this._actDir();
    if (Math.hypot(d[0], d[1]) > 1e-3) this.yaw = Math.atan2(d[0], d[1]);
    this._startMove(moveName, CLIPS[moveName]);
    this.sprinting = false;
  }

  tryDodge(dirX, dirZ) {
    if (this.dodgeCd > 0) return false;
    let dx = dirX, dz = dirZ;
    let back = false;
    if (Math.hypot(dx, dz) < 0.1) { dx = -Math.sin(this.yaw); dz = -Math.cos(this.yaw); back = true; }
    const l = Math.hypot(dx, dz);
    dx /= l; dz /= l;
    this.state = 'dodge';
    this.stateT = 0.4;
    this.dodgeDir = [dx, dz];
    if (!back) this.yaw = Math.atan2(dx, dz);
    this.anim.play(back ? CLIPS.backflip : CLIPS.dodge, (back ? CLIPS.backflip.dur : CLIPS.dodge.dur) / 0.4, 0.05);
    this.dodgeCd = this.stats.dodgeCd;
    this.game.audio.play('dodge');
    this.game.onDodge(this);
    return true;
  }

  /** Short invulnerable dash used by powers (Afterimage). */
  dash(dx, dz, dist, dur) {
    const l = Math.hypot(dx, dz) || 1;
    this.state = 'dash';
    this.stateT = dur;
    this.dashV = [(dx / l) * (dist / dur), (dz / l) * (dist / dur)];
    this.yaw = Math.atan2(dx, dz);
    this.anim.play(CLIPS.dodge, CLIPS.dodge.dur / dur, 0.05);
  }

  /** Brief casting gesture for Arcana and Power (doesn't interrupt a dash or dodge). */
  castPose() {
    if (this.state === 'free' || this.state === 'attack') {
      const d = this._actDir();
      if (Math.hypot(d[0], d[1]) > 1e-3) this.yaw = Math.atan2(d[0], d[1]);
      this.anim.play(CLIPS.cast, CLIPS.cast.dur / 0.35);
      this.state = 'cast';
      this.stateT = 0.3;
    }
  }

  /** Arms fire: turn toward the aim point. */
  aimPose(aim) {
    if (this.state === 'free' || this.state === 'cast') this.yaw = dampAngle(this.yaw, Math.atan2(aim.dx, aim.dz), 30, 1 / 30);
  }

  tryUltimate() {
    if (this.ult < 1) return false;
    this.ult = 0;
    this._startMove('finisher', CLIPS.finisher, { state: 'ult', speed: 0.85, ultimate: true });
    this.game.slowmo(0.9, 0.35);
    this.game.audio.play('portal');
    return true;
  }

  hurt(dmg, srcX, srcZ) {
    this.hp -= dmg;
    this.invulnT = 0.5;
    this.hurtFlash = 1;
    const dx = this.x - srcX, dz = this.z - srcZ, d = Math.hypot(dx, dz) || 1;
    this.vx += (dx / d) * 7; this.vz += (dz / d) * 7;
    this.sprinting = false;
    if (this.state === 'free' || this.state === 'attack' || this.state === 'cast') {
      this.state = 'hurt';
      this.stateT = 0.28;
      this.anim.play(CLIPS.hit, 1, 0.03);
    }
    this.anim.hitReact(1.2, Math.random() - 0.5);
  }

  // ------------------------------------------------------------ update
  _clipHits() {
    if (!this.clip) return [];
    return [this.clip.hitT, this.clip.hitT2].filter((v) => v !== undefined);
  }

  /** Trigger every hit threshold the active strike animation has passed. */
  _resolveHits() {
    const s = this.state;
    if (s !== 'attack' && s !== 'ult') return;
    const hits = this._clipHits();
    const p = this.anim.progress;
    while (this.hitDone < hits.length && p >= hits[this.hitDone]) {
      this.game.playerStrike(this, this.move, this.hitDone);
      this.hitDone++;
    }
  }

  update(dt, input) {
    const g = this.game;
    const st = this.stats;
    this.dodgeCd -= dt;
    this.invulnT -= dt;
    this.comboWindow -= dt;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 3);
    if (this.hp < st.maxHp) this.hp = Math.min(st.maxHp, this.hp + st.regen * dt);

    const mv = g.inputWorldDir();
    const mx = mv[0], mz = mv[1];
    const moving = Math.hypot(mx, mz) > 0.1;
    const lock = g.lock && g.lock.alive ? g.lock : null;

    this._resolveHits();
    const hits = this._clipHits();
    const attackDone = this.state === 'attack' && this.hitDone >= hits.length && this.anim.progress > (hits.length ? hits[hits.length - 1] : 0.5) + 0.08;
    const canAct = this.state === 'free' || this.state === 'cast' && this.stateT < 0.12 || attackDone || this.state === 'hurt' && this.stateT < 0.08;
    const canDodge = this.state !== 'dodge' && this.state !== 'ult' && this.state !== 'dash';
    // a dodge pressed before it can fire waits for that moment: it is held through the cooldown and the dodge itself
    const dodgeReady = canDodge && this.dodgeCd <= 0;
    if (input.peek('dodge') && !dodgeReady) input.hold('dodge', (Math.max(this.dodgeCd, this.stateT, 0) + 0.05) / Math.max(0.05, g.timeScale || 1));
    if (input.peek('dodge') && dodgeReady) { input.consume('dodge'); this.tryDodge(mx, mz); }
    else if (input.peek('ultimate') && canAct && this.ult >= 1) { input.consume('ultimate'); this.tryUltimate(); }
    else if (canAct && (input.peek('attack') || input.held('attack') && this.state !== 'attack')) { input.consume('attack'); this.tryAttack(); }
    // spells: a press made up to 0.3 s before its spell is ready is kept and fires the moment it can
    for (const key of ['magic', 'power']) {
      if (!input.peek(key) || this.state === 'ult') continue;
      const left = this.loadout.cooldown(key);
      if (left <= 0) { input.consume(key); this.loadout.trigger(key); }
      else if (left <= 0.3) input.hold(key, left / Math.max(0.05, g.timeScale || 1) + 0.05);
    }
    // Arms fire while held; sprinting, dodging and dashing hold fire
    const canFire = this.alive && this.state !== 'dodge' && this.state !== 'dash' && this.state !== 'ult' && !this.sprinting;
    this.loadout.update(dt, input, canFire);

    // sprint: hold while moving freely; any action ends it
    this.sprinting = input.held('sprint') && moving && this.state === 'free' && !input.held('arms');

    let wantVX = 0, wantVZ = 0, accel = 14;
    this.stateT -= dt;
    switch (this.state) {
      case 'free':
      case 'cast': {
        const sp = st.moveSpeed * (this.sprinting ? SPRINT * st.sprintMul : 1) * (this.state === 'cast' ? 0.5 : 1);
        wantVX = mx * sp; wantVZ = mz * sp;
        if (lock && !this.sprinting) this.yaw = dampAngle(this.yaw, Math.atan2(lock.x - this.x, lock.z - this.z), 12, dt);
        else if (moving) this.yaw = dampAngle(this.yaw, Math.atan2(mx, mz), 14, dt);
        if (this.state === 'cast' && this.stateT <= 0) this.state = 'free';
        break;
      }
      case 'attack':
      case 'ult': {
        if (lock) this.yaw = dampAngle(this.yaw, Math.atan2(lock.x - this.x, lock.z - this.z), 16, dt);
        const p = this.anim.progress;
        // small committed step into each cut
        const push = p < (this.clip.hitT || 0.4) ? 1.8 : 0.2;
        wantVX = Math.sin(this.yaw) * push + mx * 1.0;
        wantVZ = Math.cos(this.yaw) * push + mz * 1.0;
        this._resolveHits();
        if (!this.anim.playing || this.stateT <= -0.05) {
          this.state = 'free';
          this.comboWindow = 0.5;
        }
        break;
      }
      case 'dodge': {
        const k = clamp(this.stateT / 0.4, 0, 1);
        const sp = 14 * (0.4 + k * 0.9);
        wantVX = this.dodgeDir[0] * sp; wantVZ = this.dodgeDir[1] * sp;
        accel = 30;
        if (this.stateT <= 0) this.state = 'free';
        break;
      }
      case 'dash':
        wantVX = this.dashV[0]; wantVZ = this.dashV[1];
        accel = 60;
        if (this.stateT <= 0) { this.state = 'free'; this.vx *= 0.3; this.vz *= 0.3; }
        break;
      case 'hurt':
        if (this.stateT <= 0) this.state = 'free';
        break;
      case 'dead':
        wantVX = wantVZ = 0;
        break;
      default:
        break;
    }

    const pvx = this.vx, pvz = this.vz;
    this.vx += (wantVX - this.vx) * Math.min(1, dt * accel);
    this.vz += (wantVZ - this.vz) * Math.min(1, dt * accel);
    this.x += this.vx * dt; this.z += this.vz * dt;
    // acceleration in local frame for lean
    const ax = (this.vx - pvx) / Math.max(dt, 1e-4), az = (this.vz - pvz) / Math.max(dt, 1e-4);
    const s0 = Math.sin(this.yaw), c0 = Math.cos(this.yaw);
    this.accF += ((ax * s0 + az * c0) - this.accF) * Math.min(1, dt * 8);
    this.accS += ((ax * c0 - az * s0) - this.accS) * Math.min(1, dt * 8);
    g.world.resolve(this, this.radius);
    if (this.state !== 'dodge' && this.state !== 'dash') g.pushFromEnemies(this);
    g.world.clampToBounds(this);
    this.y = g.world.height(this.x, this.z);

    // animation
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    let fwd = this.vx * s + this.vz * c, side = this.vx * c - this.vz * s;
    if (this.state === 'dash') { fwd = 14; side = 0; }
    this.anim.update(dt, {
      fwdSpeed: fwd, sideSpeed: side, accF: this.accF, accS: this.accS, combat: g.inCombat ? 1 : 0,
      x: this.x, y: this.y, z: this.z, yaw: this.yaw, ground: (x, z) => g.world.height(x, z),
    });
    this._updateScarf(dt);
    if (g.style && g.style.models) {
      const body = castBody(g.style.cast, 'hero');
      if (this.anatomy.body !== body) this.anatomy = new Anatomy(body, 1);
      this.anatomy.update(dt, this.anim.pts, (x, z) => g.world.height(x, z));
    }
    this._trail(dt);
  }

  _updateScarf(dt) {
    const P = this.anim.pts;
    const nx = P[J.NECK * 3], ny = P[J.NECK * 3 + 1], nz = P[J.NECK * 3 + 2];
    const bx = -Math.sin(this.yaw) * 0.12, bz = -Math.cos(this.yaw) * 0.12;
    const sc = this.scarf;
    sc[0].x = nx + bx; sc[0].y = ny - 0.02; sc[0].z = nz + bz;
    const t = this.game.time;
    const h = Math.min(dt, 1 / 30);
    for (let i = 1; i < sc.length; i++) {
      const p = sc[i];
      const vx = (p.x - p.px) * 0.94, vy = (p.y - p.py) * 0.94, vz = (p.z - p.pz) * 0.94;
      p.px = p.x; p.py = p.y; p.pz = p.z;
      p.x += vx + Math.sin(t * 3 + i) * 0.002;
      p.y += vy - 9 * h * h;
      p.z += vz + Math.cos(t * 2.3 + i) * 0.002;
      const g = this.game.world.height(p.x, p.z) + 0.03;
      if (p.y < g) p.y = g;
    }
    const L = 0.13;
    for (let it = 0; it < 3; it++) {
      for (let i = 1; i < sc.length; i++) {
        const a = sc[i - 1], b = sc[i];
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const d = Math.hypot(dx, dy, dz) || 1e-4;
        const k = (d - L) / d;
        if (i === 1) { b.x -= dx * k; b.y -= dy * k; b.z -= dz * k; } else {
          a.x += dx * k * 0.5; a.y += dy * k * 0.5; a.z += dz * k * 0.5;
          b.x -= dx * k * 0.5; b.y -= dy * k * 0.5; b.z -= dz * k * 0.5;
        }
      }
      sc[0].x = nx + bx; sc[0].y = ny - 0.02; sc[0].z = nz + bz;
    }
  }

  /** Writes weapon tip/base world positions for right (and left) hand. */
  weaponPoints(out) {
    const P = this.anim.pts, w = this.anim.wdir, m = this.weapon.model;
    const hx = P[J.RHA * 3], hy = P[J.RHA * 3 + 1], hz = P[J.RHA * 3 + 2];
    out[0] = hx + w[0] * m.tip; out[1] = hy + w[1] * m.tip; out[2] = hz + w[2] * m.tip;
    out[3] = hx + w[0] * m.base; out[4] = hy + w[1] * m.base; out[5] = hz + w[2] * m.base;
    if (this.weapon.def.dual) {
      const lx = P[J.LHA * 3], ly = P[J.LHA * 3 + 1], lz = P[J.LHA * 3 + 2];
      out[6] = lx + w[3] * m.tip; out[7] = ly + w[4] * m.tip; out[8] = lz + w[5] * m.tip;
    }
    return out;
  }

  _trail() {
    const active = this.state === 'attack' || this.state === 'ult';
    const pts = this.weaponPoints(this._wp || (this._wp = new Float32Array(9)));
    const isFists = this.weapon.type === 'fists';
    if (isFists) {
      // fists: trail from the striking limbs
      const P = this.anim.pts;
      const src = this.move && this.move.name && this.move.name.includes('ick') ? J.RFT : this.move?.name === 'jab' ? J.LHA : J.RHA;
      pts[0] = P[src * 3]; pts[1] = P[src * 3 + 1]; pts[2] = P[src * 3 + 2];
      pts[3] = pts[0]; pts[4] = pts[1]; pts[5] = pts[2];
    }
    if (active && this.prevTip) {
      const col = this.weapon.trailColor;
      const P = this.game.particles;
      const steps = 4;
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        const tx = this.prevTip[0] + (pts[0] - this.prevTip[0]) * t;
        const ty = this.prevTip[1] + (pts[1] - this.prevTip[1]) * t;
        const tz = this.prevTip[2] + (pts[2] - this.prevTip[2]) * t;
        const bx = this.prevBase[0] + (pts[3] - this.prevBase[0]) * t;
        const by = this.prevBase[1] + (pts[4] - this.prevBase[1]) * t;
        const bz = this.prevBase[2] + (pts[5] - this.prevBase[2]) * t;
        const n = isFists ? 1 : 4;
        for (let j = 0; j < n; j++) {
          const u = n === 1 ? 1 : 0.25 + (j / (n - 1)) * 0.75;
          P.emit({ x: bx + (tx - bx) * u, y: by + (ty - by) * u, z: bz + (tz - bz) * u, life: 0.13 + this.weapon.tier * 0.02, size: (isFists ? 0.16 : 0.1 + u * 0.08), size1: 0.0, color: col, alpha: 0.5 + u * 0.4, shape: SHAPE.GLOW });
        }
      }
      if (this.weapon.tier >= 2 && Math.random() < 0.5) {
        P.emit({ x: pts[0], y: pts[1], z: pts[2], vx: (Math.random() - 0.5) * 3, vy: Math.random() * 2, vz: (Math.random() - 0.5) * 3, life: 0.5, size: 0.05, color: col, shape: SHAPE.SPARK, grav: 6 });
      }
      if (this.weapon.def.dual && this.prevTipL) {
        for (let k = 0; k < 3; k++) {
          const t = k / 3;
          P.emit({ x: this.prevTipL[0] + (pts[6] - this.prevTipL[0]) * t, y: this.prevTipL[1] + (pts[7] - this.prevTipL[1]) * t, z: this.prevTipL[2] + (pts[8] - this.prevTipL[2]) * t, life: 0.14, size: 0.13, color: col, alpha: 0.8, shape: SHAPE.GLOW });
        }
      }
    }
    // idle weapon aura for high tiers
    if (this.weapon.tier >= 3 && Math.random() < 0.15 * this.weapon.tier) {
      const u = Math.random();
      const col = this.weapon.trailColor;
      this.game.particles.emit({ x: pts[3] + (pts[0] - pts[3]) * u, y: pts[4] + (pts[1] - pts[4]) * u, z: pts[5] + (pts[2] - pts[5]) * u, vy: 0.6, life: 0.7, size: 0.06, color: this.weapon.tier >= 5 ? [0.02, 0.0, 0.05] : col, shape: this.weapon.tier >= 5 ? SHAPE.SMOKE : SHAPE.GLOW, additive: this.weapon.tier < 5, alpha: 0.8 });
    }
    this.prevTip = this.prevTip || [0, 0, 0];
    this.prevBase = this.prevBase || [0, 0, 0];
    this.prevTipL = this.prevTipL || [0, 0, 0];
    this.prevTip[0] = pts[0]; this.prevTip[1] = pts[1]; this.prevTip[2] = pts[2];
    this.prevBase[0] = pts[3]; this.prevBase[1] = pts[4]; this.prevBase[2] = pts[5];
    this.prevTipL[0] = pts[6]; this.prevTipL[1] = pts[7]; this.prevTipL[2] = pts[8];
  }

  draw(R) {
    const g = this.game;
    const P = this.anim.pts;
    const flash = this.hurtFlash > 0 ? this.hurtFlash * 0.6 : 0;
    const blink = this.invulnT > 0 && this.state === 'free' && Math.floor(g.time * 20) % 2 === 0;
    // eyes glow with weapon rarity
    const eye = this.weapon.trailColor;
    const ground = (x, z) => g.world.height(x, z);
    const view = g.bodyView || 'model';
    if (g.style && g.style.models && view !== 'stick') {
      if (!blink && view === 'model') drawBody(R, this.anatomy.body, P, this.anatomy, 1, ground, { flash, eyeCol: eye });
      if (view === 'skeleton') drawSkeleton(R, P, 1, ground, this.anatomy);
    } else {
      if (!blink) drawRig(R, this.topo, P, this.palette, flash, 1);
      const hx = P[J.HEAD * 3], hy = P[J.HEAD * 3 + 1], hz = P[J.HEAD * 3 + 2];
      const s = Math.sin(this.yaw + this.anim.pose.spin + this.anim.pose.headY), c = Math.cos(this.yaw + this.anim.pose.spin + this.anim.pose.headY);
      for (const side of [-1, 1]) R.ball(hx + side * 0.06 * c + s * 0.14, hy + 0.02, hz - side * 0.06 * s + c * 0.14, 0.028, eye, 3);
    }
    // scarf
    const sc = this.scarf;
    for (let i = 1; i < sc.length; i++) {
      const a = sc[i - 1], b = sc[i];
      R.seg(a.x, a.y, a.z, b.x, b.y, b.z, 0.05 * (1 - i / sc.length * 0.5), [0.75, 0.06, 0.08], 0.15);
    }
    // weapon(s)
    const w = this.anim.wdir;
    tmpU[0] = w[0]; tmpU[1] = w[1]; tmpU[2] = w[2];
    tmpRef[0] = -Math.cos(this.yaw); tmpRef[1] = 0; tmpRef[2] = Math.sin(this.yaw);
    weaponBasis(tmpU, tmpRef, tmpV, tmpW);
    const wf = this.weapon.tier >= 4 ? 0.25 + Math.sin(g.time * 6) * 0.15 : 0;
    drawWeapon(R, this.weapon, P[J.RHA * 3], P[J.RHA * 3 + 1], P[J.RHA * 3 + 2], tmpU, tmpV, tmpW, wf);
    if (this.weapon.def.dual || this.weapon.type === 'fists') {
      tmpU[0] = w[3]; tmpU[1] = w[4]; tmpU[2] = w[5];
      weaponBasis(tmpU, tmpRef, tmpV, tmpW);
      drawWeapon(R, this.weapon, P[J.LHA * 3], P[J.LHA * 3 + 1], P[J.LHA * 3 + 2], tmpU, tmpV, tmpW, wf);
    }
    if (this.weapon.tier >= 3) {
      const pts = this._wp;
      if (pts) R.light(pts[0], pts[1], pts[2], 4 + this.weapon.tier, eye[0], eye[1], eye[2], 0.5 + this.weapon.tier * 0.15);
    }
    // player lantern light (keeps the hero readable in the dark)
    R.light(this.x, this.y + 2.4, this.z, 9, 0.9, 0.85, 0.8, 0.4);
    if (this.weapon.tier >= 4) {
      // orbiting relic shards
      for (let i = 0; i < this.weapon.tier - 2; i++) {
        const a = g.time * 2 + (i * Math.PI * 2) / (this.weapon.tier - 2);
        R.trs(PRIM.OCTA, this.x + Math.cos(a) * 0.9, this.y + 1.3 + Math.sin(a * 2) * 0.15, this.z + Math.sin(a) * 0.9, a, 0, 0, 0.05, 0.12, 0.05, eye, 2.5);
      }
    }
    // dodge / dash afterimages
    if ((this.state === 'dodge' || this.state === 'dash') && Math.random() < 0.8) {
      const i = ((Math.random() * 16) | 0) * 3;
      g.particles.emit({ x: P[i], y: P[i + 1], z: P[i + 2], life: 0.25, size: 0.18, size1: 0, color: [0.7, 0.75, 1], alpha: 0.5, shape: SHAPE.GLOW });
    }
  }
}

