// Anatomy: turns the 16-joint stickman pose into a fuller skeleton (curved 3-segment spine, clavicles,
// lagging head, wrists + hand tips with follow-through, thumbs, heels and rolling toes) and skins it with
// anime-proportioned body volumes, faces, hair and cloth. Secondary motion (spine sway, hand drag, hair,
// coat tails, robe tatters) runs on springs and Verlet chains for overlapping, fluid movement.
// Everything is generated in code — no external models or textures.
import { PRIM } from '../gfx/renderer.js';
import { J } from './humanoid.js';

// ------------------------------------------------------------------ small vector helpers
const v = (x = 0, y = 0, z = 0) => [x, y, z];
const P = (pts, i) => [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const mad = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1e-6; return [a[0] / l, a[1] / l, a[2] / l]; };
const UP = [0, 1, 0];

// ------------------------------------------------------------------ body designs
// Radii are for a size-1 (≈1.8 m) body; colours are [r,g,b]. `eyes`: anime | slit | none.
export const BODIES = {
  hero: {
    skin: [0.95, 0.86, 0.8], top: [0.17, 0.15, 0.3], top2: [0.3, 0.26, 0.5], bottom: [0.12, 0.1, 0.15], boots: [0.24, 0.15, 0.13],
    hair: [0.9, 0.9, 0.97], eyeWhite: [0.98, 0.97, 0.95], eyes: 'anime', hairStyle: 'spiky', tails: 3, tailLen: 6, robe: false,
    limb: 1, bulk: 1, head: 1.05, chest: [0.19, 0.17, 0.12], gloves: [0.2, 0.17, 0.2],
  },
  husk: {
    skin: [0.42, 0.4, 0.42], top: [0.2, 0.17, 0.17], top2: [0.33, 0.28, 0.24], bottom: [0.2, 0.17, 0.17], boots: [0.35, 0.33, 0.33],
    hair: null, eyeWhite: [0.05, 0.03, 0.05], eyes: 'slit', hairStyle: 'none', tails: 2, tailLen: 5, robe: false,
    limb: 0.7, bulk: 0.78, head: 0.95, chest: [0.15, 0.15, 0.1], gloves: null, wraps: true,
  },
  brute: {
    skin: [0.4, 0.3, 0.28], top: [0.28, 0.22, 0.2], top2: [0.82, 0.76, 0.66], bottom: [0.2, 0.15, 0.14], boots: [0.16, 0.12, 0.11],
    hair: null, eyeWhite: [0.05, 0.02, 0.02], eyes: 'slit', hairStyle: 'none', tails: 2, tailLen: 4, robe: false,
    limb: 1.6, bulk: 1.7, head: 0.8, chest: [0.27, 0.22, 0.18], gloves: [0.16, 0.12, 0.11], pads: true,
  },
  choir: {
    skin: [0.86, 0.84, 0.78], top: [0.82, 0.8, 0.74], top2: [0.6, 0.55, 0.62], bottom: [0.75, 0.72, 0.66], boots: [0.75, 0.72, 0.66],
    hair: null, eyeWhite: [0.05, 0.03, 0.05], eyes: 'none', hairStyle: 'hood', tails: 4, tailLen: 6, robe: true,
    limb: 0.65, bulk: 0.8, head: 0.9, chest: [0.15, 0.15, 0.1], gloves: null,
  },
  shepherd: {
    skin: [0.45, 0.38, 0.33], top: [0.14, 0.11, 0.12], top2: [0.3, 0.22, 0.2], bottom: [0.14, 0.11, 0.12], boots: [0.3, 0.24, 0.2],
    hair: null, eyeWhite: [0.02, 0, 0.02], eyes: 'none', hairStyle: 'none', tails: 5, tailLen: 7, robe: true,
    limb: 0.8, bulk: 0.95, head: 0.9, chest: [0.17, 0.16, 0.11], gloves: null,
  },
};

/**
 * Casts: per-pack redesigns layered over BODIES. Requiem is the base set above.
 * Black Sutra — ink-and-paper ronin world: ponytailed swordswoman in a white gi and red sash, talisman ghouls,
 *               a red oni brute (red survives the manga monochrome), shrine-maiden choristers.
 * Paper Lantern — storybook puppets: big-headed, button-eyed, cloaked lantern bearer, burlap rag dolls,
 *               a round stitched ogre, paper-lantern ghosts.
 */
