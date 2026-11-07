// Dynamic resolution: the scene's render scale follows the frame rate. Frames that run long for a sustained second
// step the scale down. Calm frames for several seconds step it back up, but never straight back to the level that
// was too slow: that cap lapses after `holdCap` seconds, so the scale can probe upward again later.

const round3 = (v) => Math.round(v * 1000) / 1000;

export class AdaptiveScaler {
  /**
   * @param {object} o
   * @param {number} o.max      scale at full quality (the quality preset)
   * @param {number} o.min      lowest scale allowed (never above `max`)
   * @param {number} o.slow     frame interval (s) above which the frame counts as slow
   * @param {number} o.calm     frame interval (s) below which the frame counts as calm
   * @param {number} o.downAfter seconds of sustained slow frames before stepping down
   * @param {number} o.upAfter  seconds of sustained calm frames before stepping up
   * @param {number} o.warmup   seconds after a reset during which the scale is left alone (shader warm-up)
   * @param {number} o.step     size of each step
   * @param {number} o.holdCap  seconds a too-slow level stays off-limits
   */
  constructor({ max = 1, min = 0.5, slow = 0.02, calm = 0.0175, downAfter = 1, upAfter = 3, warmup = 3, step = 0.05, holdCap = 30, enabled = true } = {}) {
    this.enabled = enabled;
    this.slow = slow; this.calm = calm; this.downAfter = downAfter; this.upAfter = upAfter;
    this.warmup = warmup; this.step = step; this.holdCap = holdCap;
    this.reset(max, min);
  }

  reset(max, min = 0.5) {
    this.max = max;
    this.min = Math.min(min, max);
    this.scale = max;
    this.age = 0;
    this.ema = 0;
    this.slowT = 0;
    this.calmT = 0;
    this.cap = Infinity;
    this.capT = 0;
  }

  /** Feed one real frame interval in seconds. Returns the render scale to use for this frame. */
  update(dt) {
    if (!this.enabled) { this.scale = this.max; return this.scale; }
    // a hitch (a tab switch, a load) is one frame, not a reason to change quality
    dt = Math.min(0.25, Math.max(0, dt));
    this.age += dt;
    this.ema = this.ema === 0 ? dt : this.ema + (dt - this.ema) * 0.08;
    if (this.capT > 0) { this.capT -= dt; if (this.capT <= 0) this.cap = Infinity; }
    if (this.age < this.warmup) return this.scale;

    if (this.ema > this.slow) {
      this.calmT = 0;
      this.slowT += dt;
      if (this.slowT >= this.downAfter && this.scale > this.min) {
        this.cap = this.scale;
        this.capT = this.holdCap;
        this.scale = Math.max(this.min, round3(this.scale - this.step));
        this.slowT = 0;
      }
    } else if (this.ema < this.calm) {
      this.slowT = 0;
      this.calmT += dt;
      const up = Math.min(this.max, round3(this.scale + this.step));
      if (this.calmT >= this.upAfter && up > this.scale && up < this.cap) {
        this.scale = up;
        this.calmT = 0;
      }
    } else {
      this.slowT = 0;
      this.calmT = 0;
    }
    return this.scale;
  }
}
