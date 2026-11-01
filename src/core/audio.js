// Procedural WebAudio sound design: no samples, everything synthesized at runtime.

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = 0.6;
    this.lastPlay = new Map();
  }

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