export const CASTS = {
  requiem: {},
  sutra: {
    hero: { skin: [0.96, 0.9, 0.86], top: [0.93, 0.91, 0.87], top2: [0.82, 0.08, 0.1], bottom: [0.08, 0.07, 0.09], boots: [0.1, 0.09, 0.1],
      hair: [0.06, 0.05, 0.07], hairStyle: 'ponytail', eyeColFixed: [0.9, 0.1, 0.12], tails: 2, tailLen: 7, tailCol: [0.82, 0.08, 0.1], gloves: [0.93, 0.91, 0.87], chest: [0.17, 0.16, 0.11] },
    husk: { skin: [0.9, 0.88, 0.82], top: [0.08, 0.07, 0.08], top2: [0.92, 0.9, 0.84], eyes: 'slit', eyeColFixed: [0.85, 0.08, 0.1] },
    brute: { skin: [0.72, 0.12, 0.1], top: [0.1, 0.08, 0.08], top2: [0.92, 0.88, 0.8], horns: true, eyeColFixed: [1, 0.85, 0.2] },
    choir: { top: [0.95, 0.94, 0.9], top2: [0.78, 0.06, 0.1], bottom: [0.78, 0.06, 0.1], tailCol: [0.78, 0.06, 0.1] },
    shepherd: { skin: [0.12, 0.1, 0.1], top: [0.92, 0.9, 0.84], top2: [0.08, 0.07, 0.08], tailCol: [0.08, 0.07, 0.08] },
  },
  lantern: {
    hero: { skin: [0.98, 0.87, 0.74], top: [0.8, 0.33, 0.16], top2: [1, 0.8, 0.32], bottom: [0.36, 0.24, 0.18], boots: [0.25, 0.16, 0.12],
      hair: null, hairStyle: 'hood', eyes: 'dot', head: 1.45, limb: 0.9, chest: [0.17, 0.15, 0.13], tails: 2, tailLen: 5, gloves: [0.36, 0.24, 0.18] },
    husk: { skin: [0.7, 0.58, 0.42], top: [0.42, 0.33, 0.25], top2: [0.85, 0.75, 0.55], eyes: 'dot', head: 1.25, limb: 0.85 },
    brute: { skin: [0.55, 0.62, 0.42], top: [0.45, 0.3, 0.2], top2: [0.86, 0.8, 0.6], eyes: 'dot', head: 1.0, bulk: 2.0, chest: [0.32, 0.28, 0.26] },
    choir: { top: [1, 0.9, 0.6], top2: [0.9, 0.35, 0.18], bottom: [1, 0.9, 0.6], eyes: 'dot', head: 1.2, hairStyle: 'none' },
    shepherd: { skin: [0.5, 0.4, 0.3], top: [0.3, 0.22, 0.32], top2: [1, 0.8, 0.32], eyes: 'dot', head: 1.15 },
  },
};

const castCache = new Map();
/** Body design for a character id in a cast (falls back to the base BODIES design). */
export function castBody(cast, id) {
  const key = (cast || 'requiem') + ':' + id;
  if (!castCache.has(key)) {
    const base = BODIES[id];
    if (!base) return null;
    castCache.set(key, { ...base, ...((CASTS[cast] || {})[id] || {}), cast: cast || 'requiem', id });
  }
  return castCache.get(key);
}

// ------------------------------------------------------------------ verlet cloth/hair strand
class Strand {
  constructor(n, seg) {
    this.n = n;
    this.seg = seg;
    this.p = Array.from({ length: n }, () => v());
    this.q = Array.from({ length: n }, () => v());
    this.ready = false;
  }

  update(dt, anchor, hang, ground, drag = 0.93, push = null) {
    const p = this.p, q = this.q;
    if (!this.ready) {
      for (let i = 0; i < this.n; i++) { p[i] = mad(anchor, hang, this.seg * i); q[i] = p[i].slice(); }
      this.ready = true;
    }
    const h = Math.min(dt, 1 / 30);
    p[0] = anchor.slice();
    for (let i = 1; i < this.n; i++) {
      const vel = mul(sub(p[i], q[i]), drag);
      q[i] = p[i].slice();
      // gravity + a gentle bias along the hang direction keeps cloth draped sensibly
      p[i] = add(add(p[i], vel), mad([0, -9 * h * h, 0], hang, 3 * h * h));
      if (push) {
        // keep strands out of the body core (a vertical capsule through the torso)
        const d = sub(p[i], push.c);
        d[1] = 0;
        const l = len(d);
        if (l < push.r && l > 1e-4) p[i] = mad(p[i], d, (push.r - l) / l);
      }
      const g = ground(p[i][0], p[i][2]) + 0.03;
      if (p[i][1] < g) p[i][1] = g;
    }
    for (let it = 0; it < 3; it++) {
      for (let i = 1; i < this.n; i++) {
        const a = p[i - 1], b = p[i];
        const d = sub(b, a);
        const l = len(d) || 1e-5;
        const k = (l - this.seg) / l;
        if (i === 1) p[i] = mad(b, d, -k);
        else { p[i - 1] = mad(a, d, k * 0.5); p[i] = mad(b, d, -k * 0.5); }
      }
      p[0] = anchor.slice();
    }
  }
}

