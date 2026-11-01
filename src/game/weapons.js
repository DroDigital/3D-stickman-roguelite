// Weapon archetypes, movesets and tier-scaled procedural models / VFX.
import { PRIM } from '../gfx/renderer.js';
import { RARITY } from './config.js';
import { STANCE } from './humanoid.js';
import { mixRgb } from '../core/math.js';

// per-move multipliers
export const MOVES = {
  jab: { dmg: 0.75, arc: 70, reach: 0.85, kb: 2, sfx: 'whoosh' },
  cross: { dmg: 1.0, arc: 70, reach: 0.9, kb: 3.5, sfx: 'whoosh' },
  hook: { dmg: 1.1, arc: 110, reach: 0.85, kb: 4, sfx: 'whoosh' },
  kick: { dmg: 1.3, arc: 80, reach: 1.05, kb: 8, sfx: 'heavyWhoosh' },
  spinKick: { dmg: 1.5, arc: 360, reach: 1.1, kb: 9, sfx: 'heavyWhoosh' },
  uppercut: { dmg: 1.8, arc: 80, reach: 0.9, kb: 6, launch: 7, sfx: 'heavyWhoosh' },
  slashR: { dmg: 1.0, arc: 140, reach: 1, kb: 3.5, sfx: 'whoosh' },
  slashL: { dmg: 1.0, arc: 140, reach: 1, kb: 3.5, sfx: 'whoosh' },
  thrust: { dmg: 1.25, arc: 40, reach: 1.25, kb: 5, sfx: 'whoosh' },
  spin: { dmg: 0.9, arc: 360, reach: 1.05, kb: 6, sfx: 'heavyWhoosh' },
  overhead: { dmg: 2.0, arc: 70, reach: 1.1, kb: 9, shock: 3, sfx: 'heavyWhoosh' },
  slam: { dmg: 2.4, arc: 360, reach: 1.0, kb: 11, shock: 5, sfx: 'heavyWhoosh' },
  reap: { dmg: 1.35, arc: 200, reach: 1.15, kb: 5, sfx: 'heavyWhoosh' },
  dualFlurry: { dmg: 0.7, arc: 130, reach: 0.95, kb: 2.5, sfx: 'whoosh' },
  dualCross: { dmg: 1.4, arc: 100, reach: 1, kb: 5, sfx: 'whoosh' },
  counter: { dmg: 2.2, arc: 120, reach: 1.1, kb: 10, sfx: 'heavyWhoosh' },
  finisher: { dmg: 4.5, arc: 360, reach: 1.4, kb: 14, shock: 7, sfx: 'heavyWhoosh' },
};

