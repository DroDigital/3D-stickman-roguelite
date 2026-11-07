// Cinematic sound design for the Abyssal Cinematic pack: sourced samples (Oculus Audio Pack, CC BY 4.0, and
// sfx-kit, CC0 — see assets/CREDITS.md) layered and randomised per event, 3D-positioned with HRTF panners,
// sent through a per-realm convolution reverb, ducked under big impacts, slowed and muffled in slow motion and
// at low health; realm ambience and weather beds; and an adaptive score (drone bed, tension strings, war drums,
// low ostinato, a boss organ and choir) that follows combat intensity.

const REALM = {
  // reverb tail (s), damping, ambience beds and the score's key (root frequency, minor-ish scale)
  ashen: { verb: 3.2, damp: 2600, beds: [['ambNight', 0.28, 0.85, 900], ['drone', 0.12, 0.7, 700]], root: 55, scale: [0, 1, 3, 5, 7, 8, 10] },
  drowned: { verb: 4.5, damp: 1400, beds: [['ambUnderwater', 0.4, 1, 1600], ['ambBubbles', 0.12, 0.8, 1200]], root: 49, scale: [0, 2, 3, 5, 7, 8, 11] },
  starless: { verb: 6, damp: 4200, beds: [['drone', 0.2, 0.5, 2200], ['wind', 0.1, 0.6, 500]], root: 46.25, scale: [0, 1, 4, 5, 7, 8, 11] },
  flesh: { verb: 2.6, damp: 1800, beds: [['ambBubbles', 0.2, 0.45, 600], ['drone', 0.14, 0.55, 500]], root: 51.9, scale: [0, 1, 3, 5, 6, 8, 10] },
};

export class Soundscape {
  constructor(audio) {
    this.a = audio;
    this.c = audio.ctx;
    this.buf = {};
    this.ready = false;
    this.listener = { x: 0, y: 0, z: 0 };
    this.timeScale = 1;
    this.intensity = 0;
    this.boss = 0;
    this.lowHp = 0;
    this.realm = 'ashen';
    this.beds = [];
    this.last = new Map();
    this._build();
  }

  _build() {
    const c = this.c, a = this.a;
    // buses: sfx (dry + reverb send) and music/ambience, all into a master low-pass for muffling
    this.muffle = c.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.muffle.Q.value = 0.5;
    this.muffle.connect(a.master);
    this.sfx = c.createGain(); this.sfx.gain.value = 1;
    this.sfx.connect(this.muffle);
    this.duckBus = c.createGain(); this.duckBus.gain.value = 1; // music + ambience, ducked by impacts
    this.duckBus.connect(this.muffle);
    this.music = c.createGain(); this.music.gain.value = 0.55;
    this.music.connect(this.duckBus);
    this.amb = c.createGain(); this.amb.gain.value = 0.9;
    this.amb.connect(this.duckBus);
    this.verb = c.createConvolver();
    this.verbIn = c.createGain(); this.verbIn.gain.value = 0.5;
    this.verbOut = c.createGain(); this.verbOut.gain.value = 0.55;
    this.verbIn.connect(this.verb).connect(this.verbOut).connect(this.muffle);
    this.music.connect(this.verbIn);
    this._impulse(3, 2400);
    // weather beds
    this.rainG = c.createGain(); this.rainG.gain.value = 0; this.rainG.connect(this.amb);
    this.windG = c.createGain(); this.windG.gain.value = 0;
    this.windF = c.createBiquadFilter(); this.windF.type = 'lowpass'; this.windF.frequency.value = 900;
    this.windG.connect(this.windF).connect(this.amb);
    // score voices
    this.drumG = c.createGain(); this.drumG.gain.value = 0; this.drumG.connect(this.music);
    this.ostG = c.createGain(); this.ostG.gain.value = 0; this.ostG.connect(this.music);
    this.padG = c.createGain(); this.padG.gain.value = 0; this.padG.connect(this.music);
    this.bossG = c.createGain(); this.bossG.gain.value = 0; this.bossG.connect(this.music);
    this.nextBeat = 0;
    this.beat = 0;
    this.nextSwell = 0;
  }