// ------------------------------------------------------------------ skeleton expansion
/** Derive the full skeleton (world space) from the 16 solved joints. `st` adds spring offsets when present. */
export function expandSkeleton(pts, s, st = null) {
  const sk = {};
  for (const [k, i] of Object.entries(J)) sk[k] = P(pts, i);
  const T = norm(sub(sk.CHEST, sk.PELVIS));
  let Rs = norm(sub(sk.RSH, sk.LSH));
  const Ft = norm(cross(T, Rs));
  Rs = cross(Ft, T);
  const Rh = norm(sub(sk.RHIP, sk.LHIP));
  const Fh = norm(cross(UP, Rh));
  sk.T = T; sk.Rs = Rs; sk.Ft = Ft; sk.Rh = Rh; sk.Fh = Fh;
  const sway = st ? st.spine : v();
  // three-segment spine with a slight S-curve and follow-through sway on the upper segments
  sk.LUMBAR = add(mad(lerp3(sk.PELVIS, sk.CHEST, 0.33), Ft, 0.022 * s), mul(sway, 0.45));
  sk.THORAX = add(mad(lerp3(sk.PELVIS, sk.CHEST, 0.68), Ft, -0.012 * s), mul(sway, 0.85));
  sk.CHEST = add(sk.CHEST, sway);
  sk.LCLAV = mad(lerp3(sk.CHEST, sk.LSH, 0.3), T, 0.02 * s);
  sk.RCLAV = mad(lerp3(sk.CHEST, sk.RSH, 0.3), T, 0.02 * s);
  // head lags fast turns slightly, then catches up
  const hl = st ? st.head : v();
  sk.HEAD = add(sk.HEAD, hl);
  const hUp = norm(sub(sk.HEAD, sk.NECK));
  const hF = norm(sub(Ft, mul(hUp, dot(Ft, hUp))));
  sk.hUp = hUp; sk.hF = hF; sk.hR = cross(hF, hUp);
  // hands: wrist + hand tip that drags behind the forearm (follow-through)
  for (const side of ['L', 'R']) {
    const el = sk[side + 'EL'], wr = sk[side + 'HA'];
    const fore = norm(sub(wr, el));
    const dir = st ? norm(st['hand' + side]) : fore;
    sk[side + 'WRIST'] = wr;
    sk[side + 'TIP'] = mad(wr, dir, 0.11 * s);
    sk[side + 'THUMB'] = mad(mad(wr, dir, 0.04 * s), Ft, 0.035 * s);
  }
  return sk;
}

/** Feet need the ground: heel and a toe that rolls down when the foot lifts. */
function feet(sk, s, ground) {
  for (const side of ['L', 'R']) {
    const a = sk[side + 'FT'];
    const lift = Math.max(0, Math.min(1, (a[1] - ground(a[0], a[2]) - 0.06 * s) / (0.18 * s)));
    const roll = lift * 0.7;
    const f = sk.Fh;
    const dir = norm([f[0] * Math.cos(roll), -Math.sin(roll), f[2] * Math.cos(roll)]);
    sk[side + 'ANKLE'] = a;
    sk[side + 'TOE'] = mad(a, dir, 0.17 * s);
    sk[side + 'HEEL'] = mad(a, f, -0.05 * s);
  }
}