export const WEAPONS = {
  fists: {
    name: 'Bare Knuckles', desc: 'Fast strikes, kicks and uppercuts.', stance: STANCE.fists,
    light: ['jab', 'cross', 'hook', 'kick', 'spinKick'], heavy: 'uppercut',
    dmg: 10, speed: 1.25, reach: 1.9, tip: 0.1, base: 0, icon: '✊',
  },
  blade: {
    name: 'Crescent Blade', desc: 'Balanced sword. Sweeping slashes and a lunging thrust.', stance: STANCE.blade,
    light: ['slashR', 'slashL', 'thrust', 'slashR', 'spin'], heavy: 'overhead',
    dmg: 15, speed: 1.05, reach: 2.6, tip: 1.0, base: 0.15, icon: '🗡',
  },
  cleaver: {
    name: 'Greatcleaver', desc: 'Slow, enormous arcs that shatter crowds.', stance: STANCE.heavy,
    light: ['slashR', 'overhead', 'spin'], heavy: 'slam',
    dmg: 26, speed: 0.78, reach: 3.1, tip: 1.4, base: 0.2, icon: '⚔',
  },
  spear: {
    name: 'Voidspear', desc: 'Long reach thrusts that pierce through lines of foes.', stance: STANCE.spear,
    light: ['thrust', 'thrust', 'slashL', 'thrust', 'spin'], heavy: 'thrust',
    dmg: 16, speed: 1.0, reach: 3.5, tip: 1.6, base: 0.6, icon: '🔱', pierce: true,
  },
  dual: {
    name: 'Twin Fangs', desc: 'Blinding twin-dagger flurries. Highest attack speed.', stance: STANCE.dual,
    light: ['dualFlurry', 'dualFlurry', 'dualCross', 'dualFlurry', 'spin'], heavy: 'dualCross',
    dmg: 9, speed: 1.45, reach: 2.0, tip: 0.45, base: 0.05, icon: '⚚', dual: true,
  },
  maul: {
    name: 'Grave Maul', desc: 'Crushing slams that send shockwaves through the earth.', stance: STANCE.heavy,
    light: ['overhead', 'slashR', 'slam'], heavy: 'slam',
    dmg: 30, speed: 0.7, reach: 2.7, tip: 1.05, base: 0.8, icon: '⚒',
  },
  scythe: {
    name: 'Reaper Scythe', desc: 'Wide reaping arcs that drink the life of the slain.', stance: STANCE.heavy,
    light: ['reap', 'slashL', 'reap', 'spin'], heavy: 'reap',
    dmg: 19, speed: 0.92, reach: 3.2, tip: 1.2, base: 0.9, icon: '☾', leech: 0.02,
  },
};

export const WEAPON_IDS = Object.keys(WEAPONS).filter((k) => k !== 'fists');

// ------------------------------------------------------------------ models
// Part: [prim, au, av, aw, bu, bv, bw, radius, colorKey, emissive, flat]
function P(prim, a, b, r, col = 'metal', e = 0, flat = 1) { return [prim, a[0], a[1], a[2], b[0], b[1], b[2], r, col, e, flat]; }

function addTierDetails(parts, tier, tipU, baseU) {
  if (tier >= 2) {
    // rune studs along the weapon
    for (let i = 0; i < 3; i++) {
      const u = baseU + ((i + 1) / 4) * (tipU - baseU);
      parts.push(P(PRIM.OCTA, [u - 0.03, 0, 0], [u + 0.03, 0, 0], 0.035, 'glow', 1.6));
    }
  }
  if (tier >= 4) {
    // crown of horns at the guard
    for (const s of [-1, 1]) {
      parts.push(P(PRIM.CONE, [baseU, s * 0.08, 0], [baseU + 0.22, s * 0.2, 0.05], 0.03, 'dark', 0));
    }
  }
  if (tier >= 5) {
    // the eye
    parts.push(P(PRIM.ORB, [baseU - 0.05, 0, 0.05], [baseU + 0.07, 0, 0.05], 0.07, 'eye', 0.2));
    parts.push(P(PRIM.ORB, [baseU - 0.0, 0, 0.11], [baseU + 0.02, 0, 0.11], 0.03, 'glow', 3));
  }
}

