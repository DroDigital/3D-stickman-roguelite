// Cinematic camera director: layers shot changes and camera feel on top of the gameplay camera.
//  - trauma-based shake: smooth noise on position and rotation, squared so small hits stay subtle
//  - punches: FOV kicks and dutch-angle rolls on heavy hits, ultimates and parries
//  - shots: finisher orbits with slow motion and shallow depth of field on elite / last-of-wave kills,
//    a letterboxed low-angle orbit for boss introductions, a long fall-back on boss deaths and on the hero's death
// The gameplay camera stays in control of yaw/pitch; shots blend in and out as offsets so control never snaps.
import { clamp, lerp, damp } from '../core/math.js';

function noise1(t) {
  // smooth 1D value noise built from a few sines with irrational ratios
  return Math.sin(t * 1.0) * 0.5 + Math.sin(t * 2.31 + 1.3) * 0.3 + Math.sin(t * 4.77 + 2.1) * 0.2;
}

export class Director {
  constructor() {
    this.trauma = 0;
    this.t = 0;
    this.roll = 0;
    this.rollV = 0;
    this.fovPunch = 0;
    this.shot = null;
    this.blend = 0;
    this.out = { yaw: 0, pitch: 0, dist: 1, fov: 0, roll: 0, px: 0, py: 0, pz: 0, rx: 0, ry: 0, target: null, dof: 0, focus: 6, letterbox: 0, lookY: 0 };
    this.cooldown = 0;
  }

  addTrauma(a) { this.trauma = clamp(this.trauma + a, 0, 1); }

  /** A dutch-angle kick (radians) that springs back. */
  kickRoll(a) { this.rollV += a * 18; }

  punchFov(a) { this.fovPunch = Math.max(this.fovPunch, a); }

  /** Elite / finishing kill: swing around the target in slow motion with a shallow focus. */
  finisher(target, side = Math.random() < 0.5 ? -1 : 1, dur = 0.9) {
    if (this.cooldown > 0 || (this.shot && this.shot.prio > 1)) return false;
    this.shot = { kind: 'finisher', t: 0, dur, target: { x: target.x, y: target.y + 1, z: target.z }, side, prio: 1 };
    this.cooldown = 4;
    return true;
  }

  /** Boss introduction: low orbit with letterbox. */
  bossIntro(boss, dur = 3.2) {
    this.shot = { kind: 'boss', t: 0, dur, target: boss, side: 1, prio: 3 };
  }

  /** Big death beat (boss or hero): long pull back. */
  deathBeat(target, dur = 2.4) {
    this.shot = { kind: 'death', t: 0, dur, target: { x: target.x, y: target.y + 1, z: target.z }, side: Math.random() < 0.5 ? -1 : 1, prio: 4 };
  }

  get active() { return !!this.shot; }

  /** Advance with real (unscaled) time. Returns the offsets for the gameplay camera. */
  update(rawDt) {
    const o = this.out;
    this.t += rawDt;
    this.cooldown = Math.max(0, this.cooldown - rawDt);
    // trauma shake
    this.trauma = Math.max(0, this.trauma - rawDt * 1.1);
    const sh = this.trauma * this.trauma;
    const f = this.t * 22;
    o.px = noise1(f) * sh * 0.35; o.py = noise1(f + 31.7) * sh * 0.3; o.pz = noise1(f + 77.1) * sh * 0.35;
    o.rx = noise1(f * 0.8 + 11) * sh * 0.05; o.ry = noise1(f * 0.8 + 53) * sh * 0.05;
    // roll spring
    this.rollV += (-this.roll * 120 - this.rollV * 14) * rawDt;
    this.roll += this.rollV * rawDt;
    this.fovPunch = damp(this.fovPunch, 0, 7, rawDt);
    o.roll = this.roll + noise1(f * 0.6 + 5) * sh * 0.06;
    o.fov = this.fovPunch;
    // shots
    let wantBlend = 0;
    o.yaw = 0; o.pitch = 0; o.dist = 1; o.dof = 0; o.letterbox = 0; o.target = null; o.lookY = 0;
    const s = this.shot;
    if (s) {
      s.t += rawDt;
      const k = s.t / s.dur;
      if (k >= 1) this.shot = null;
      else {
        wantBlend = 1;
        const ease = Math.sin(Math.min(1, k) * Math.PI);
        if (s.kind === 'finisher') {
          o.yaw = s.side * 0.7 * ease;
          o.pitch = -0.12 * ease;
          o.dist = 1 - 0.25 * ease;
          o.fov = Math.min(o.fov, 0) - 0.12 * ease;
          o.dof = ease;
          o.letterbox = ease * 0.5;
          o.target = s.target;
        } else if (s.kind === 'boss') {
          const b = s.target;
          o.target = { x: b.x, y: (b.cy ?? b.y + 2.5 * (b.size || 1)), z: b.z };
          o.yaw = (k - 0.5) * 1.6;
          o.pitch = -0.28 * ease;
          o.dist = 1.4;
          o.fov = -0.08 * ease;
          o.dof = 0.6 * ease;
          o.letterbox = Math.min(1, ease * 2);
          o.lookY = 1.5 * ease;
        } else if (s.kind === 'death') {
          o.target = s.target;
          o.yaw = s.side * 0.9 * Math.min(1, k * 1.5);
          o.pitch = 0.25 * Math.min(1, k * 2);
          o.dist = 1 + 0.6 * Math.min(1, k * 1.2);
          o.dof = Math.min(1, k * 3) * (1 - Math.max(0, k - 0.8) * 5);
          o.letterbox = Math.min(1, k * 4) * (1 - Math.max(0, k - 0.85) * 6.6);
        }
      }
    }
    this.blend = damp(this.blend, wantBlend, wantBlend ? 6 : 3, rawDt);
    return o;
  }
}

export { lerp };