export const SKELETON_BONES = [
  ['PELVIS', 'LUMBAR'], ['LUMBAR', 'THORAX'], ['THORAX', 'CHEST'], ['CHEST', 'NECK'], ['NECK', 'HEAD'],
  ['CHEST', 'LCLAV'], ['LCLAV', 'LSH'], ['LSH', 'LEL'], ['LEL', 'LWRIST'], ['LWRIST', 'LTIP'], ['LWRIST', 'LTHUMB'],
  ['CHEST', 'RCLAV'], ['RCLAV', 'RSH'], ['RSH', 'REL'], ['REL', 'RWRIST'], ['RWRIST', 'RTIP'], ['RWRIST', 'RTHUMB'],
  ['PELVIS', 'LHIP'], ['LHIP', 'LKN'], ['LKN', 'LANKLE'], ['LANKLE', 'LTOE'], ['LANKLE', 'LHEEL'],
  ['PELVIS', 'RHIP'], ['RHIP', 'RKN'], ['RKN', 'RANKLE'], ['RANKLE', 'RTOE'], ['RANKLE', 'RHEEL'],
];

// ------------------------------------------------------------------ per-character secondary motion
export class Anatomy {
  constructor(body, size = 1) {
    this.body = body;
    this.size = size;
    this.spine = v(); this.spineVel = v();
    this.head = v(); this.headVel = v();
    this.handL = v(0, -1, 0); this.handR = v(0, -1, 0);
    this.prevChest = null; this.prevChestVel = v();
    this.prevHead = null;
    const s = size;
    this.tails = Array.from({ length: body.tails }, () => new Strand(body.tailLen, (body.robe ? 0.16 : 0.12) * s));
    this.hair = body.hairStyle === 'spiky' ? [new Strand(5, 0.07 * s), new Strand(5, 0.07 * s), new Strand(6, 0.075 * s)]
      : body.hairStyle === 'ponytail' ? [new Strand(9, 0.075 * s)] : [];
  }

  update(dt, pts, ground) {
    if (dt <= 0) return;
    const s = this.size;
    const C = P(pts, J.CHEST), H = P(pts, J.HEAD);
    // spine sway: the upper body trails behind the chest's acceleration (overlapping action)
    if (this.prevChest) {
      const vel = mul(sub(C, this.prevChest), 1 / dt);
      const acc = mul(sub(vel, this.prevChestVel), 1 / dt);
      this.prevChestVel = vel;
      const target = mul(acc, -0.0016 * s);
      const tl = len(target);
      const tgt = tl > 0.07 * s ? mul(target, (0.07 * s) / tl) : target;
      this.spineVel = add(mul(this.spineVel, Math.exp(-dt * 11)), mul(sub(tgt, this.spine), dt * 140));
      this.spine = mad(this.spine, this.spineVel, dt);
      // head drag
      const hv = mul(sub(H, this.prevHead), 1 / dt);
      const htgt = mul(hv, -0.004 * s);
      const hl = len(htgt);
      const ht = hl > 0.05 * s ? mul(htgt, (0.05 * s) / hl) : htgt;
      this.headVel = add(mul(this.headVel, Math.exp(-dt * 12)), mul(sub(ht, this.head), dt * 160));
      this.head = mad(this.head, this.headVel, dt);
    }
    this.prevChest = C;
    this.prevHead = H;
    // hands drag behind the forearm direction then snap through (wrist follow-through)
    for (const side of ['L', 'R']) {
      const el = P(pts, side === 'L' ? J.LEL : J.REL), wr = P(pts, side === 'L' ? J.LHA : J.RHA);
      const fore = norm(sub(wr, el));
      const key = 'hand' + side;
      this[key] = norm(lerp3(this[key], fore, Math.min(1, dt * 16)));
    }
    const sk = expandSkeleton(pts, s, this);
    // cloth: coat tails / robe tatters hang from the lower back and swing with the hips
    const n = this.tails.length;
    for (let i = 0; i < n; i++) {
      const k = n === 1 ? 0 : i / (n - 1) - 0.5;
      const back = this.body.robe ? 0.02 : 0.11;
      const anchor = mad(mad(sk.LUMBAR, sk.Rh, k * (this.body.robe ? 0.34 : 0.2) * s), sk.Fh, -back * s * this.body.bulk);
      const hang = norm(mad(mad([0, -1, 0], sk.Fh, -0.45), sk.Rh, k * 0.6));
      this.tails[i].update(dt, anchor, hang, ground, 0.92, { c: sk.PELVIS, r: 0.13 * s * this.body.bulk });
    }
    // long anime hair strands from the back of the head
    const single = this.hair.length === 1;
    this.hair.forEach((h, i) => {
      const side = single ? 0 : i - 1;
      const anchor = mad(mad(mad(sk.HEAD, sk.hF, -0.12 * s), sk.hR, side * 0.07 * s), sk.hUp, (single ? 0.12 : 0.02) * s);
      h.update(dt, anchor, norm(mad(mad([0, -1, 0], sk.hF, -0.8), sk.hR, side * 0.4)), ground, 0.9);
    });
  }
}