const builders = {
  fists(t) {
    const p = [P(PRIM.SPHERE, [-0.02, 0, 0], [0.1, 0, 0], 0.075, 'metal', t >= 3 ? 0.4 : 0)];
    if (t >= 1) p.push(P(PRIM.CONE, [0.06, 0, 0.04], [0.16, 0, 0.09], 0.025, 'metal'));
    if (t >= 2) p.push(P(PRIM.CONE, [0.06, 0.04, 0.03], [0.15, 0.06, 0.1], 0.02, 'glow', 1));
    if (t >= 3) for (const s of [-1, 0, 1]) p.push(P(PRIM.OCTA, [0.08, s * 0.035, 0], [0.38 + (t - 3) * 0.08, s * 0.08, 0.02], 0.025, 'glow', 2));
    return p;
  },
  blade(t) {
    const len = 1.0 + t * 0.04;
    const p = [
      P(PRIM.CYL, [-0.14, 0, 0], [0.06, 0, 0], 0.024, 'grip'),
      P(PRIM.SPHERE, [-0.17, 0, 0], [-0.12, 0, 0], 0.035, 'metal'),
      P(PRIM.BOX, [0.06, -0.13 - t * 0.015, 0], [0.06, 0.13 + t * 0.015, 0], 0.025, 'metal'),
      P(PRIM.OCTA, [0.06, 0, 0], [len, 0, 0], 0.055 + t * 0.004, 'metal', t >= 3 ? 0.3 : 0, 0.3),
    ];
    if (t >= 1) p.push(P(PRIM.OCTA, [0.15, 0, 0], [len * 0.82, 0, 0], 0.018, 'glow', 1.2 + t * 0.3));
    if (t >= 3) p.push(P(PRIM.OCTA, [0.3, 0.06, 0], [len * 0.92, 0.1, 0], 0.03, 'metal', 0.4, 0.4));
    addTierDetails(p, t, len * 0.85, 0.08);
    return { parts: p, tip: len, base: 0.15 };
  },
  cleaver(t) {
    const len = 1.35 + t * 0.05;
    const p = [
      P(PRIM.CYL, [-0.35, 0, 0], [0.1, 0, 0], 0.03, 'grip'),
      P(PRIM.BOX, [0.1, -0.18, 0], [0.1, 0.18, 0], 0.04, 'metal'),
      P(PRIM.BOX, [0.12, 0, 0], [len, 0, 0], 0.13 + t * 0.008, 'metal', t >= 3 ? 0.25 : 0, 0.18),
      P(PRIM.CONE, [len, 0, 0], [len + 0.22, -0.05, 0], 0.12, 'metal', 0, 0.18),
    ];
    if (t >= 1) p.push(P(PRIM.BOX, [0.25, 0.1, 0], [len * 0.9, 0.1, 0], 0.02, 'glow', 1.4 + t * 0.3, 0.5));
    if (t >= 2) for (let i = 0; i < 3; i++) p.push(P(PRIM.CONE, [0.4 + i * 0.3, -0.12, 0], [0.5 + i * 0.3, -0.26, 0], 0.035, 'metal'));
    addTierDetails(p, t, len * 0.8, 0.12);
    return { parts: p, tip: len + 0.1, base: 0.2 };
  },
  spear(t) {
    const len = 1.25 + t * 0.05;
    const p = [
      P(PRIM.CYL, [-0.85, 0, 0], [len, 0, 0], 0.025, 'grip'),
      P(PRIM.OCTA, [len, 0, 0], [len + 0.42, 0, 0], 0.07 + t * 0.006, 'metal', t >= 3 ? 0.5 : 0, 0.5),
      P(PRIM.SPHERE, [-0.9, 0, 0], [-0.82, 0, 0], 0.04, 'metal'),
    ];
    if (t >= 1) p.push(P(PRIM.CYL, [len - 0.08, 0, 0], [len, 0, 0], 0.045, 'glow', 1.5));
    if (t >= 2) for (const s of [-1, 1]) p.push(P(PRIM.CONE, [len, s * 0.04, 0], [len - 0.15, s * 0.2, 0], 0.03, 'metal'));
    if (t >= 3) p.push(P(PRIM.OCTA, [len + 0.05, 0, 0], [len + 0.3, 0, 0], 0.02, 'glow', 2.5));
    if (t >= 4) for (const s of [-1, 1]) p.push(P(PRIM.OCTA, [len - 0.3, s * 0.12, 0], [len + 0.1, s * 0.28, 0], 0.035, 'glow', 1.5, 0.5));
    addTierDetails(p, t, len * 0.7, len * 0.2);
    return { parts: p, tip: len + 0.42, base: 0.6 };
  },
  dual(t) {
    const len = 0.42 + t * 0.03;
    const p = [
      P(PRIM.CYL, [-0.09, 0, 0], [0.04, 0, 0], 0.02, 'grip'),
      P(PRIM.BOX, [0.04, -0.06, 0], [0.04, 0.06, 0], 0.018, 'metal'),
      P(PRIM.OCTA, [0.04, 0, 0], [len, 0.03, 0], 0.04, 'metal', t >= 3 ? 0.4 : 0, 0.3),
    ];
    if (t >= 1) p.push(P(PRIM.OCTA, [0.08, 0, 0], [len * 0.8, 0.02, 0], 0.012, 'glow', 1.5 + t * 0.3));
    if (t >= 3) p.push(P(PRIM.CONE, [0.15, -0.03, 0], [0.3, -0.1, 0], 0.02, 'metal'));
    if (t >= 4) p.push(P(PRIM.CONE, [0.04, 0.05, 0], [0.18, 0.14, 0], 0.02, 'dark'));
    if (t >= 5) p.push(P(PRIM.ORB, [0.0, 0, 0.03], [0.05, 0, 0.03], 0.035, 'glow', 2.5));
    return { parts: p, tip: len, base: 0.05 };
  },
  maul(t) {
    const hu = 0.95 + t * 0.03;
    const hw = 0.22 + t * 0.02;
    const p = [
      P(PRIM.CYL, [-0.35, 0, 0], [hu, 0, 0], 0.03, 'grip'),
      P(PRIM.BOX, [hu, -hw, 0], [hu, hw, 0], 0.15 + t * 0.01, 'metal', t >= 3 ? 0.2 : 0),
    ];
    if (t >= 1) p.push(P(PRIM.BOX, [hu, -hw - 0.02, 0], [hu, hw + 0.02, 0], 0.07, 'glow', 1.5 + t * 0.3));
    if (t >= 2) for (const s of [-1, 1]) p.push(P(PRIM.CONE, [hu, s * hw, 0], [hu, s * (hw + 0.2), 0], 0.08, 'metal'));
    if (t >= 3) p.push(P(PRIM.CONE, [hu + 0.12, 0, 0], [hu + 0.38, 0, 0], 0.06, 'metal'));
    if (t >= 4) p.push(P(PRIM.ORB, [hu, 0, 0.12], [hu, 0, 0.2], 0.08, 'bone'));
    addTierDetails(p, t, hu * 0.6, 0.05);
    return { parts: p, tip: hu + 0.1, base: 0.8 };
  },
  scythe(t) {
    const top = 1.1 + t * 0.04;
    const curl = 1 + t * 0.08;
    const pts = [[top, 0, 0], [top + 0.05, 0.3 * curl, 0], [top - 0.05, 0.62 * curl, 0], [top - 0.25, 0.85 * curl, 0]];
    const p = [
      P(PRIM.CYL, [-0.65, 0, 0], [top + 0.05, 0, 0], 0.025, 'grip'),
      P(PRIM.SPHERE, [top - 0.02, 0, 0], [top + 0.1, 0, 0], 0.05, 'bone'),
    ];
    for (let i = 0; i < 3; i++) p.push(P(PRIM.OCTA, pts[i], pts[i + 1], 0.07 - i * 0.012, 'metal', t >= 3 ? 0.35 : 0, 0.25));
    if (t >= 1) for (let i = 0; i < 3; i++) p.push(P(PRIM.OCTA, [pts[i][0] - 0.03, pts[i][1], 0], [pts[i + 1][0] - 0.03, pts[i + 1][1], 0], 0.015, 'glow', 1.5 + t * 0.3));
    if (t >= 2) p.push(P(PRIM.CONE, [-0.65, 0, 0], [-0.9, 0, 0], 0.03, 'metal'));
    if (t >= 4) for (let i = 0; i < 2; i++) p.push(P(PRIM.CONE, [top - 0.3 - i * 0.25, 0, 0], [top - 0.35 - i * 0.25, -0.15, 0], 0.025, 'bone'));
    addTierDetails(p, t, top * 0.6, 0.0);
    return { parts: p, tip: top, base: 0.9 };
  },
};

