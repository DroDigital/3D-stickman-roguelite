// Procedural humanoid stickman: parametric pose -> FK arms + 2-bone IK legs, gait synthesis, keyframed action clips,
// spring-based secondary motion and terrain-aware foot placement.
import { Topology } from './rig.js';
import { rotYXZ, lerp, smoothstep, clamp, DEG } from '../core/math.js';

/** Global drawing clock for limited animation. stepRate 0 = full frame rate, 12 = "on twos", 8 = "on threes". */
export const ANIM = { stepRate: 0, frame: 0, acc: 0 };

export function tickAnimClock(dt) {
  if (!ANIM.stepRate) { ANIM.frame++; return; }
  ANIM.acc += dt;
  const step = 1 / ANIM.stepRate;
  if (ANIM.acc >= step) { ANIM.acc %= step; ANIM.frame++; }
}

export const J = { PELVIS: 0, CHEST: 1, NECK: 2, HEAD: 3, LSH: 4, LEL: 5, LHA: 6, RSH: 7, REL: 8, RHA: 9, LHIP: 10, LKN: 11, LFT: 12, RHIP: 13, RKN: 14, RFT: 15 };

const HIP_H = 0.95, SPINE = 0.5, NECK = 0.1, HEAD_R = 0.17, SHW = 0.17, UARM = 0.3, FARM = 0.29, HIPW = 0.1, THIGH = 0.47, SHIN = 0.46, FOOT_H = 0.05;

export function humanoidTopology(limb = 0.045, head = 0.17, opts = {}) {
  const segs = [
    [J.PELVIS, J.CHEST, limb * 1.25, 0],
    [J.CHEST, J.NECK, limb, 0],
    [J.CHEST, J.LSH, limb, 0],
    [J.LSH, J.LEL, limb, 0],
    [J.LEL, J.LHA, limb * 0.9, 0],
    [J.CHEST, J.RSH, limb, 0],
    [J.RSH, J.REL, limb, 0],
    [J.REL, J.RHA, limb * 0.9, 0],
    [J.PELVIS, J.LHIP, limb, 0],
    [J.LHIP, J.LKN, limb * 1.1, 0],
    [J.LKN, J.LFT, limb, 0],
    [J.PELVIS, J.RHIP, limb, 0],
    [J.RHIP, J.RKN, limb * 1.1, 0],
    [J.RKN, J.RFT, limb, 0],
    [J.NECK, J.HEAD, limb * 0.8, 0],
  ];
  const balls = [
    [J.HEAD, head, opts.headSlot ?? 0, 1],
    [J.LEL, limb * 1.15, 0], [J.REL, limb * 1.15, 0], [J.LKN, limb * 1.2, 0], [J.RKN, limb * 1.2, 0],
    [J.LHA, limb * 1.3, 0], [J.RHA, limb * 1.3, 0], [J.LFT, limb * 1.3, 0], [J.RFT, limb * 1.3, 0],
    [J.CHEST, limb * 1.4, 0], [J.PELVIS, limb * 1.3, 0], [J.LSH, limb * 1.15, 0], [J.RSH, limb * 1.15, 0],
  ];
  const braces = [[J.LSH, J.RSH], [J.LSH, J.PELVIS], [J.RSH, J.PELVIS], [J.LHIP, J.RHIP], [J.LHIP, J.CHEST], [J.RHIP, J.CHEST], [J.NECK, J.LSH], [J.NECK, J.RSH], [J.HEAD, J.CHEST]];
  // severable: forearms, shins, head
  const severable = [4, 7, 10, 13, 14];
  return new Topology(16, segs, balls, braces, severable);
}

const KEYS = ['px', 'py', 'pz', 'lean', 'side', 'twist', 'hipYaw', 'headP', 'headY', 'lp', 'lo', 'le', 'lw', 'rp', 'ro', 're', 'rw', 'lfx', 'lfy', 'lfz', 'rfx', 'rfy', 'rfz', 'spin', 'flip'];

export function makePose(over = {}) {
  const p = {};
  for (const k of KEYS) p[k] = 0;
  p.lo = 0.12; p.ro = 0.12; p.le = 0.25; p.re = 0.25;
  return Object.assign(p, over);
}

export function copyPose(dst, src) { for (const k of KEYS) dst[k] = src[k]; return dst; }