// ------------------------------------------------------------------ drawing
const tmpX = v(), tmpY = v(), tmpZ = v();
function ell(R, kind, c, ux, uy, uz, rx, ry, rz, col, e) {
  for (let k = 0; k < 3; k++) { tmpX[k] = ux[k] * rx; tmpY[k] = uy[k] * ry; tmpZ[k] = uz[k] * rz; }
  R.basis(kind, c[0], c[1], c[2], tmpX, tmpY, tmpZ, col, e);
}
function bone(R, a, b, r, col, e = 0, ext = 0.22) {
  const d = sub(b, a);
  const A = mad(a, d, -ext * 0.5), B = mad(b, d, ext * 0.5);
  R.segPrim(PRIM.ORB, A[0], A[1], A[2], B[0], B[1], B[2], r, col, e);
}
function shade(c, f) { return f > 0 ? [c[0] + (1 - c[0]) * f, c[1] + (1 - c[1]) * f, c[2] + (1 - c[2]) * f] : c; }

/**
 * Draw a skinned character. `st` (Anatomy) supplies springs + cloth; pass null for a static pose (ragdolls).
 * eyeCol tints anime irises / slit eyes. lod 0 = full detail, 1 = body volumes only.
 */
export function drawBody(R, body, pts, st, s, ground, opts = {}) {
  const flash = opts.flash || 0;
  const eyeCol = body.eyeColFixed || opts.eyeCol || [1, 0.3, 0.2];
  const lod = opts.lod || 0;
  const sk = expandSkeleton(pts, s, st);
  feet(sk, s, ground);
  const B = body, L = B.limb, K = B.bulk;
  const skin = shade(B.skin, flash), top = shade(B.top, flash), top2 = shade(B.top2, flash);
  const bottom = shade(B.bottom, flash), boots = shade(B.boots, flash);
  const glove = B.gloves ? shade(B.gloves, flash) : skin;

  // ---- torso: hips, waist, ribcage as oriented ellipsoids following the curved spine
  ell(R, PRIM.ORB, lerp3(sk.PELVIS, sk.LUMBAR, 0.25), sk.Rh, sk.T, sk.Fh, 0.165 * s * K, 0.13 * s * K, 0.12 * s * K, B.robe ? top : bottom, 0);
  ell(R, PRIM.ORB, sk.LUMBAR, sk.Rs, norm(sub(sk.THORAX, sk.PELVIS)), sk.Ft, 0.135 * s * K, 0.12 * s, 0.1 * s * K, top, 0);
  const chestC = mad(lerp3(sk.THORAX, sk.CHEST, 0.55), sk.T, 0.02 * s);
  ell(R, PRIM.ORB, chestC, sk.Rs, norm(sub(sk.CHEST, sk.LUMBAR)), sk.Ft, B.chest[0] * s * K, B.chest[1] * s, B.chest[2] * s * K, top, 0);
  if (B.wraps) for (let i = 0; i < 3; i++) ell(R, PRIM.ORB, lerp3(sk.LUMBAR, sk.CHEST, 0.15 + i * 0.32), sk.Rs, sk.T, sk.Ft, 0.15 * s * K, 0.022 * s, 0.11 * s * K, top2, 0);
  else ell(R, PRIM.ORB, mad(sk.LUMBAR, sk.T, -0.03 * s), sk.Rs, sk.T, sk.Ft, 0.142 * s * K, 0.025 * s, 0.107 * s * K, top2, 0); // belt
  // clavicles + shoulder caps
  bone(R, sk.CHEST, sk.LSH, 0.045 * s * K, top);
  bone(R, sk.CHEST, sk.RSH, 0.045 * s * K, top);
  for (const sh of [sk.LSH, sk.RSH]) {
    if (B.pads) ell(R, PRIM.SPHERE, mad(sh, sk.T, 0.04 * s), sk.Rs, sk.T, sk.Ft, 0.13 * s, 0.08 * s, 0.12 * s, top2, 0);
    else R.ball(sh[0], sh[1], sh[2], 0.06 * s * L, top, 0, true);
  }

  // ---- neck + head
  bone(R, mad(sk.NECK, sk.hUp, -0.04 * s), mad(sk.HEAD, sk.hUp, -0.1 * s), 0.042 * s * Math.sqrt(K), skin);
  const hs = B.head * s;
  ell(R, PRIM.ORB, sk.HEAD, sk.hR, sk.hUp, sk.hF, 0.135 * hs, 0.155 * hs, 0.145 * hs, skin, 0);
  // tapered anime jaw
  ell(R, PRIM.ORB, mad(mad(sk.HEAD, sk.hUp, -0.075 * hs), sk.hF, 0.035 * hs), sk.hR, sk.hUp, sk.hF, 0.095 * hs, 0.085 * hs, 0.105 * hs, skin, 0);
  if (lod === 0) {
    // eyes
    if (B.eyes === 'anime') {
      for (const side of [-1, 1]) {
        const ec = mad(mad(mad(sk.HEAD, sk.hF, 0.128 * hs), sk.hR, side * 0.056 * hs), sk.hUp, -0.005 * hs);
        ell(R, PRIM.ORB, ec, sk.hR, sk.hUp, sk.hF, 0.033 * hs, 0.044 * hs, 0.016 * hs, B.eyeWhite, 0.4);
        const ic = mad(mad(ec, sk.hF, 0.007 * hs), sk.hR, side * 0.004 * hs);
        ell(R, PRIM.ORB, ic, sk.hR, sk.hUp, sk.hF, 0.022 * hs, 0.034 * hs, 0.014 * hs, eyeCol, 1.1);
        const hl = mad(mad(mad(ic, sk.hF, 0.008 * hs), sk.hUp, 0.016 * hs), sk.hR, -side * 0.008 * hs);
        ell(R, PRIM.ORB, hl, sk.hR, sk.hUp, sk.hF, 0.008 * hs, 0.01 * hs, 0.006 * hs, [1, 1, 1], 2);
        // brow line
        const bc = mad(mad(ec, sk.hUp, 0.056 * hs), sk.hF, 0.004 * hs);
        ell(R, PRIM.ORB, bc, sk.hR, sk.hUp, sk.hF, 0.03 * hs, 0.006 * hs, 0.01 * hs, [0.2, 0.18, 0.22], 0);
      }
    } else if (B.eyes === 'dot') {
      // storybook button eyes
      for (const side of [-1, 1]) {
        const ec = mad(mad(mad(sk.HEAD, sk.hF, 0.135 * hs), sk.hR, side * 0.062 * hs), sk.hUp, -0.01 * hs);
        ell(R, PRIM.ORB, ec, sk.hR, sk.hUp, sk.hF, 0.03 * hs, 0.034 * hs, 0.014 * hs, [0.06, 0.04, 0.05], 0);
        const hl = mad(mad(mad(ec, sk.hF, 0.01 * hs), sk.hUp, 0.012 * hs), sk.hR, -side * 0.01 * hs);
        ell(R, PRIM.ORB, hl, sk.hR, sk.hUp, sk.hF, 0.008 * hs, 0.009 * hs, 0.005 * hs, [1, 1, 1], 2);
        // rosy cheeks
        const ch = mad(mad(ec, sk.hUp, -0.045 * hs), sk.hR, side * 0.012 * hs);
        ell(R, PRIM.ORB, ch, sk.hR, sk.hUp, sk.hF, 0.024 * hs, 0.012 * hs, 0.008 * hs, [0.95, 0.5, 0.45], 0.2);
      }
    } else if (B.eyes === 'slit') {
      for (const side of [-1, 1]) {
        const ec = mad(mad(sk.HEAD, sk.hF, 0.14 * hs), sk.hR, side * 0.05 * hs);
        ell(R, PRIM.ORB, ec, sk.hR, sk.hUp, sk.hF, 0.03 * hs, 0.008 * hs, 0.01 * hs, eyeCol, 2.5);
      }
    }
    // hair
    if (B.hairStyle === 'spiky') {
      const hair = shade(B.hair, flash);
      ell(R, PRIM.ORB, mad(mad(sk.HEAD, sk.hUp, 0.035 * hs), sk.hF, -0.03 * hs), sk.hR, sk.hUp, sk.hF, 0.15 * hs, 0.155 * hs, 0.15 * hs, hair, 0.05);
      const spikes = [[0, 1, -0.4], [0.6, 0.8, -0.5], [-0.6, 0.8, -0.5], [0.9, 0.3, -0.6], [-0.9, 0.3, -0.6], [0.3, 0.9, 0.3], [-0.35, 0.85, 0.35], [0, 0.5, -1]];
      for (const [x, y, z] of spikes) {
        const dir = norm(add(add(mul(sk.hR, x), mul(sk.hUp, y)), mul(sk.hF, z)));
        const base = mad(sk.HEAD, dir, 0.11 * hs);
        const tip = mad(base, dir, 0.16 * hs);
        R.segPrim(PRIM.CONE, base[0], base[1], base[2], tip[0], tip[1], tip[2], 0.055 * hs, hair, 0.05);
      }
      // bangs over the forehead
      for (const x of [-0.07, 0, 0.07]) {
        const base = mad(mad(mad(sk.HEAD, sk.hUp, 0.1 * hs), sk.hF, 0.09 * hs), sk.hR, x * hs);
        const tip = mad(mad(base, sk.hUp, -0.11 * hs), sk.hF, 0.05 * hs);
        R.segPrim(PRIM.CONE, base[0], base[1], base[2], tip[0], tip[1], tip[2], 0.04 * hs, hair, 0.05);
      }
      if (st) for (const h of st.hair) for (let i = 1; i < h.n; i++) {
        const a = h.p[i - 1], b = h.p[i];
        R.seg(a[0], a[1], a[2], b[0], b[1], b[2], 0.03 * s * (1 - i / h.n * 0.7), hair, 0.05);
      }
    } else if (B.hairStyle === 'ponytail') {
      const hair = shade(B.hair, flash);
      ell(R, PRIM.ORB, mad(mad(sk.HEAD, sk.hUp, 0.03 * hs), sk.hF, -0.03 * hs), sk.hR, sk.hUp, sk.hF, 0.148 * hs, 0.16 * hs, 0.15 * hs, hair, 0);
      const knot = mad(mad(sk.HEAD, sk.hF, -0.13 * hs), sk.hUp, 0.12 * hs);
      R.ball(knot[0], knot[1], knot[2], 0.05 * hs, B.tailCol || hair, 0, true);
      for (const x of [-0.08, -0.03, 0.03, 0.08]) {
        const base = mad(mad(mad(sk.HEAD, sk.hUp, 0.11 * hs), sk.hF, 0.085 * hs), sk.hR, x * hs);
        const tip = mad(mad(mad(base, sk.hUp, -0.13 * hs), sk.hF, 0.05 * hs), sk.hR, x * 0.6 * hs);
        R.segPrim(PRIM.CONE, base[0], base[1], base[2], tip[0], tip[1], tip[2], 0.035 * hs, hair, 0);
      }
      if (st) for (const h of st.hair) for (let i = 1; i < h.n; i++) {
        const a = h.p[i - 1], b = h.p[i];
        R.seg(a[0], a[1], a[2], b[0], b[1], b[2], 0.045 * s * (1 - (i / h.n) * 0.75), hair, 0);
      }
    } else if (B.hairStyle === 'hood') {
      ell(R, PRIM.ORB, mad(mad(sk.HEAD, sk.hUp, 0.02 * hs), sk.hF, -0.025 * hs), sk.hR, sk.hUp, sk.hF, 0.17 * hs, 0.19 * hs, 0.16 * hs, top, 0);
      const tip = mad(mad(sk.HEAD, sk.hUp, 0.25 * hs), sk.hF, -0.2 * hs);
      const base = mad(sk.HEAD, sk.hUp, 0.1 * hs);
      R.segPrim(PRIM.CONE, base[0], base[1], base[2], tip[0], tip[1], tip[2], 0.11 * hs, top, 0);
    }
  }

  if (B.horns && lod === 0) {
    for (const side of [-1, 1]) {
      const base = mad(mad(sk.HEAD, sk.hUp, 0.12 * hs), sk.hR, side * 0.08 * hs);
      const tip = mad(mad(base, sk.hUp, 0.2 * hs), sk.hR, side * 0.08 * hs);
      R.segPrim(PRIM.CONE, base[0], base[1], base[2], tip[0], tip[1], tip[2], 0.045 * hs, top2, 0);
    }
  }

  // ---- arms: sleeves, forearms, mitten hands with thumbs
  for (const side of ['L', 'R']) {
    const sh = sk[side + 'SH'], el = sk[side + 'EL'], wr = sk[side + 'WRIST'], tip = sk[side + 'TIP'];
    bone(R, sh, el, 0.058 * s * L, top);
    bone(R, el, wr, 0.047 * s * L, B.wraps ? top2 : top);
    R.ball(el[0], el[1], el[2], 0.05 * s * L, top, 0, true);
    if (!B.wraps) bone(R, mad(lerp3(el, wr, 0.82), sub(wr, el), 0), wr, 0.055 * s * L, top2, 0, 0.1); // cuff
    const hd = norm(sub(tip, wr));
    const hw = norm(cross(hd, sk.Ft));
    const hn = cross(hw, hd);
    ell(R, PRIM.ORB, lerp3(wr, tip, 0.55), hw, hd, hn, 0.042 * s * L, 0.06 * s, 0.026 * s * L, glove, 0);
    if (lod === 0) bone(R, wr, sk[side + 'THUMB'], 0.018 * s * L, glove);
  }

  // ---- legs: thighs, calves, boots with heel-to-toe feet
  for (const side of ['L', 'R']) {
    const hip = sk[side + 'HIP'], kn = sk[side + 'KN'], an = sk[side + 'ANKLE'];
    bone(R, hip, kn, 0.078 * s * L * (B.robe ? 0.8 : 1), bottom);
    R.ball(kn[0], kn[1], kn[2], 0.06 * s * L, bottom, 0, true);
    // calf bulge sits high on the shin
    const calf = mad(lerp3(kn, an, 0.32), sk.Fh, -0.015 * s);
    bone(R, kn, an, 0.056 * s * L, bottom);
    ell(R, PRIM.ORB, calf, sk.Rh, norm(sub(kn, an)), sk.Fh, 0.062 * s * L, 0.13 * s, 0.065 * s * L, bottom, 0);
    bone(R, mad(an, sub(kn, an), 0.32), an, 0.062 * s * L, boots, 0, 0.1);
    const toe = sk[side + 'TOE'], heel = sk[side + 'HEEL'];
    const fd = norm(sub(toe, heel));
    const fw = norm(cross(UP, fd));
    ell(R, PRIM.ORB, lerp3(heel, toe, 0.5), fw, cross(fd, fw), fd, 0.055 * s * L, 0.045 * s, len(sub(toe, heel)) * 0.55, boots, 0);
  }

  // ---- robe skirt
  if (B.robe) {
    const w = mad(sk.LUMBAR, sk.T, -0.05 * s);
    const g = ground(sk.PELVIS[0], sk.PELVIS[2]);
    const bottomC = [sk.PELVIS[0], Math.max(g + 0.05, sk.PELVIS[1] - 0.85 * s), sk.PELVIS[2]];
    R.segPrim(PRIM.CONE, bottomC[0], bottomC[1], bottomC[2], w[0], w[1], w[2], 0.36 * s * K, top, 0);
  }

  // ---- cloth strands (coat tails / tatters)
  if (st && lod === 0) {
    const col = B.tailCol ? shade(B.tailCol, flash) : B.robe ? top2 : top;
    for (const t of st.tails) {
      for (let i = 1; i < t.n; i++) {
        const a = t.p[i - 1], b = t.p[i];
        R.seg(a[0], a[1], a[2], b[0], b[1], b[2], 0.05 * s * (1 - (i / t.n) * 0.55), col, 0);
      }
    }
  }
  return sk;
}

/** Pencil-line view of the expanded skeleton (model sheet / debugging). */
export function drawSkeleton(R, pts, s, ground, st = null) {
  const sk = expandSkeleton(pts, s, st);
  feet(sk, s, ground);
  const blue = [0.2, 0.4, 0.85], red = [0.85, 0.15, 0.2];
  for (const [a, b] of SKELETON_BONES) {
    const A = sk[a], Bp = sk[b];
    R.seg(A[0], A[1], A[2], Bp[0], Bp[1], Bp[2], 0.012 * s, blue, 0.6);
  }
  const joints = new Set(SKELETON_BONES.flat());
  for (const k of joints) { const p = sk[k]; R.ball(p[0], p[1], p[2], 0.026 * s, red, 0.8, true); }
  if (st) for (const t of [...st.tails, ...st.hair]) for (let i = 1; i < t.n; i++) {
    const a = t.p[i - 1], b = t.p[i];
    R.seg(a[0], a[1], a[2], b[0], b[1], b[2], 0.008 * s, [0.2, 0.7, 0.4], 0.6);
    R.ball(b[0], b[1], b[2], 0.016 * s, [0.2, 0.7, 0.4], 0.6, true);
  }
  return joints.size;
}
