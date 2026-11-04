// Procedural WebAudio sound design: no samples, everything synthesized at runtime.

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = 0.6;
    this.lastPlay = new Map();
    this.style = 'retro';
  }

  /**
   * Sound set: 'retro' (original), 'anime' (sword "shing"s, bell counters — Ink Requiem),
   * 'taiko' (drums, wooden clacks, breathy flute, chimes — Black Sutra),
   * 'folk' (woodblocks, paper flutter, music box, kalimba — Paper Lantern).
   */
  setStyle(style) { this.style = style; }

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      this.enabled = false;
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.volume;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(c.destination);
    // shared noise buffer
    const len = c.sampleRate * 1.5;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._startAmbience();
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  _throttle(key, gap) {
    const now = this.ctx.currentTime;
    const last = this.lastPlay.get(key) || 0;
    if (now - last < gap) return false;
    this.lastPlay.set(key, now);
    return true;
  }

  _noise(t, dur, freq, q, gain, type = 'bandpass', sweepTo = null) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  _tone(t, dur, f0, f1, gain, type = 'sine', attack = 0.005) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  play(name, intensity = 1) {
    if (!this.enabled || !this.ctx) return;
    if (this.style === 'anime' && this._anime(name, intensity)) return;
    if (this.style === 'taiko' && this._taiko(name, intensity)) return;
    if (this.style === 'folk' && this._folk(name, intensity)) return;
    const c = this.ctx, t = c.currentTime;
    const k = intensity;
    switch (name) {
      case 'whoosh':
        if (!this._throttle(name, 0.04)) return;
        this._noise(t, 0.18, 600, 1.2, 0.18 * k, 'bandpass', 2400);
        break;
      case 'heavyWhoosh':
        this._noise(t, 0.32, 300, 1.0, 0.26 * k, 'bandpass', 1600);
        break;
      case 'hit':
        if (!this._throttle(name, 0.03)) return;
        this._noise(t, 0.09, 1800, 0.8, 0.32 * k);
        this._tone(t, 0.12, 180 * (0.9 + Math.random() * 0.2), 60, 0.4 * k, 'triangle');
        break;
      case 'crit':
        this._noise(t, 0.14, 3200, 0.6, 0.35 * k);
        this._tone(t, 0.22, 120, 40, 0.5 * k, 'sawtooth');
        this._tone(t + 0.01, 0.2, 1400, 700, 0.12 * k, 'square');
        break;
      case 'counter':
        this._tone(t, 0.4, 900, 2200, 0.16, 'triangle');
        this._noise(t, 0.2, 5000, 2, 0.2);
        this._tone(t, 0.3, 90, 40, 0.5, 'sine');
        break;
      case 'dodge':
        this._noise(t, 0.2, 900, 0.7, 0.14, 'lowpass', 300);
        break;
      case 'hurt':
        if (!this._throttle(name, 0.08)) return;
        this._tone(t, 0.25, 220, 70, 0.45, 'sawtooth');
        this._noise(t, 0.2, 500, 1, 0.3, 'lowpass');
        break;
      case 'death':
        if (!this._throttle(name, 0.05)) return;
        this._tone(t, 0.5, 300 * (0.8 + Math.random() * 0.4), 40, 0.18, 'sawtooth');
        this._noise(t, 0.35, 900, 0.6, 0.15, 'lowpass', 150);
        break;
      case 'pickup':
        if (!this._throttle(name, 0.035)) return;
        this._tone(t, 0.12, 880 + Math.random() * 300, 1760, 0.06, 'sine');
        break;
      case 'coin':
        if (!this._throttle(name, 0.05)) return;
        this._tone(t, 0.15, 1320, 1320, 0.07, 'square');
        this._tone(t + 0.05, 0.2, 1760, 1760, 0.06, 'square');
        break;
      case 'levelup': {
        const notes = [261, 329, 392, 523, 659];
        notes.forEach((n, i) => this._tone(t + i * 0.07, 0.5, n, n, 0.12, 'triangle'));
        this._noise(t, 0.8, 4000, 0.5, 0.06, 'highpass');
        break;
      }
      case 'chest':
        this._tone(t, 0.6, 110, 55, 0.3, 'sawtooth');
        [523, 784, 1046].forEach((n, i) => this._tone(t + 0.15 + i * 0.09, 0.7, n, n, 0.1, 'sine'));
        break;
      case 'break':
        if (!this._throttle(name, 0.05)) return;
        this._noise(t, 0.4, 700, 0.5, 0.4, 'lowpass', 120);
        this._tone(t, 0.2, 90, 40, 0.35, 'square');
        break;
      case 'bolt':
        if (!this._throttle(name, 0.06)) return;
        this._tone(t, 0.3, 600, 200, 0.07, 'sawtooth');
        break;
      case 'zap':
        if (!this._throttle(name, 0.05)) return;
        this._noise(t, 0.12, 6000, 3, 0.15, 'highpass');
        this._tone(t, 0.1, 2000, 300, 0.05, 'square');
        break;
      case 'boom':
        this._noise(t, 0.8, 400, 0.4, 0.5, 'lowpass', 60);
        this._tone(t, 0.6, 80, 30, 0.6, 'sine');
        break;
      case 'portal':
        this._tone(t, 2.0, 60, 240, 0.25, 'sawtooth', 0.4);
        this._tone(t, 2.0, 90, 360, 0.15, 'triangle', 0.4);
        break;
      case 'roar':
        this._tone(t, 1.6, 70, 40, 0.5, 'sawtooth', 0.1);
        this._tone(t, 1.6, 73, 38, 0.4, 'sawtooth', 0.1);
        this._noise(t, 1.4, 300, 0.4, 0.3, 'lowpass', 100);
        break;
      case 'telegraph':
        if (!this._throttle(name, 0.12)) return;
        this._tone(t, 0.25, 1600, 1900, 0.05, 'sine');
        break;
      case 'ui':
        this._tone(t, 0.08, 660, 660, 0.06, 'square');
        break;
      case 'select':
        this._tone(t, 0.25, 440, 880, 0.1, 'triangle');
        break;
      default:
        break;
    }
  }

  /** Anime SFX set. Returns false for sounds it doesn't override so the retro version plays. */
  _anime(name, k) {
    const t = this.ctx.currentTime;
    const bell = (t0, f, dur, g) => [1, 1.5, 2.76, 4.07].forEach((m, i) => this._tone(t0, dur / (1 + i * 0.6), f * m, f * m, g / (1 + i), 'sine', 0.002));
    switch (name) {
      case 'whoosh':
        if (!this._throttle(name, 0.04)) return true;
        this._noise(t, 0.14, 2500, 2.5, 0.16 * k, 'bandpass', 7000);
        this._tone(t, 0.12, 1800, 4200, 0.03 * k, 'sine');
        return true;
      case 'heavyWhoosh':
        this._noise(t, 0.3, 500, 1.4, 0.24 * k, 'bandpass', 3200);
        this._tone(t, 0.28, 140, 420, 0.08 * k, 'sawtooth');
        return true;
      case 'hit':
        if (!this._throttle(name, 0.03)) return true;
        this._noise(t, 0.05, 4500, 0.7, 0.3 * k, 'highpass');
        this._tone(t, 0.07, 900, 160, 0.16 * k, 'square');
        this._tone(t, 0.14, 130, 45, 0.45 * k, 'sine');
        return true;
      case 'crit':
        this._noise(t, 0.08, 6000, 0.6, 0.35 * k, 'highpass');
        this._tone(t, 0.3, 110, 35, 0.6 * k, 'sine');
        bell(t + 0.01, 1180, 0.6, 0.09 * k);
        return true;
      case 'counter':
        bell(t, 2100, 0.9, 0.14);
        this._noise(t, 0.25, 900, 1, 0.12, 'bandpass', 8000);
        this._tone(t, 0.25, 80, 40, 0.4, 'sine');
        return true;
      case 'dodge':
        this._noise(t, 0.16, 1200, 1.5, 0.13, 'bandpass', 4500);
        return true;
      case 'pickup':
        if (!this._throttle(name, 0.035)) return true;
        this._tone(t, 0.09, 1568, 1568, 0.05, 'sine');
        this._tone(t + 0.05, 0.12, 2093, 2093, 0.05, 'sine');
        return true;
      case 'coin':
        if (!this._throttle(name, 0.05)) return true;
        bell(t, 1760, 0.3, 0.06);
        return true;
      case 'levelup': {
        [523, 659, 784, 1047, 1319, 1568].forEach((n, i) => {
          this._tone(t + i * 0.055, 0.45, n, n, 0.09, 'square');
          this._tone(t + i * 0.055, 0.6, n * 2, n * 2, 0.04, 'triangle');
        });
        bell(t + 0.35, 2093, 1.2, 0.08);
        return true;
      }
      case 'death':
        if (!this._throttle(name, 0.05)) return true;
        this._noise(t, 0.3, 1400, 0.8, 0.2, 'lowpass', 200);
        this._tone(t, 0.25, 520, 90, 0.08, 'triangle');
        return true;
      case 'select':
        bell(t, 1320, 0.4, 0.08);
        return true;
      case 'ui':
        this._tone(t, 0.05, 1760, 1760, 0.04, 'triangle');
        return true;
      default:
        return false;
    }
  }

  /** Karplus–Strong plucked string (shamisen / kalimba-like). */
  _pluck(t, freq, dur, gain, bright = 0.5) {
    const c = this.ctx, sr = c.sampleRate;
    const n = Math.floor(sr * dur);
    const buf = c.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    const N = Math.max(2, Math.round(sr / freq));
    const ring = new Float32Array(N);
    for (let i = 0; i < N; i++) ring[i] = Math.random() * 2 - 1;
    let idx = 0;
    for (let i = 0; i < n; i++) {
      const nx = (idx + 1) % N;
      d[i] = ring[idx];
      ring[idx] = (ring[idx] * (1 - bright) + (ring[idx] + ring[nx]) * 0.5 * bright) * 0.996;
      idx = nx;
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(g).connect(this.master);
    src.start(t);
  }

  _drum(t, f0, f1, dur, gain) {
    this._tone(t, dur, f0, f1, gain, 'sine', 0.002);
    this._noise(t, dur * 0.4, 380, 0.7, gain * 0.5, 'lowpass', 120);
  }

  _taiko(name, k) {
    const t = this.ctx.currentTime;
    const clack = (t0, g) => this._noise(t0, 0.035, 2600, 9, g, 'bandpass');
    const chime = (t0, f, g) => [1, 2.76, 5.4].forEach((m, i) => this._tone(t0, 0.9 / (1 + i), f * m, f * m, g / (1 + i * 1.5), 'sine', 0.002));
    switch (name) {
      case 'whoosh':
        if (!this._throttle(name, 0.04)) return true;
        this._noise(t, 0.16, 2200, 6, 0.2 * k, 'bandpass', 900);
        return true;
      case 'heavyWhoosh':
        this._noise(t, 0.3, 1400, 4, 0.24 * k, 'bandpass', 500);
        this._tone(t, 0.3, 90, 60, 0.12 * k, 'sine');
        return true;
      case 'hit':
        if (!this._throttle(name, 0.03)) return true;
        this._drum(t, 150, 62, 0.24, 0.5 * k);
        clack(t, 0.25 * k);
        return true;
      case 'crit':
        this._drum(t, 115, 40, 0.5, 0.7 * k);
        this._noise(t, 0.4, 7000, 0.5, 0.12 * k, 'highpass');
        clack(t, 0.3 * k);
        return true;
      case 'counter':
        this._tone(t, 0.08, 1450, 1300, 0.12, 'square');
        chime(t + 0.01, 1320, 0.12);
        this._drum(t, 130, 50, 0.3, 0.45);
        return true;
      case 'dodge':
        this._noise(t, 0.13, 5000, 0.8, 0.12, 'highpass');
        return true;
      case 'pickup':
        if (!this._throttle(name, 0.035)) return true;
        chime(t, 2637, 0.035);
        return true;
      case 'coin':
        if (!this._throttle(name, 0.05)) return true;
        chime(t, 1760, 0.05); chime(t + 0.06, 2349, 0.04);
        return true;
      case 'levelup':
        [0, 0.11, 0.2, 0.27].forEach((d, i) => this._drum(t + d, 140 - i * 6, 60, 0.25, 0.4));
        [293.7, 349.2, 392, 440, 523.3, 587.3].forEach((f, i) => this._pluck(t + 0.3 + i * 0.07, f, 0.9, 0.22, 0.6));
        return true;
      case 'death':
        if (!this._throttle(name, 0.05)) return true;
        this._drum(t, 90, 40, 0.35, 0.35);
        this._noise(t, 0.35, 1100, 5, 0.1, 'bandpass', 500);
        return true;
      case 'select':
        this._pluck(t, 440, 0.6, 0.25, 0.6);
        return true;
      case 'ui':
        clack(t, 0.12);
        return true;
      default:
        return false;
    }
  }

  _folk(name, k) {
    const t = this.ctx.currentTime;
    const wood = (t0, f, g) => { this._tone(t0, 0.07, f, f * 0.94, g, 'sine', 0.001); this._noise(t0, 0.02, f * 3, 4, g * 0.6, 'bandpass'); };
    const box = (t0, f, g) => { this._tone(t0, 0.5, f, f, g, 'sine', 0.001); this._tone(t0, 0.25, f * 2, f * 2, g * 0.35, 'sine', 0.001); };
    const penta = [523.3, 587.3, 659.3, 784, 880, 1046.5];
    switch (name) {
      case 'whoosh':
        if (!this._throttle(name, 0.04)) return true;
        this._noise(t, 0.12, 3000, 1, 0.12 * k, 'bandpass', 1800);
        return true;
      case 'heavyWhoosh':
        this._noise(t, 0.24, 1800, 1, 0.16 * k, 'bandpass', 900);
        wood(t + 0.05, 260, 0.12 * k);
        return true;
      case 'hit':
        if (!this._throttle(name, 0.03)) return true;
        wood(t, 760 + Math.random() * 120, 0.32 * k);
        this._tone(t, 0.1, 140, 80, 0.25 * k, 'sine');
        return true;
      case 'crit':
        wood(t, 620, 0.35 * k);
        [196, 247, 294].forEach((f) => this._pluck(t, f, 0.7, 0.18 * k, 0.4));
        return true;
      case 'counter':
        wood(t, 900, 0.3);
        [2093, 2637, 3136].forEach((f, i) => box(t + 0.03 + i * 0.05, f, 0.06));
        return true;
      case 'dodge':
        this._noise(t, 0.15, 2600, 1.2, 0.1, 'bandpass', 1200);
        return true;
      case 'pickup':
        if (!this._throttle(name, 0.035)) return true;
        box(t, penta[(Math.random() * penta.length) | 0] * 2, 0.04);
        return true;
      case 'coin':
        if (!this._throttle(name, 0.05)) return true;
        this._pluck(t, 1046.5, 0.5, 0.2, 0.9);
        return true;
      case 'levelup':
        [523.3, 659.3, 784, 1046.5, 1318.5].forEach((f, i) => this._pluck(t + i * 0.09, f, 0.9, 0.24, 0.9));
        box(t + 0.5, 2093, 0.06);
        return true;
      case 'death':
        if (!this._throttle(name, 0.05)) return true;
        this._pluck(t, 196, 0.5, 0.18, 0.3);
        this._noise(t, 0.25, 900, 0.8, 0.12, 'lowpass', 200);
        return true;
      case 'select':
        box(t, 1318.5, 0.08);
        return true;
      case 'ui':
        wood(t, 1100, 0.1);
        return true;
      default:
        return false;
    }
  }

  _startAmbience() {
    const c = this.ctx;
    this.ambGain = c.createGain();
    this.ambGain.gain.value = 0.0;
    this.ambFilter = c.createBiquadFilter();
    this.ambFilter.type = 'lowpass';
    this.ambFilter.frequency.value = 400;
    this.ambFilter.Q.value = 4;
    this.ambFilter.connect(this.ambGain).connect(this.master);
    this.ambOsc = [];
    for (const f of [41.2, 41.7, 61.7, 82.1]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.value = 0.12;
      o.connect(g).connect(this.ambFilter);
      o.start();
      this.ambOsc.push(o);
    }
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = c.createGain();
    lg.gain.value = 260;
    lfo.connect(lg).connect(this.ambFilter.frequency);
    lfo.start();
  }

  setAmbience(level, pitch = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.ambGain.gain.setTargetAtTime(level * 0.35, t, 1.2);
    const base = [41.2, 41.7, 61.7, 82.1];
    this.ambOsc.forEach((o, i) => o.frequency.setTargetAtTime(base[i] * pitch, t, 2));
  }
}

export const audio = new Audio();