export function blendPose(out, a, b, t) {
  for (const k of KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

const d = DEG;
// ---------------------------------------------------------------- stance presets
export const STANCE = {
  fists: makePose({ lean: 0.14, py: -0.05, lp: 55 * d, lo: 22 * d, le: 95 * d, rp: 45 * d, ro: 22 * d, re: 100 * d, headP: -0.08, lfz: 0.12, rfz: -0.1 }),
  blade: makePose({ lean: 0.12, py: -0.06, lp: 25 * d, lo: 20 * d, le: 60 * d, rp: 30 * d, ro: 18 * d, re: 55 * d, rw: 40 * d, lfz: 0.14, rfz: -0.12, twist: -0.1 }),
  heavy: makePose({ lean: 0.18, py: -0.1, lp: 40 * d, lo: 5 * d, le: 70 * d, rp: 40 * d, ro: 5 * d, re: 70 * d, rw: 60 * d, lfz: 0.18, rfz: -0.16, lfx: 0.06, rfx: -0.06 }),
  spear: makePose({ lean: 0.1, py: -0.06, lp: 50 * d, lo: 0, le: 40 * d, rp: 15 * d, ro: 10 * d, re: 75 * d, rw: 10 * d, lfz: 0.2, rfz: -0.15, twist: -0.25 }),
  dual: makePose({ lean: 0.22, py: -0.12, lp: 40 * d, lo: 25 * d, le: 80 * d, lw: 50 * d, rp: 40 * d, ro: 25 * d, re: 80 * d, rw: 50 * d, lfz: 0.15, rfz: -0.12 }),
};

// ---------------------------------------------------------------- clip library
// Each key: [t (0..1), poseOverrides]. Poses are layered on top of the weapon stance.
const C = (dur, keys, extra = {}) => ({ dur, keys, ...extra });
export const CLIPS = {
  jab: C(0.32, [[0, {}], [0.3, { twist: -0.45, lp: 85 * d, le: 5 * d, lo: 8 * d, lean: 0.25, lfz: 0.3 }], [0.55, { twist: -0.4, lp: 82 * d, le: 8 * d, lo: 8 * d, lean: 0.25, lfz: 0.3 }], [1, {}]], { hitT: 0.3 }),
  cross: C(0.36, [[0, {}], [0.15, { twist: -0.3 }], [0.35, { twist: 0.6, rp: 88 * d, re: 4 * d, ro: 6 * d, lean: 0.3, rfz: 0.05, lfz: 0.3, hipYaw: 0.3 }], [0.6, { twist: 0.55, rp: 85 * d, re: 8 * d, ro: 6 * d, lean: 0.3, hipYaw: 0.3 }], [1, {}]], { hitT: 0.35 }),
  hook: C(0.4, [[0, {}], [0.2, { twist: -0.5, lp: 80 * d, lo: 70 * d, le: 85 * d }], [0.42, { twist: 0.7, lp: 85 * d, lo: -30 * d, le: 80 * d, lean: 0.2, hipYaw: 0.4 }], [0.65, { twist: 0.7, lp: 80 * d, lo: -30 * d, le: 85 * d, hipYaw: 0.4 }], [1, {}]], { hitT: 0.42 }),
  kick: C(0.5, [[0, {}], [0.25, { lean: -0.25, rfz: 0.3, rfy: 0.45, py: -0.04, twist: 0.2 }], [0.45, { lean: -0.35, rfz: 0.85, rfy: 0.75, rfx: 0.05, twist: 0.25, lp: 70 * d, rp: 20 * d, ro: 50 * d }], [0.65, { lean: -0.3, rfz: 0.8, rfy: 0.7, twist: 0.2 }], [1, {}]], { hitT: 0.45, hitPoint: 'rfoot' }),
  spinKick: C(0.62, [[0, {}], [0.2, { spin: -1.0, py: -0.08 }], [0.5, { spin: -3.6, lean: -0.3, rfz: 0.4, rfx: -0.6, rfy: 0.8, lo: 70 * d, ro: 70 * d, lp: 30 * d, rp: 30 * d }], [0.75, { spin: -6.0, lean: -0.15, rfz: 0.2, rfy: 0.3 }], [1, { spin: -2 * Math.PI }]], { hitT: 0.5, hitPoint: 'rfoot' }),
  uppercut: C(0.5, [[0, {}], [0.25, { py: -0.25, lean: 0.35, rp: 10 * d, re: 120 * d, twist: -0.35 }], [0.5, { py: 0.12, lean: -0.15, rp: 160 * d, re: 50 * d, ro: 5 * d, twist: 0.4, rfy: 0.12 }], [0.75, { py: 0.08, lean: -0.1, rp: 150 * d, re: 55 * d }], [1, {}]], { hitT: 0.48 }),

  slashR: C(0.42, [[0, {}], [0.22, { twist: -0.8, rp: 85 * d, ro: 95 * d, re: 15 * d, rw: 15 * d, lean: 0.1 }], [0.45, { twist: 0.75, rp: 80 * d, ro: -65 * d, re: 10 * d, rw: 10 * d, lean: 0.3, lfz: 0.35, hipYaw: 0.3 }], [0.7, { twist: 0.7, rp: 70 * d, ro: -60 * d, re: 20 * d, rw: 20 * d, lean: 0.25, lfz: 0.3, hipYaw: 0.3 }], [1, {}]], { hitT: 0.4 }),
  slashL: C(0.42, [[0, {}], [0.22, { twist: 0.8, rp: 80 * d, ro: -70 * d, re: 25 * d, rw: 20 * d }], [0.45, { twist: -0.75, rp: 85 * d, ro: 100 * d, re: 10 * d, rw: 10 * d, lean: 0.3, rfz: 0.3, hipYaw: -0.3 }], [0.7, { twist: -0.7, rp: 75 * d, ro: 95 * d, re: 15 * d, rw: 15 * d, lean: 0.25, hipYaw: -0.3 }], [1, {}]], { hitT: 0.4 }),
  overhead: C(0.55, [[0, {}], [0.3, { lean: -0.2, rp: 175 * d, re: 30 * d, rw: 40 * d, lp: 160 * d, le: 30 * d, py: 0.04 }], [0.55, { lean: 0.55, py: -0.22, rp: 70 * d, re: 5 * d, rw: 5 * d, lp: 60 * d, le: 10 * d, lfz: 0.45, rfz: -0.25 }], [0.8, { lean: 0.5, py: -0.2, rp: 60 * d, re: 10 * d, rw: 5 * d, lfz: 0.45, rfz: -0.25 }], [1, {}]], { hitT: 0.52 }),
  thrust: C(0.4, [[0, {}], [0.2, { twist: -0.5, rp: 5 * d, re: 95 * d, rw: 0, lean: 0.05 }], [0.42, { twist: 0.35, rp: 88 * d, re: 2 * d, rw: 0, ro: 0, lean: 0.35, lfz: 0.5, rfz: -0.35, py: -0.12 }], [0.7, { twist: 0.3, rp: 85 * d, re: 5 * d, rw: 0, lean: 0.3, lfz: 0.45, rfz: -0.35, py: -0.1 }], [1, {}]], { hitT: 0.4 }),
  spin: C(0.6, [[0, {}], [0.15, { spin: 0.6, rp: 85 * d, ro: 100 * d, re: 5 * d, rw: 5 * d, py: -0.12 }], [0.55, { spin: -4.2, rp: 88 * d, ro: 95 * d, re: 5 * d, rw: 5 * d, lp: 80 * d, lo: 90 * d, py: -0.15, lean: 0.15 }], [0.8, { spin: -2 * Math.PI, rp: 80 * d, ro: 80 * d, re: 10 * d, py: -0.1 }], [1, { spin: -2 * Math.PI }]], { hitT: 0.4, hitT2: 0.6 }),
  slam: C(0.75, [[0, {}], [0.35, { lean: -0.3, py: 0.06, rp: 185 * d, re: 25 * d, rw: 30 * d, lp: 180 * d, le: 25 * d, rfy: 0.05 }], [0.55, { lean: 0.7, py: -0.32, rp: 55 * d, re: 0, rw: 10 * d, lp: 55 * d, le: 0, lfz: 0.5, rfz: -0.3 }], [0.85, { lean: 0.65, py: -0.3, rp: 50 * d, re: 0, rw: 10 * d, lp: 50 * d, lfz: 0.5, rfz: -0.3 }], [1, {}]], { hitT: 0.55 }),
  reap: C(0.6, [[0, {}], [0.3, { twist: -1.1, rp: 120 * d, ro: 110 * d, re: 30 * d, rw: 70 * d, lp: 110 * d, lo: 40 * d, le: 50 * d, lean: -0.1 }], [0.55, { twist: 1.0, rp: 60 * d, ro: -70 * d, re: 10 * d, rw: 80 * d, lp: 60 * d, lo: -40 * d, lean: 0.4, py: -0.15, lfz: 0.4, hipYaw: 0.4 }], [0.8, { twist: 0.95, rp: 55 * d, ro: -65 * d, re: 15 * d, rw: 80 * d, lean: 0.35, py: -0.12, hipYaw: 0.4 }], [1, {}]], { hitT: 0.52 }),
  dualFlurry: C(0.36, [[0, {}], [0.2, { twist: -0.6, rp: 80 * d, ro: 90 * d, lp: 60 * d, lo: -30 * d, lean: 0.25 }], [0.4, { twist: 0.6, rp: 75 * d, ro: -60 * d, re: 10 * d, lp: 85 * d, lo: 80 * d, le: 10 * d, lean: 0.35, lfz: 0.3 }], [0.7, { twist: 0.5, rp: 70 * d, ro: -50 * d, lp: 80 * d, lo: 70 * d, lean: 0.3 }], [1, {}]], { hitT: 0.36, hitT2: 0.55 }),
  dualCross: C(0.42, [[0, {}], [0.22, { lean: -0.1, rp: 150 * d, ro: 60 * d, lp: 150 * d, lo: 60 * d, re: 20 * d, le: 20 * d }], [0.45, { lean: 0.5, py: -0.2, rp: 60 * d, ro: -50 * d, lp: 60 * d, lo: -50 * d, re: 5 * d, le: 5 * d, lfz: 0.4 }], [0.75, { lean: 0.45, py: -0.18, rp: 55 * d, ro: -45 * d, lp: 55 * d, lo: -45 * d }], [1, {}]], { hitT: 0.45 }),

  // movement / reactions
  dodge: C(0.42, [[0, {}], [0.12, { py: -0.35, lean: 0.7, lp: 60 * d, le: 120 * d, rp: 60 * d, re: 120 * d, lfy: 0.25, rfy: 0.2, lfz: 0.2, rfz: 0.15, flip: 0.6 }], [0.7, { py: -0.4, lean: 0.8, lp: 70 * d, le: 130 * d, rp: 70 * d, re: 130 * d, lfy: 0.35, rfy: 0.35, lfz: 0.3, rfz: 0.3, flip: 2 * Math.PI - 0.5 }], [1, { flip: 2 * Math.PI }]], { full: true }),
  backflip: C(0.48, [[0, {}], [0.15, { py: -0.25, lean: 0.2, lp: 160 * d, rp: 160 * d }], [0.6, { py: 0.1, lean: -0.5, lp: 150 * d, rp: 150 * d, lfy: 0.4, rfy: 0.4, flip: -4.5 }], [1, { flip: -2 * Math.PI }]], { full: true }),
  hit: C(0.32, [[0, {}], [0.25, { lean: -0.45, headP: -0.5, twist: 0.3, lp: 30 * d, lo: 50 * d, rp: 20 * d, ro: 60 * d, py: -0.05 }], [1, {}]], { full: true }),
  stagger: C(0.9, [[0, {}], [0.15, { lean: -0.6, headP: -0.6, twist: -0.3, lp: 10 * d, lo: 70 * d, rp: 15 * d, ro: 75 * d, py: -0.12, rfz: -0.3 }], [0.6, { lean: 0.5, headP: 0.4, py: -0.25, lp: -10 * d, rp: -10 * d, lfz: 0.2 }], [1, {}]], { full: true }),
  counter: C(0.5, [[0, {}], [0.15, { spin: 0.8, py: -0.2, rp: 140 * d, re: 60 * d, lp: 90 * d, lo: 60 * d }], [0.45, { spin: -0.2, lean: 0.5, py: -0.25, rp: 75 * d, ro: -60 * d, re: 5 * d, rw: 10 * d, lp: 40 * d, lfz: 0.45, rfz: -0.3 }], [0.75, { lean: 0.45, py: -0.22, rp: 70 * d, ro: -55 * d, re: 10 * d }], [1, {}]], { hitT: 0.4 }),
  finisher: C(0.9, [[0, {}], [0.25, { py: 0.35, lean: -0.3, rp: 185 * d, lp: 185 * d, re: 20 * d, le: 20 * d, rw: 20 * d, lfy: 0.3, rfy: 0.25, flip: -0.6 }], [0.5, { py: -0.4, lean: 0.85, rp: 50 * d, lp: 50 * d, re: 0, le: 0, rw: 0, lfz: 0.5, rfz: -0.4, flip: 0 }], [0.85, { py: -0.38, lean: 0.8, rp: 45 * d, lp: 45 * d, lfz: 0.5, rfz: -0.4 }], [1, {}]], { hitT: 0.5 }),
  cast: C(0.6, [[0, {}], [0.3, { lean: -0.2, lp: 170 * d, rp: 170 * d, lo: 30 * d, ro: 30 * d, headP: -0.4 }], [0.6, { lean: 0.2, lp: 90 * d, rp: 90 * d, lo: 10 * d, ro: 10 * d, le: 0, re: 0 }], [1, {}]], { hitT: 0.6 }),
  claw: C(0.55, [[0, {}], [0.45, { lean: -0.25, lp: 165 * d, rp: 165 * d, le: 40 * d, re: 40 * d, lo: 30 * d, ro: 30 * d, py: 0.03 }], [0.62, { lean: 0.6, py: -0.15, lp: 50 * d, rp: 50 * d, le: 10 * d, re: 10 * d, lfz: 0.35 }], [1, {}]], { hitT: 0.62 }),
};

// Pre-sampled key poses resolved against a stance at runtime.
export function sampleClip(out, clip, stance, t) {
  const keys = clip.keys;
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const k0 = keys[i], k1 = keys[i + 1];
  const span = Math.max(1e-4, k1[0] - k0[0]);
  const u = smoothstep(clamp((t - k0[0]) / span, 0, 1));
  for (const k of KEYS) {
    const a = k in k0[1] ? k0[1][k] : stance[k];
    const b = k in k1[1] ? k1[1][k] : stance[k];
    out[k] = a + (b - a) * u;
  }
  return out;
}

// ---------------------------------------------------------------- solver
const T = new Float32Array(3);
const W = new Float32Array(3);

function setP(out, i, x, y, z) { out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z; }

function armDir(out, pitch, abduct, side, yaw, lean, roll) {
  const so = Math.sin(abduct), co = Math.cos(abduct);
  const lx = side * so, ly = -co * Math.cos(pitch), lz = co * Math.sin(pitch);
  rotYXZ(out, 0, lx, ly, lz, yaw, lean, roll);
}

function ik(out, hi, fi, ki, l1, l2, poleX, poleY, poleZ) {
  const hx = out[hi * 3], hy = out[hi * 3 + 1], hz = out[hi * 3 + 2];
  let fx = out[fi * 3], fy = out[fi * 3 + 1], fz = out[fi * 3 + 2];
  let dx = fx - hx, dy = fy - hy, dz = fz - hz;
  let dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-5;
  const maxD = (l1 + l2) * 0.999;
  if (dist > maxD) {
    const s = maxD / dist;
    dx *= s; dy *= s; dz *= s;
    fx = hx + dx; fy = hy + dy; fz = hz + dz;
    out[fi * 3] = fx; out[fi * 3 + 1] = fy; out[fi * 3 + 2] = fz;
    dist = maxD;
  }
  const nx = dx / dist, ny = dy / dist, nz = dz / dist;
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  // pole projected perpendicular to n
  const pd = poleX * nx + poleY * ny + poleZ * nz;
  let px = poleX - nx * pd, py = poleY - ny * pd, pz = poleZ - nz * pd;
  const pl = Math.sqrt(px * px + py * py + pz * pz) || 1;
  px /= pl; py /= pl; pz /= pl;
  out[ki * 3] = hx + nx * a + px * h;
  out[ki * 3 + 1] = hy + ny * a + py * h;
  out[ki * 3 + 2] = hz + nz * a + pz * h;
}

/**
 * Solve pose into local-space points (character faces +Z, +X is its left).
 * weaponOut receives [rdx,rdy,rdz, ldx,ldy,ldz] weapon directions.
 */
export function solveHumanoid(p, out, s = 1, weaponOut = null) {
  const pelX = p.px * s, pelY = (HIP_H + p.py) * s, pelZ = p.pz * s;
  setP(out, J.PELVIS, pelX, pelY, pelZ);
  const ty = p.twist + p.hipYaw, tl = p.lean, tr = p.side;
  rotYXZ(T, 0, 0, SPINE * s, 0, ty, tl, tr);
  const cx = pelX + T[0], cy = pelY + T[1], cz = pelZ + T[2];
  setP(out, J.CHEST, cx, cy, cz);
  rotYXZ(T, 0, 0, NECK * s, 0, ty, tl * 1.1, tr);
  const nx = cx + T[0], ny = cy + T[1], nz = cz + T[2];
  setP(out, J.NECK, nx, ny, nz);
  rotYXZ(T, 0, 0, HEAD_R * s * 1.05, 0, ty + p.headY, tl + p.headP, tr);
  setP(out, J.HEAD, nx + T[0], ny + T[1], nz + T[2]);
  // shoulders
  rotYXZ(T, 0, SHW * s, -0.03 * s, 0, ty, tl, tr);
  const lsx = cx + T[0], lsy = cy + T[1], lsz = cz + T[2];
  rotYXZ(T, 0, -SHW * s, -0.03 * s, 0, ty, tl, tr);
  const rsx = cx + T[0], rsy = cy + T[1], rsz = cz + T[2];
  setP(out, J.LSH, lsx, lsy, lsz);
  setP(out, J.RSH, rsx, rsy, rsz);
  // left arm
  armDir(T, p.lp, p.lo, 1, ty, tl, tr);
  const lex = lsx + T[0] * UARM * s, ley = lsy + T[1] * UARM * s, lez = lsz + T[2] * UARM * s;
  setP(out, J.LEL, lex, ley, lez);
  armDir(T, p.lp + p.le, p.lo, 1, ty, tl, tr);
  setP(out, J.LHA, lex + T[0] * FARM * s, ley + T[1] * FARM * s, lez + T[2] * FARM * s);
  if (weaponOut) { armDir(W, p.lp + p.le + p.lw, p.lo, 1, ty, tl, tr); weaponOut[3] = W[0]; weaponOut[4] = W[1]; weaponOut[5] = W[2]; }
  // right arm
  armDir(T, p.rp, p.ro, -1, ty, tl, tr);
  const rex = rsx + T[0] * UARM * s, rey = rsy + T[1] * UARM * s, rez = rsz + T[2] * UARM * s;
  setP(out, J.REL, rex, rey, rez);
  armDir(T, p.rp + p.re, p.ro, -1, ty, tl, tr);
  setP(out, J.RHA, rex + T[0] * FARM * s, rey + T[1] * FARM * s, rez + T[2] * FARM * s);
  if (weaponOut) { armDir(W, p.rp + p.re + p.rw, p.ro, -1, ty, tl, tr); weaponOut[0] = W[0]; weaponOut[1] = W[1]; weaponOut[2] = W[2]; }
  // hips
  const hc = Math.cos(p.hipYaw), hs = Math.sin(p.hipYaw);
  setP(out, J.LHIP, pelX + HIPW * s * hc, pelY - 0.02 * s, pelZ - HIPW * s * hs);
  setP(out, J.RHIP, pelX - HIPW * s * hc, pelY - 0.02 * s, pelZ + HIPW * s * hs);
  // feet (local ground y=0)
  setP(out, J.LFT, (HIPW + 0.03 + p.lfx) * s, (FOOT_H + p.lfy) * s, p.lfz * s);
  setP(out, J.RFT, (-HIPW - 0.03 + p.rfx) * s, (FOOT_H + p.rfy) * s, p.rfz * s);
  ik(out, J.LHIP, J.LFT, J.LKN, THIGH * s, SHIN * s, 0.15 * hs + Math.sin(ty) * 0.3, 0, 1);
  ik(out, J.RHIP, J.RFT, J.RKN, THIGH * s, SHIN * s, 0.15 * hs + Math.sin(ty) * 0.3, 0, 1);
  // whole-body flip (rolls/somersaults) about the pelvis-ish center
  if (Math.abs(p.flip) > 1e-3) {
    const cyc = pelY * 0.7, c = Math.cos(p.flip), sn = Math.sin(p.flip);
    for (let i = 0; i < 16; i++) {
      const y = out[i * 3 + 1] - cyc, z = out[i * 3 + 2] - pelZ;
      out[i * 3 + 1] = cyc + y * c - z * sn;
      out[i * 3 + 2] = pelZ + y * sn + z * c;
    }
    if (weaponOut) {
      for (const o of [0, 3]) {
        const y = weaponOut[o + 1], z = weaponOut[o + 2];
        weaponOut[o + 1] = y * c - z * sn;
        weaponOut[o + 2] = y * sn + z * c;
      }
    }
  }
}

/** Transform local points to world (yaw about Y, then translate). */
export function toWorld(pts, n, x, y, z, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (let i = 0; i < n; i++) {
    const lx = pts[i * 3], lz = pts[i * 3 + 2];
    pts[i * 3] = x + lx * c + lz * s;
    pts[i * 3 + 1] += y;
    pts[i * 3 + 2] = z - lx * s + lz * c;
  }
}

export function rotDir(v, o, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const x = v[o], z = v[o + 2];
  v[o] = x * c + z * s;
  v[o + 2] = -x * s + z * c;
}

// ---------------------------------------------------------------- animator
export class HumanoidAnimator {
  constructor(size = 1, stance = STANCE.fists) {
    this.size = size;
    this.stance = stance;
    this.pose = makePose();
    this.loco = makePose();
    this.act = makePose();
    this.phase = 0;
    this.clip = null;
    this.clipT = 0;
    this.clipSpeed = 1;
    this.weight = 0;
    this.leanSpring = 0; this.leanVel = 0;
    this.sideSpring = 0; this.sideVel = 0;
    this.hitLean = 0; this.hitVel = 0;
    this.hitTwist = 0; this.hitTwistVel = 0;
    this.breath = Math.random() * 10;
    this.speedSm = 0;
    this.pts = new Float32Array(16 * 3);
    this.wdir = new Float32Array(6);
    this.local = new Float32Array(16 * 3);
    this.localW = new Float32Array(6);
    this.heldSpin = 0;
    this.drawnFrame = -1;
    this.style = 'normal'; // normal | shamble | float | brute
    this.lookYaw = 0;
  }

  play(clip, speed = 1) {
    this.clip = clip;
    this.clipT = 0;
    this.clipSpeed = speed;
  }

  get playing() { return !!this.clip; }
  get progress() { return this.clip ? this.clipT : 1; }

  hitReact(strength = 1, dirSide = 0) {
    this.hitVel -= 7 * strength;
    this.hitTwistVel += dirSide * 6 * strength;
  }

  /**
   * ctx: {fwdSpeed, sideSpeed, accF, accS, combat (0..1), x,y,z,yaw, ground(x,z)}
   */
  update(dt, ctx) {
    const st = this.stance;
    const L = this.loco;
    const speed = Math.hypot(ctx.fwdSpeed, ctx.sideSpeed);
    this.speedSm += (speed - this.speedSm) * Math.min(1, dt * 10);
    const sp = this.speedSm / this.size;
    const run = clamp(sp / 7, 0, 1.3);
    const stride = 0.42 + run * 0.28;
    this.phase += (sp / (stride * Math.PI)) * Math.PI * dt * (this.style === 'shamble' ? 0.8 : 1);
    if (sp < 0.15) this.phase += (Math.round(this.phase / Math.PI) * Math.PI - this.phase) * Math.min(1, dt * 6);
    const ph = this.phase;
    this.breath += dt;
    const br = Math.sin(this.breath * 2.1) * 0.025;

    // base: stance blended toward relaxed when moving fast
    copyPose(L, st);
    const moveW = clamp(sp / 2.5, 0, 1);
    // direction of travel in local space
    const dirX = speed > 0.01 ? ctx.sideSpeed / speed : 0, dirZ = speed > 0.01 ? ctx.fwdSpeed / speed : 1;
    const sinP = Math.sin(ph), cosP = Math.cos(ph);
    const lift = (0.12 + run * 0.16) * moveW;
    const lfStep = sinP * stride * moveW, rfStep = -sinP * stride * moveW;
    const lfLift = Math.max(0, cosP) * lift, rfLift = Math.max(0, -cosP) * lift;
    L.lfx = lerp(st.lfx, 0, moveW) + dirX * lfStep;
    L.lfz = lerp(st.lfz, 0, moveW) + dirZ * lfStep;
    L.lfy = st.lfy + lfLift;
    L.rfx = lerp(st.rfx, 0, moveW) + dirX * rfStep;
    L.rfz = lerp(st.rfz, 0, moveW) + dirZ * rfStep;
    L.rfy = st.rfy + rfLift;
    L.py = st.py - Math.abs(sinP) * 0.03 * moveW - run * 0.06 * moveW + (moveW < 0.5 ? br * 0.5 : 0) + Math.abs(cosP) * 0.04 * run;
    L.lean = st.lean + run * 0.28 * dirZ + br;
    L.twist = st.twist * (1 - moveW) + sinP * 0.18 * moveW;
    L.hipYaw = -sinP * 0.12 * moveW;
    // arm swing (counter to legs) when not in a guard
    const swing = 0.55 * moveW * (0.6 + run * 0.6);
    if (ctx.combat < 0.5 || run > 0.9) {
      L.lp = lerp(st.lp, -sinP * swing + 0.2, moveW * 0.85);
      L.rp = lerp(st.rp, sinP * swing + 0.2, moveW * 0.85);
      L.le = lerp(st.le, 0.5 + run * 0.9, moveW * 0.85);
      L.re = lerp(st.re, 0.5 + run * 0.9, moveW * 0.85);
    } else {
      L.lp += -sinP * 0.15 * moveW;
      L.rp += sinP * 0.15 * moveW;
    }
    if (this.style === 'shamble') {
      L.lp = 1.25 + Math.sin(this.breath * 3.1) * 0.15; L.rp = 1.1 + Math.sin(this.breath * 2.7 + 1) * 0.2;
      L.le = 0.15; L.re = 0.25; L.lo = 0.1; L.ro = 0.15;
      L.lean = 0.35 + Math.sin(ph * 0.5) * 0.1; L.side = Math.sin(ph) * 0.2; L.headP = 0.3; L.headY = Math.sin(this.breath * 1.3) * 0.4;
      L.py -= 0.08;
    } else if (this.style === 'float') {
      L.lfy = 0.25 + Math.sin(this.breath * 2) * 0.05; L.rfy = 0.2 + Math.sin(this.breath * 2 + 1) * 0.05;
      L.lfz = -0.15; L.rfz = -0.2;
      L.py = 0.35 + Math.sin(this.breath * 1.6) * 0.08;
      L.lp = 0.2; L.rp = 0.2; L.lo = 0.5 + Math.sin(this.breath) * 0.1; L.ro = 0.5; L.le = 0.1; L.re = 0.1;
      L.headP = 0.5; L.lean = 0.1;
    } else if (this.style === 'brute') {
      L.lean += 0.35; L.py -= 0.1; L.headP = -0.3; L.lo = 0.35; L.ro = 0.3; L.lp += 0.2;
    }

    // springs: lean into acceleration, side lean on turns, hit reactions
    const k = 90, damp = 12;
    const targetLean = clamp((ctx.accF || 0) * 0.025, -0.35, 0.35);
    const targetSide = clamp(-(ctx.accS || 0) * 0.02, -0.3, 0.3);
    this.leanVel += ((targetLean - this.leanSpring) * k - this.leanVel * damp) * dt;
    this.leanSpring += this.leanVel * dt;
    this.sideVel += ((targetSide - this.sideSpring) * k - this.sideVel * damp) * dt;
    this.sideSpring += this.sideVel * dt;
    this.hitVel += (-this.hitLean * 160 - this.hitVel * 14) * dt;
    this.hitLean += this.hitVel * dt;
    this.hitTwistVel += (-this.hitTwist * 140 - this.hitTwistVel * 12) * dt;
    this.hitTwist += this.hitTwistVel * dt;

    // action clip
    let target = L;
    if (this.clip) {
      this.clipT += (dt * this.clipSpeed) / this.clip.dur;
      if (this.clipT >= 1) {
        this.clip = null;
      } else {
        sampleClip(this.act, this.clip, st, this.clipT);
        if (!this.clip.full) {
          // keep locomotion legs when moving during upper-body actions
          const legKeep = moveW * 0.6;
          this.act.lfx = lerp(this.act.lfx, L.lfx, legKeep); this.act.lfy = lerp(this.act.lfy, L.lfy, legKeep); this.act.lfz = lerp(this.act.lfz, L.lfz, legKeep);
          this.act.rfx = lerp(this.act.rfx, L.rfx, legKeep); this.act.rfy = lerp(this.act.rfy, L.rfy, legKeep); this.act.rfz = lerp(this.act.rfz, L.rfz, legKeep);
        }
        target = this.act;
      }
    }
    const wantW = this.clip ? 1 : 0;
    this.weight += (wantW - this.weight) * Math.min(1, dt * (this.clip ? 40 : 14));
    const P = this.pose;
    if (this.clip) copyPose(P, this.act);
    else blendPose(P, L, this.act, this.weight);
    P.lean += this.leanSpring + this.hitLean;
    P.side += this.sideSpring;
    P.twist += this.hitTwist;
    P.headY += clamp(this.lookYaw, -0.8, 0.8);

    // terrain-aware feet: sample ground under each foot
    if (ctx.ground) {
      const c = Math.cos(ctx.yaw + P.spin), s = Math.sin(ctx.yaw + P.spin);
      const sz = this.size;
      const lx = (0.13 + P.lfx) * sz, lz = P.lfz * sz, rx = (-0.13 + P.rfx) * sz, rz = P.rfz * sz;
      const gl = ctx.ground(ctx.x + lx * c + lz * s, ctx.z - lx * s + lz * c) - ctx.y;
      const gr = ctx.ground(ctx.x + rx * c + rz * s, ctx.z - rx * s + rz * c) - ctx.y;
      const cl = clamp(gl, -0.5, 0.5) / sz, cr = clamp(gr, -0.5, 0.5) / sz;
      P.lfy += cl; P.rfy += cr;
      P.py += Math.min(0, cl, cr) * 0.9;
    }
    // limited animation: the pose is only re-drawn on the shared drawing clock, the body still moves smoothly
    if (this.drawnFrame !== ANIM.frame) {
      this.drawnFrame = ANIM.frame;
      solveHumanoid(P, this.local, this.size, this.localW);
      this.heldSpin = P.spin;
    }
    this.pts.set(this.local);
    this.wdir.set(this.localW);
    toWorld(this.pts, 16, ctx.x, ctx.y, ctx.z, ctx.yaw + this.heldSpin);
    rotDir(this.wdir, 0, ctx.yaw + this.heldSpin);
    rotDir(this.wdir, 3, ctx.yaw + this.heldSpin);
  }
}