const PALETTES = {
  fists: { metal: [0.65, 0.6, 0.62], grip: [0.2, 0.15, 0.12], dark: [0.1, 0.05, 0.1], bone: [0.85, 0.8, 0.7] },
  blade: { metal: [0.75, 0.78, 0.82], grip: [0.22, 0.12, 0.1], dark: [0.12, 0.05, 0.12], bone: [0.85, 0.8, 0.7] },
  cleaver: { metal: [0.55, 0.55, 0.6], grip: [0.18, 0.1, 0.08], dark: [0.1, 0.05, 0.08], bone: [0.85, 0.8, 0.7] },
  spear: { metal: [0.45, 0.4, 0.6], grip: [0.15, 0.1, 0.2], dark: [0.08, 0.04, 0.12], bone: [0.85, 0.8, 0.7] },
  dual: { metal: [0.8, 0.8, 0.85], grip: [0.15, 0.1, 0.1], dark: [0.1, 0.0, 0.05], bone: [0.85, 0.8, 0.7] },
  maul: { metal: [0.4, 0.38, 0.38], grip: [0.25, 0.18, 0.12], dark: [0.1, 0.06, 0.05], bone: [0.88, 0.84, 0.72] },
  scythe: { metal: [0.6, 0.62, 0.65], grip: [0.12, 0.1, 0.1], dark: [0.05, 0.03, 0.06], bone: [0.88, 0.84, 0.72] },
};

