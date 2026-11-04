// Waves: each dimension runs in waves with short breathers between them. Every wave survived (counted across
// the whole run) raises enemy health, damage, speed, aggression and elite odds via Game._refreshScaling.
// Every fourth wave is an elite wave; tides are the climax of every third.
import { TAU } from '../core/math.js';

// time (s) into a dimension before each type may appear
const UNLOCK = { husk: 0, crawler: 0, hound: 25, gazer: 45, choir: 90, brute: 110, maw: 70 };
const WAVE_TIME = 34;
const BREATHER = 7;

export class Spawner {
  constructor(game) {
    this.game = game;
    this.acc = 0;
    this.cap = 40;
    this.enabled = true;
    this.reset();
  }

  reset() {
    this.acc = 0;
    this.wave = 0;
    this.waveT = 0;
    this.breathT = 3;
    this.active = false;
    this.quota = 0;
    this.spawned = 0;
    this.kind = 'normal';
  }

  /** Progress through the current wave (0..1) for the HUD. */
  get progress() { return this.active ? Math.min(1, this.waveT / WAVE_TIME) : 0; }

  _startWave() {
    const g = this.game;
    this.wave++;
    g.wavesTotal = (g.wavesTotal || 0) + 1;
    if (g.run) g.run.waves = g.wavesTotal;
    g._refreshScaling();
    this.active = true;
    this.waveT = 0;
    this.spawned = 0;
    this.kind = this.wave % 4 === 0 ? 'elite' : this.wave % 3 === 0 ? 'tide' : 'normal';
    this.quota = Math.round((14 + this.wave * 5 + g.depth * 9 + g.wavesTotal * 1.5) * (this.kind === 'tide' ? 1.35 : 1));
    const label = this.kind === 'elite' ? 'Elite wave' : this.kind === 'tide' ? 'Tide wave' : 'Wave';
    g.announce(`${label} ${g.wavesTotal}`, this.kind === 'normal' ? 'objective' : 'tide');
    g.audio.play('roar', 0.35);
  }

  pickType() {
    const g = this.game;
    const pool = Object.entries(g.dim.enemies).filter(([k]) => g.dimTime >= (UNLOCK[k] ?? 0) / (1 + g.depth * 0.5 + this.wave * 0.08));
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

  _spawnOne(eliteBoost = 0) {
    const g = this.game;
    const pt = this.spawnPoint();
    const type = this.pickType();
    const eliteChance = g.scaling.elite + eliteBoost;
    if (type === 'crawler' && Math.random() < 0.6) {
      // crawlers come in broods
      for (let k = 0; k < 3; k++) g.spawnEnemy('crawler', pt.x + (Math.random() - 0.5) * 3, pt.z + (Math.random() - 0.5) * 3, {});
      this.spawned += 3;
    } else {
      g.spawnEnemy(type, pt.x, pt.z, { elite: Math.random() < eliteChance });
      this.spawned++;
    }
  }

  update(dt) {
    const g = this.game;
    if (!this.enabled || g.world.mode !== 'open') return;
    this.cap = Math.min(150, 34 + this.wave * 6 + g.depth * 14);
    if (!this.active) {
      this.breathT -= dt;
      if (this.breathT <= 0) this._startWave();
      return;
    }
    this.waveT += dt;
    // spend the quota over the first 70% of the wave, faster while an obelisk is being awakened
    const rate = (this.quota / (WAVE_TIME * 0.7)) * (g.activeObelisk ? 1.6 : 1);
    if (this.spawned < this.quota) {
      this.acc += rate * dt;
      while (this.acc >= 1 && this.spawned < this.quota) {
        this.acc -= 1;
        if (g.enemies.length >= this.cap) { this.acc = 0; break; }
        this._spawnOne(this.kind === 'elite' ? 0.18 : 0);
      }
    }
    // the tide crashes in from one side mid-wave
    if (this.kind === 'tide' && !this.tideDone && this.waveT > WAVE_TIME * 0.45) {
      this.tideDone = true;
      const n = 10 + this.wave * 2 + g.depth * 5;
      const a0 = Math.random() * TAU;
      for (let i = 0; i < n; i++) {
        const a = a0 + (Math.random() - 0.5) * 1.2;
        const r = 22 + Math.random() * 6;
        const x = g.player.x + Math.cos(a) * r, z = g.player.z + Math.sin(a) * r;
        if (Math.hypot(x, z) > g.world.playRadius) continue;
        g.spawnEnemy(this.pickType(), x, z, {});
      }
      g.announce('A Tide of the Hollow crashes in', 'tide');
    }
    // a wave ends on its timer, or early once its quota is spawned and mostly cleared
    const alive = g.enemies.filter((e) => e.alive && !e.boss).length;
    if (this.waveT >= WAVE_TIME || (this.spawned >= this.quota && alive <= Math.max(3, this.quota * 0.12))) {
      this.active = false;
      this.tideDone = false;
      this.breathT = BREATHER;
      g.announce(`Wave ${g.wavesTotal} survived`, 'loot');
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