  /** Synthesised impulse response: stereo decaying noise, darker over time (cavern / cathedral / sea). */
  _impulse(secs, damp) {
    const c = this.c, rate = c.sampleRate, n = Math.floor(rate * secs);
    const ir = c.createBuffer(2, n, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const k = Math.exp(-(damp / 4000 + 0.4) * t * 6);
        lp += (Math.random() * 2 - 1 - lp) * Math.max(0.02, 0.9 - t * 0.85);
        d[i] = lp * Math.pow(1 - t, 2.2) * k * (i < rate * 0.012 ? i / (rate * 0.012) : 1);
      }
    }
    this.verb.buffer = ir;
  }

  /** Decode the sample bank (ArrayBuffers from the asset loader). */
  async attach(bank) {
    const c = this.c;
    const jobs = [];
    for (const [id, list] of Object.entries(bank || {})) {
      this.buf[id] = [];
      list.forEach((ab, i) => {
        if (!ab) return;
        jobs.push(c.decodeAudioData(ab.slice(0)).then((b) => { this.buf[id][i] = b; }, () => {}));
      });
    }
    await Promise.all(jobs);
    for (const id of Object.keys(this.buf)) this.buf[id] = this.buf[id].filter(Boolean);
    this.ready = true;
    this._startWeatherBeds();
    this.setRealm(this.realm, true);
  }

  has(id) { return this.buf[id] && this.buf[id].length > 0; }

  /** Play one sample from bank `id`. opts: k gain, rate, pos {x,y,z}, delay, verb send, bus, offset */
  sample(id, o = {}) {
    if (!this.has(id)) return null;
    const c = this.c;
    const list = this.buf[id];
    const b = o.index !== undefined ? list[o.index % list.length] : list[(Math.random() * list.length) | 0];
    const src = c.createBufferSource();
    src.buffer = b;
    const rate = (o.rate ?? 1) * (0.94 + Math.random() * 0.12) * (o.noSlow ? 1 : 0.55 + 0.45 * this.timeScale);
    src.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = (o.k ?? 1);
    let node = src.connect(g);
    if (o.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; node = node.connect(f); }
    if (o.pos) {
      const p = c.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 4;
      p.rolloffFactor = 1.1;
      p.maxDistance = 120;
      p.positionX.value = o.pos.x; p.positionY.value = o.pos.y; p.positionZ.value = o.pos.z;
      node = node.connect(p);
    }
    node.connect(o.bus || this.sfx);
    if ((o.verb ?? 0.25) > 0) {
      const s = c.createGain(); s.gain.value = o.verb ?? 0.25;
      node.connect(s).connect(this.verbIn);
    }
    const t = c.currentTime + (o.delay || 0);
    src.start(t, o.offset || 0);
    return src;
  }

  _throttle(key, gap) {
    const now = this.c.currentTime;
    if (now - (this.last.get(key) || -9) < gap) return false;
    this.last.set(key, now);
    return true;
  }

  /** Brief dip of music and ambience under a big hit. */
  duck(amount = 0.5, time = 0.6) {
    const g = this.duckBus.gain, t = this.c.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(1 - amount, t + 0.03);
    g.setTargetAtTime(1, t + 0.08, time / 3);
  }

  /** Game event -> layered samples. Returns false if this event has no sampled design (synth takes over). */
  play(name, k = 1, delay = 0, pos = null) {
    if (!this.ready) return false;
    const P = pos || null;
    switch (name) {
      case 'whoosh':
        if (!this._throttle(name, 0.05)) return true;
        this.sample(Math.random() < 0.6 ? 'swoosh' : 'whooshSmall', { k: 0.55 * k, rate: 1.05, verb: 0.1, delay });
        return true;
      case 'heavyWhoosh':
        this.sample('whooshHeavy', { k: 0.7 * k, rate: 0.9, verb: 0.15, delay });
        return true;
      case 'hit':
        if (!this._throttle(name, 0.035)) return true;
        this.sample('flesh', { k: 0.55 * k, rate: 1.1, pos: P, verb: 0.15 });
        this.sample('punch', { k: 0.5 * k, rate: 0.9, pos: P, verb: 0.1 });
        if (Math.random() < 0.18) this.sample('creatureHurt', { k: 0.35 * k, rate: 1.1, pos: P, delay: 0.05 });
        return true;
      case 'crit':
        this.sample('bones', { k: 0.7 * k, pos: P, verb: 0.2 });
        this.sample('punchHeavy', { k: 0.7 * k, pos: P });
        this.sample('impact', { k: 0.45 * k, rate: 0.85, verb: 0.3 });
        this.duck(0.35, 0.4);
        return true;
      case 'counter':
      case 'clash':
        this.sample('clash', { k: 0.8 * k, verb: 0.4 });
        this.sample('cineMetal', { k: 0.3 * k, rate: 1.2 });
        return true;
      case 'dodge':
        this.sample('cloth', { k: 0.5 * k, rate: 1.1, verb: 0.05 });
        this.sample('whooshSmall', { k: 0.35 * k, rate: 1.25, verb: 0.05 });
        return true;
      case 'hurt':
        this.sample('heroHurt', { k: 0.75, verb: 0.15 });
        this.sample('punchHeavy', { k: 0.6, rate: 0.8 });
        this.duck(0.4, 0.5);
        return true;
      case 'effort':
        if (!this._throttle(name, 0.6)) return true;
        this.sample('heroEffort', { k: 0.4 * k, verb: 0.1 });
        return true;
      case 'death':
        if (!this._throttle(name, 0.05)) return true;
        this.sample('flesh', { k: 0.6 * k, rate: 0.8, pos: P });
        if (Math.random() < 0.55) this.sample('creatureDeath', { k: 0.5 * k, rate: 1 + Math.random() * 0.3, pos: P, verb: 0.35 });
        else if (Math.random() < 0.4) this.sample('creepy', { k: 0.35 * k, rate: 1.2, pos: P, verb: 0.5 });
        return true;
      case 'heroDeath':
        this.sample('heroDeath', { k: 0.9, verb: 0.5, noSlow: true });
        this.sample('subDrop', { k: 0.8, noSlow: true });
        this.sample('loss', { k: 0.6, delay: 1.2, bus: this.music, noSlow: true });
        return true;
      case 'pickup':
        if (!this._throttle(name, 0.06)) return true;
        this.sample('shimmer', { index: 0, k: 0.22 * k, rate: 1.4 + Math.random() * 0.3, verb: 0.3 });
        return true;
      case 'coin':
        if (!this._throttle(name, 0.05)) return true;
        this.sample('coin', { k: 0.35 * k, rate: 1.1, verb: 0.2 });
        return true;
      case 'levelup':
        this.sample('levelup', { k: 0.6, bus: this.music, noSlow: true, verb: 0.5 });
        this.sample('shimmer', { index: 2, k: 0.4, noSlow: true });
        return true;
      case 'chest':
        this.sample('lock', { k: 0.6 });
        this.sample('shimmer', { index: 2, k: 0.5, delay: 0.15 });
        this.sample('cineMetal', { k: 0.25, rate: 1.3, delay: 0.1 });
        return true;
      case 'break':
        this.sample('impact', { k: 0.6 * k, rate: 0.75, pos: P, verb: 0.3 });
        this.sample('bones', { k: 0.3 * k, rate: 0.6, pos: P });
        return true;
      case 'bolt':
        if (!this._throttle(name, 0.06)) return true;
        this.sample('magic', { k: 0.3 * k, rate: 1.5, verb: 0.2, pos: P });
        return true;
      case 'zap':
        if (!this._throttle(name, 0.06)) return true;
        this.sample('magic', { k: 0.45 * k, rate: 1.1, verb: 0.35, pos: P });
        this.sample('whooshSmall', { k: 0.25 * k, rate: 1.6 });
        return true;
      case 'boom':
        if (!this._throttle(name, 0.08)) return true;
        this.sample('boom', { k: 0.7 * k, pos: P, verb: 0.45 });
        this.sample('rumble', { k: 0.4 * k, verb: 0.2 });
        if (k > 0.8) this.duck(0.45, 0.8);
        return true;
      case 'portal':
        if (!this._throttle(name, 0.3)) return true;
        this.sample('riser', { k: 0.45 * k, verb: 0.6, noSlow: true });
        this.sample('reverse', { index: 2, k: 0.35 * k, verb: 0.6, noSlow: true });
        return true;
      case 'roar':
        this.sample('roar', { k: 0.85 * k, rate: 0.85, verb: 0.6, pos: P });
        this.sample('cineDrum', { k: 0.6 * k, noSlow: true });
        this.sample('subDrop', { k: 0.5 * k, noSlow: true });
        this.duck(0.6, 1.2);
        return true;
      case 'laugh':
        this.sample('laugh', { k: 0.6 * k, rate: 0.8, verb: 0.7, pos: P });
        return true;
      case 'telegraph':
        if (!this._throttle(name, 0.15)) return true;
        this.sample('reverse', { index: 0, k: 0.25 * k, rate: 1.2, pos: P });
        return true;
      case 'ui':
      case 'select':
        if (!this._throttle(name, 0.04)) return true;
        this.sample('uiTap', { index: name === 'ui' ? 0 : 1, k: 0.4, verb: 0.05, noSlow: true });
        return true;
      case 'thunder':
        this.sample('thunder', { k: 0.9 * k, rate: 0.8 + Math.random() * 0.25, verb: 0.5, delay, lp: 1200 + k * 6000, noSlow: true });
        if (k > 0.7) this.duck(0.3, 1.5);
        return true;
      case 'ultimate':
        this.sample('cineSlam', { index: 1, k: 0.9, noSlow: true, verb: 0.6 });
        this.sample('subDrop', { k: 0.8, noSlow: true });
        this.duck(0.7, 1.5);
        return true;
      case 'evolve':
        this.sample('cineMetal', { index: 1, k: 0.7, noSlow: true, verb: 0.6 });
        this.sample('shimmer', { index: 2, k: 0.6, noSlow: true });
        return true;
      case 'bossIntro':
        this.sample('cineDrum', { index: 1, k: 0.9, noSlow: true, verb: 0.7 });
        this.sample('subDrop', { index: 1, k: 0.7, noSlow: true });
        this.sample('organ', { k: 0.45, bus: this.music, noSlow: true, delay: 0.4 });
        this.duck(0.7, 2);
        return true;
      case 'bossDeath':
        this.sample('cineSlam', { index: 1, k: 1, noSlow: true, verb: 0.8 });
        this.sample('victory', { k: 0.5, bus: this.music, noSlow: true, delay: 1.6 });
        this.duck(0.8, 2.5);
        return true;
      case 'finisher':
        this.sample('cineDrum', { index: 0, k: 0.5, noSlow: true, verb: 0.5 });
        this.sample('reverse', { index: 1, k: 0.3, noSlow: true });
        return true;
      case 'step': {
        const bank = this.realm === 'ashen' ? 'stepSnow' : this.realm === 'starless' ? 'stepDirt' : this.realm === 'drowned' ? 'stepDirt' : 'stepGrass';
        this.sample(bank, { k: 0.22 * k, rate: this.realm === 'flesh' ? 0.8 : 1, verb: 0.08, lp: this.realm === 'drowned' ? 1800 : 9000 });
        return true;
      }
      case 'land':
        this.sample('land', { k: 0.4 * k, verb: 0.1 });
        return true;
      case 'whisper':
        this.sample('whispers', { k: 0.25 * k, verb: 0.8, pos: P });
        return true;
      case 'chains':
        this.sample('chains', { k: 0.3 * k, verb: 0.6, pos: P });
        return true;
      default:
        return false;
    }
  }

  setListener(x, y, z, fx, fy, fz) {
    const L = this.c.listener;
    if (L.positionX) {
      const t = this.c.currentTime;
      L.positionX.setValueAtTime(x, t); L.positionY.setValueAtTime(y, t); L.positionZ.setValueAtTime(z, t);
      L.forwardX.setValueAtTime(fx, t); L.forwardY.setValueAtTime(fy, t); L.forwardZ.setValueAtTime(fz, t);
      L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t);
    }
    this.listener.x = x; this.listener.y = y; this.listener.z = z;
  }

  setRealm(id, force = false) {
    if (!REALM[id]) id = 'ashen';
    if (this.realm === id && !force && this.beds.length) return;
    this.realm = id;
    const r = REALM[id];
    if (this.c) this._impulse(r.verb, r.damp);
    if (!this.ready) return;
    const t = this.c.currentTime;
    for (const b of this.beds) { b.g.gain.setTargetAtTime(0, t, 1.5); b.src.stop(t + 6); }
    this.beds = [];
    for (const [bank, gain, rate, lp] of r.beds) {
      if (!this.has(bank)) continue;
      const src = this.c.createBufferSource();
      src.buffer = this.buf[bank][0];
      src.loop = true;
      src.loopStart = 0.05; src.loopEnd = src.buffer.duration - 0.05;
      src.playbackRate.value = rate;
      const f = this.c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp;
      const g = this.c.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(this.amb);
      src.start(t, Math.random() * Math.max(0.1, src.buffer.duration - 1));
      g.gain.setTargetAtTime(gain, t, 2);
      this.beds.push({ src, g });
    }
  }

  _startWeatherBeds() {
    const c = this.c;
    for (const [bank, g] of [['rain', this.rainG], ['wind', this.windG]]) {
      if (!this.has(bank)) continue;
      const src = c.createBufferSource();
      src.buffer = this.buf[bank][0];
      src.loop = true;
      src.loopStart = 0.05; src.loopEnd = src.buffer.duration - 0.05;
      src.connect(g);
      src.start();
    }
  }

  setWeather(w) {
    if (!this.ready) return;
    const t = this.c.currentTime;
    this.rainG.gain.setTargetAtTime(w.rain * 0.55, t, 1.2);
    this.windG.gain.setTargetAtTime(w.wind * 0.35, t, 1.5);
    this.windF.frequency.setTargetAtTime(400 + w.wind * 1600, t, 1.5);
  }

  /** Called every frame: score scheduling, slow-mo / low-health muffling. */
  update(dt, st) {
    if (!this.ready) return;
    const c = this.c, t = c.currentTime;
    this.timeScale = st.timeScale ?? 1;
    this.lowHp = st.lowHp || 0;
    this.intensity += ((st.intensity || 0) - this.intensity) * Math.min(1, dt * 0.8);
    this.boss += ((st.boss ? 1 : 0) - this.boss) * Math.min(1, dt * 0.5);
    const muffle = Math.min(1, (1 - this.timeScale) * 1.3 + this.lowHp * 0.6 + (st.paused ? 0.8 : 0));
    this.muffle.frequency.setTargetAtTime(20000 * Math.pow(0.04, muffle), t, 0.08);
    this.music.gain.setTargetAtTime(0.55 * (st.musicVol ?? 1), t, 0.3);
    const I = this.intensity, B = this.boss;
    this.drumG.gain.setTargetAtTime(Math.min(1, I * 1.2 + B) * 0.55, t, 0.8);
    this.ostG.gain.setTargetAtTime(Math.max(0, I - 0.25) * 0.35 + B * 0.3, t, 1.2);
    this.padG.gain.setTargetAtTime(0.18 + I * 0.08, t, 2);
    this.bossG.gain.setTargetAtTime(B * 0.32, t, 1.5);
    this._schedule(t, I, B);
  }

  _note(step, oct = 0) {
    const r = REALM[this.realm];
    const s = r.scale[((step % r.scale.length) + r.scale.length) % r.scale.length] + 12 * (Math.floor(step / r.scale.length) + oct);
    return r.root * Math.pow(2, s / 12);
  }

  _schedule(now, I, B) {
    const c = this.c;
    const bpm = 72 + I * 18 + B * 22;
    const spb = 60 / bpm / 2; // eighth notes
    if (this.nextBeat < now) this.nextBeat = now + 0.05;
    while (this.nextBeat < now + 0.25) {
      const t = this.nextBeat, b = this.beat++ % 16;
      // war drums: a heavy taiko pattern that fills in as intensity rises
      const pattern = B > 0.5 ? [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 1] : [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0];
      const ghost = I > 0.6 ? [0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0] : [];
      if (pattern[b]) this._drum(t, b === 0 ? 1 : 0.75, this.drumG);
      if (ghost[b]) this._drum(t, 0.35, this.drumG, 1.6);
      // low ostinato on every eighth
      this._pluck(t, this._note([0, 0, 2, 0, 3, 0, 2, 1][b % 8], 0), spb * 0.9, this.ostG);
      if (b === 0) {
        // pad chord (re-voiced every bar); boss: organ-like choir an octave up
        for (const s of [0, 2, 4]) this._pad(t, this._note(s, 1), spb * 16, this.padG);
        if (B > 0.05) for (const s of [0, 2, 4, 6]) this._choir(t, this._note(s, 2), spb * 16, this.bossG);
      }
      this.nextBeat += spb;
    }
    // occasional sampled tension swells (creepy strings / organ / whispers) between fights
    if (now > this.nextSwell) {
      this.nextSwell = now + 18 + Math.random() * 22;
      const pick = Math.random();
      if (pick < 0.45) this.sample('strings', { k: 0.25 + I * 0.15, bus: this.music, verb: 0.6, noSlow: true, rate: 0.9 + Math.random() * 0.2 });
      else if (pick < 0.65) this.sample('organ', { k: 0.15, bus: this.music, verb: 0.7, noSlow: true, rate: 0.85 });
      else if (pick < 0.85) this.sample('whispers', { k: 0.18, bus: this.amb, verb: 0.8, noSlow: true });
      else this.sample('chains', { k: 0.2, bus: this.amb, verb: 0.7, noSlow: true, rate: 0.8 });
    }
  }

  _drum(t, k, bus, pitch = 1) {
    const c = this.c;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(90 * pitch, t); o.frequency.exponentialRampToValueAtTime(42 * pitch, t + 0.35);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9 * k, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g).connect(bus); o.start(t); o.stop(t + 0.65);
    // skin slap
    const n = c.createBufferSource(); n.buffer = this.a.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700 * pitch; f.Q.value = 1.2;
    const ng = c.createGain(); ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.25 * k, t + 0.003); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    n.connect(f).connect(ng).connect(bus); n.start(t, Math.random(), 0.15);
  }

  _pluck(t, freq, dur, bus) {
    const c = this.c;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 6;
    f.frequency.setValueAtTime(freq * 8, t); f.frequency.exponentialRampToValueAtTime(freq * 1.5, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(bus); o.start(t); o.stop(t + dur + 0.02);
  }

  _pad(t, freq, dur, bus) {
    const c = this.c;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + dur * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.1);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq * 3; f.Q.value = 0.7;
    f.connect(g).connect(bus);
    for (const det of [-7, 0, 6]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + dur * 1.15);
    }
  }

  _choir(t, freq, dur, bus) {
    // vowel-filtered saws ("ah" formants) for a dark choir
    const c = this.c;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.1);
    g.connect(bus);
    const mix = c.createGain(); mix.gain.value = 1;
    for (const [ff, q, k] of [[700, 8, 1], [1150, 10, 0.6], [2600, 12, 0.25]]) {
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = ff; bp.Q.value = q;
      const kg = c.createGain(); kg.gain.value = k;
      mix.connect(bp).connect(kg).connect(g);
    }
    for (const det of [-9, 0, 8]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = det;
      const vib = c.createOscillator(); vib.frequency.value = 5 + Math.random(); const vg = c.createGain(); vg.gain.value = 4;
      vib.connect(vg).connect(o.detune);
      o.connect(mix); o.start(t); o.stop(t + dur * 1.15); vib.start(t); vib.stop(t + dur * 1.15);
    }
  }
}