/** Build a renderable weapon instance for a type + rarity tier. */
export function makeWeapon(type, tier = 0) {
  const def = WEAPONS[type];
  const built = builders[type](tier);
  const model = Array.isArray(built) ? { parts: built, tip: def.tip, base: def.base } : built;
  const rc = RARITY[tier].color;
  const pal = PALETTES[type];
  const colors = {
    metal: tier >= 4 ? mixRgb(pal.metal, [0.08, 0.06, 0.1], 0.6) : mixRgb(pal.metal, rc, tier * 0.08),
    grip: pal.grip,
    glow: rc,
    dark: pal.dark,
    bone: pal.bone,
    eye: [0.95, 0.9, 0.8],
  };
  return {
    type,
    tier,
    def,
    model,
    colors,
    dmg: def.dmg * RARITY[tier].mul ** 0.75,
    reach: def.reach * (1 + tier * 0.04),
    trailColor: tier === 0 ? [0.8, 0.8, 0.9] : rc,
    glow: tier,
  };
}

const A = [0, 0, 0], B = [0, 0, 0];

/** Draw a weapon given hand position and an orthonormal basis (u along weapon, v, w). */
export function drawWeapon(R, w, hx, hy, hz, u, v, wv, flash = 0) {
  const parts = w.model.parts;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    for (let k = 0; k < 3; k++) {
      A[k] = (k === 0 ? hx : k === 1 ? hy : hz) + u[k] * p[1] + v[k] * p[2] + wv[k] * p[3];
      B[k] = (k === 0 ? hx : k === 1 ? hy : hz) + u[k] * p[4] + v[k] * p[5] + wv[k] * p[6];
    }
    const c = w.colors[p[8]];
    R.segPrim(p[0], A[0], A[1], A[2], B[0], B[1], B[2], p[7], c, p[9] + flash, p[10]);
  }
}

/** Basis helper: u = dir, v perpendicular using a reference axis. Writes into v and w arrays. */
export function weaponBasis(u, ref, v, w) {
  let vx = u[1] * ref[2] - u[2] * ref[1];
  let vy = u[2] * ref[0] - u[0] * ref[2];
  let vz = u[0] * ref[1] - u[1] * ref[0];
  let l = Math.hypot(vx, vy, vz);
  if (l < 1e-3) { vx = 0; vy = 1; vz = 0; l = 1; }
  v[0] = vx / l; v[1] = vy / l; v[2] = vz / l;
  w[0] = u[1] * v[2] - u[2] * v[1];
  w[1] = u[2] * v[0] - u[0] * v[2];
  w[2] = u[0] * v[1] - u[1] * v[0];
}
