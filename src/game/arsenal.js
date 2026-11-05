// The arsenal: four designated slots (Blade, Arms, Arcana, Power), item levels and marked evolution recipes.
// Every item is data plus a few behaviour hooks; the Loadout owns cooldowns, held fire, summons and visuals.
import { PRIM } from '../gfx/renderer.js';
import { SHAPE } from '../gfx/particles.js';
import { TAU, clamp } from '../core/math.js';
import { drawRig } from './rig.js';
import { L } from '../core/i18n.js';

export const SLOTS = ['blade', 'arms', 'magic', 'power'];
export const SLOT_INFO = {
  blade: { name: 'Blade', key: 'LMB', pad: 'X', hint: 'Melee combo' },
  arms: { name: 'Arms', key: 'RMB', pad: 'Y', hint: 'Hold to fire' },
  magic: { name: 'Arcana', key: 'Q', pad: 'B', hint: 'Spell' },
  power: { name: 'Power', key: 'F', pad: 'RB', hint: 'Superpower' },
};
export const MAX_LEVEL = 5;

const lerpL = (a, b, L) => a + (b - a) * (L - 1) / (MAX_LEVEL - 1);
const cdL = (base, L) => base * (1 - 0.07 * (L - 1));

// ------------------------------------------------------------------ shared effect helpers
function power(g) {
  const p = g.player;
  return p.stats.dmgMul * (p.buffs.berserkT > 0 ? 1.25 + 0.05 * (p.buffs.berserkL || 1) : 1);
}

/** Damage an enemy from an arsenal effect, rolling crits. */
export function strike(g, e, dmg, o = {}) {
  if (!e || !e.alive) return;
  const p = g.player, st = p.stats;
  const crit = o.crit ?? Math.random() < st.critChance + (o.critBonus || 0);
  const fx = o.fromX ?? p.x, fz = o.fromZ ?? p.z;
  let dx = o.dirX ?? e.x - fx, dz = o.dirZ ?? e.z - fz;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l; dz /= l;
  g.damageEnemy(e, {
    dmg: dmg * (crit ? st.critMul : 1) * (0.92 + Math.random() * 0.16), crit, dirX: dx, dirZ: dz,
    kb: o.kb ?? 2, source: o.source || 'arcane', color: o.color, quiet: o.quiet, burn: o.burn, impact: o.impact,
  });
  if (o.freeze && e.alive) g.freeze(e, o.freeze);
}

function blast(g, x, z, r, dmg, o = {}) {
  const hits = [];
  g.forEnemiesNear(x, z, r, (e) => { hits.push(e); });
  for (const e of hits) strike(g, e, dmg, { kb: 5, ...o, fromX: x, fromZ: z });
  g.world.hitDestructibles(x, z, r, dmg, g);
  g.grassBlast(x, z, r * 1.4, 1.4);
  return hits;
}

/** Lightning that hops between nearby foes. */
function chain(g, from, jumps, dmg, color, hitSet = new Set([from])) {
  let src = from;
  for (let k = 0; k < jumps; k++) {
    let best = null, bd = 9;
    g.forEnemiesNear(src.x, src.z, 9, (o) => {
      if (hitSet.has(o) || !o.alive) return;
      const d = Math.hypot(o.x - src.x, o.z - src.z);
      if (d < bd) { bd = d; best = o; }
    });
    if (!best) break;
    hitSet.add(best);
    g.lightning(src.x, src.y + 1.2 * (src.size || 1), src.z, best.x, best.y + 1.2 * best.size, best.z, color);
    strike(g, best, dmg, { kb: 1, source: 'chain', color, quiet: true });
    src = best;
  }
  g.audio.play('zap', 0.6);
}

function shoot(g, o) {
  const p = g.player;
  g.spawnProjectile({ x: p.x, y: p.y + 1.35, z: p.z, vy: 0, r: 0.45, life: 1.5, owner: 'player', color: [1, 1, 1], pierce: 0, ...o });
}

function crescent(g, x, z, dx, dz, dmg, color, o = {}) {
  const p = g.player;
  g.spawnProjectile({ kind: 'wave', x: x + dx * 0.8, y: p.y + 1.0, z: z + dz * 0.8, vx: dx * 22, vy: 0, vz: dz * 22, r: 1.4 * p.stats.areaMul, life: 0.5, dmg, pierce: 99, color, groundSkim: true, owner: 'player', yaw: Math.atan2(dx, dz), ...o });
}

function faceDir(p) { return [Math.sin(p.yaw), Math.cos(p.yaw)]; }

function heal(g, v) {
  const p = g.player;
  if (!p.alive) return;
  p.hp = Math.min(p.stats.maxHp, p.hp + v);
}

const COL = {
  steel: [0.85, 0.9, 1], volt: [0.55, 0.85, 1], blood: [0.95, 0.12, 0.2], shadow: [0.55, 0.35, 1], ember: [1, 0.5, 0.15],
  void: [0.6, 0.3, 1], ice: [0.6, 0.95, 1], gold: [1, 0.82, 0.35], paper: [0.98, 0.94, 0.82], soul: [0.5, 1, 0.85],
};

// ------------------------------------------------------------------ items
// Blade items: combo (MOVES names), model (weapons.js builder), dmg/speed by level, optional hooks.
// Hooks: onSwing(ctx, move, idx, hits) after each strike resolves, onHit(ctx, e, info), onKill(ctx, e).
export const ITEMS = {
  // ---------------------------------------------------------------- BLADE
  katana: {
    slot: 'blade', name: 'Crescent Katana', icon: '🗡', model: 'blade', combo: ['slashR', 'slashL', 'thrust', 'spin'],
    desc: 'A balanced four-cut chain. From Lv 3 the final cut looses a crescent wave.',
    stats: (L) => ({ dmg: lerpL(11, 22, L), speed: 1.05 + L * 0.02, waves: L >= 5 ? 2 : L >= 3 ? 1 : 0 }),
    lvDesc: (lv) => (lv >= 5 ? L('{dmg} damage per cut · 2 crescent waves', { dmg: Math.round(lerpL(11, 22, lv)) }) : lv >= 3 ? L('{dmg} damage per cut · 1 crescent wave', { dmg: Math.round(lerpL(11, 22, lv)) }) : L('{dmg} damage per cut', { dmg: Math.round(lerpL(11, 22, lv)) })),
    onSwing(c, move, idx) {
      if (!c.st.waves || idx !== 0 || c.p.comboIdx % 4 !== 0) return;
      const [dx, dz] = faceDir(c.p);
      for (let i = 0; i < c.st.waves; i++) crescent(c.g, c.p.x, c.p.z, dx * (1 - i * 0.1) - dz * i * 0.25, dz * (1 - i * 0.1) + dx * i * 0.25, c.st.dmg * 0.8 * power(c.g), COL.steel);
    },
  },
  fangs: {
    slot: 'blade', name: 'Twin Fangs', icon: '⚚', model: 'dual', combo: ['dualFlurry', 'dualFlurry', 'dualCross', 'dualFlurry', 'dualFlurry', 'spin'],
    desc: 'Blinding twin-dagger flurries. Every cut opens a bleeding wound.',
    stats: (L) => ({ dmg: lerpL(6, 12, L), speed: 1.4 + L * 0.03, bleed: 1.5 + L }),
    lvDesc: (lv) => L('{dmg} damage per cut · bleed {b}/s', { dmg: Math.round(lerpL(6, 12, lv)), b: 1.5 + lv }),
    onHit(c, e) { e.burnT = 2; e.burnDps = Math.max(e.burnDps || 0, c.st.bleed * power(c.g)); e.dotCol = COL.blood; },
  },
  cleaver: {
    slot: 'blade', name: 'Greatcleaver', icon: '⚔', model: 'cleaver', combo: ['slashR', 'overhead', 'slam'],
    desc: 'Slow, enormous arcs. The closing slam sends out a shockwave.',
    stats: (L) => ({ dmg: lerpL(19, 38, L), speed: 0.76 + L * 0.02, shock: 2.6 + L * 0.5 }),
    lvDesc: (lv) => L('{dmg} damage per arc · {s} m shockwave', { dmg: Math.round(lerpL(19, 38, lv)), s: (2.6 + lv * 0.5).toFixed(1) }),
  },
  scythe: {
    slot: 'blade', name: 'Reaper Scythe', icon: '☾', model: 'scythe', combo: ['reap', 'slashL', 'reap', 'spin'],
    desc: 'Wide reaping arcs. Each reaped soul mends a little of you.',
    stats: (L) => ({ dmg: lerpL(13, 26, L), speed: 0.9 + L * 0.02, leech: 0.6 + L * 0.4 }),
    lvDesc: (lv) => L('{dmg} damage per arc · heal {h} per kill', { dmg: Math.round(lerpL(13, 26, lv)), h: (0.6 + lv * 0.4).toFixed(1) }),
    onKill(c) { heal(c.g, c.st.leech); },
  },
  spear: {
    slot: 'blade', name: 'Voidspear', icon: '🔱', model: 'spear', combo: ['thrust', 'thrust', 'slashL', 'thrust', 'spin'],
    desc: 'Long-reach thrusts. From Lv 3 thrusts hurl a void lance.',
    stats: (L) => ({ dmg: lerpL(12, 24, L), speed: 1.0 + L * 0.02, lance: L >= 3 }),
    lvDesc: (lv) => (lv >= 3 ? L('{dmg} damage per thrust · thrusts hurl a void lance', { dmg: Math.round(lerpL(12, 24, lv)) }) : L('{dmg} damage per thrust', { dmg: Math.round(lerpL(12, 24, lv)) })),
    onSwing(c, move, idx) {
      if (!c.st.lance || move.name !== 'thrust' || idx !== 0) return;
      const [dx, dz] = faceDir(c.p);
      shoot(c.g, { kind: 'lance', vx: dx * 30, vz: dz * 30, dmg: c.st.dmg * 0.7 * power(c.g), pierce: 3, life: 0.45, color: COL.void, r: 0.6 });
    },
  },
  fists: {
    slot: 'blade', name: 'Spirit Fists', icon: '✊', model: 'fists', combo: ['jab', 'cross', 'hook', 'kick', 'spinKick'],
    desc: 'Rapid strikes and kicks. The fifth blow bursts with a spirit palm.',
    stats: (L) => ({ dmg: lerpL(7, 14, L), speed: 1.28 + L * 0.03, palm: 2.4 + L * 0.3 }),
    lvDesc: (lv) => L('{dmg} damage per blow · {p} m palm burst', { dmg: Math.round(lerpL(7, 14, lv)), p: (2.4 + lv * 0.3).toFixed(1) }),
    onSwing(c, move, idx) {
      if (move.name !== 'spinKick' || idx !== 0) return;
      const p = c.p;
      c.g.shockwave(p.x, p.z, c.st.palm, COL.gold, false);
      blast(c.g, p.x, p.z, c.st.palm, c.st.dmg * 1.4 * power(c.g), { source: 'palm', color: COL.gold, kb: 9 });
    },
  },

  // ---------------------------------------------------------------- ARMS (hold to fire)
  ofuda: {
    slot: 'arms', name: 'Ofuda Talismans', icon: '📜', desc: 'Homing paper seals that cling to foes and detonate.',
    stats: (L) => ({ dmg: lerpL(9, 18, L), cd: cdL(0.75, L), n: 1 + Math.floor(L / 2) }),
    lvDesc: (lv) => (lv >= 2 ? L('{n} seals · {dmg} blast damage', { n: 1 + Math.floor(lv / 2), dmg: Math.round(lerpL(9, 18, lv)) }) : L('1 seal · {dmg} blast damage', { dmg: Math.round(lerpL(9, 18, lv)) })),
    fire(c) {
      for (let i = 0; i < c.st.n; i++) {
        const a = Math.atan2(c.aim.dx, c.aim.dz) + (i - (c.st.n - 1) / 2) * 0.45;
        shoot(c.g, { kind: 'seal', vx: Math.sin(a) * 14, vy: 3, vz: Math.cos(a) * 14, homing: 10, target: c.aim.e, life: 2.4, dmg: 1, color: COL.paper, r: 0.5,
          onHit: (pr, e) => sealBlast(c.g, e, c.st.dmg * power(c.g), false) });
      }
    },
  },
  bow: {
    slot: 'arms', name: 'Spirit Bow', icon: '🏹', desc: 'Fast spirit arrows that pierce through lines of foes.',
    stats: (L) => ({ dmg: lerpL(10, 20, L), cd: cdL(0.5, L), pierce: 1 + Math.floor(L / 2) }),
    lvDesc: (lv) => L('{dmg} damage · pierces {p}', { dmg: Math.round(lerpL(10, 20, lv)), p: 1 + Math.floor(lv / 2) }),
    fire(c) { shoot(c.g, { kind: 'arrow', vx: c.aim.dx * 42, vy: c.aim.dy * 42, vz: c.aim.dz * 42, dmg: c.st.dmg * power(c.g), pierce: c.st.pierce, life: 0.9, color: COL.soul, r: 0.45 }); },
  },
  kunai: {
    slot: 'arms', name: 'Kunai Fan', icon: '✧', desc: 'A fanned volley of throwing knives. Short range, wide spread.',
    stats: (L) => ({ dmg: lerpL(5, 9, L), cd: cdL(0.8, L), n: 3 + L }),
    lvDesc: (lv) => L('{n} kunai · {dmg} damage each', { n: 3 + lv, dmg: Math.round(lerpL(5, 9, lv)) }),
    fire(c) { kunaiFan(c, c.st.n, 0.75, false); },
  },
  chakram: {
    slot: 'arms', name: 'Chakram Halo', icon: '◎', desc: 'A ring blade that flies out and returns, cutting both ways.',
    stats: (L) => ({ dmg: lerpL(9, 18, L), cd: cdL(1.2, L), n: L >= 3 ? 2 : 1, range: 11 + L }),
    lvDesc: (lv) => (lv >= 3 ? L('2 chakram · {dmg} damage per pass', { dmg: Math.round(lerpL(9, 18, lv)) }) : L('1 chakram · {dmg} damage per pass', { dmg: Math.round(lerpL(9, 18, lv)) })),
    fire(c) { throwChakram(c, false); },
  },
  revolver: {
    slot: 'arms', name: 'Soul Revolver', icon: '🔫', desc: 'Six fast, crit-prone shots, then a reload.',
    stats: (L) => ({ dmg: lerpL(9, 17, L), cd: 0.2, mag: 6, reload: 1.45 * (1 - 0.08 * (L - 1)) }),
    lvDesc: (lv) => L('{dmg} damage · +15% crit · {r} s reload', { dmg: Math.round(lerpL(9, 17, lv)), r: (1.45 * (1 - 0.08 * (lv - 1))).toFixed(2) }),
    fire(c) { revolverShot(c, false); },
  },

  // ---------------------------------------------------------------- ARCANA (press, cooldown)
  thunder: {
    slot: 'magic', name: 'Thunder Sigil', icon: 'ϟ', desc: 'Brands the ground with a sigil, then calls a lightning strike that chains.',
    stats: (L) => ({ dmg: lerpL(26, 52, L), cd: cdL(6, L), jumps: 2 + Math.floor(L / 2) }),
    lvDesc: (lv) => L('{dmg} strike damage · chains {j}', { dmg: Math.round(lerpL(26, 52, lv)), j: 2 + Math.floor(lv / 2) }),
    cast(c) {
      const { x, z } = c.aim;
      const dmg = c.st.dmg * power(c.g);
      c.L_.sigil(x, z, 2.6, COL.volt, 0.45, () => {
        const hits = blast(c.g, x, z, 2.6, dmg, { source: 'thunder', color: COL.volt, kb: 4 });
        const y = c.g.world.height(x, z);
        c.g.lightning(x, y + 18, z, x, y, z, COL.volt);
        c.g.lightning(x + 0.4, y + 14, z, x, y, z, [1, 1, 1]);
        if (hits.length) chain(c.g, hits[0], c.st.jumps, dmg * 0.55, COL.volt, new Set(hits));
        c.g.audio.play('zap'); c.g.shake(0.25);
      });
    },
  },
  frost: {
    slot: 'magic', name: 'Frost Lotus', icon: '❄', desc: 'A lotus of ice blooms outward, freezing everything it touches.',
    stats: (L) => ({ dmg: lerpL(16, 32, L), cd: cdL(8, L), r: 5 + L * 0.6, freeze: 0.8 + L * 0.15 }),
    lvDesc: (lv) => L('{dmg} damage · {r} m · freeze {f} s', { dmg: Math.round(lerpL(16, 32, lv)), r: (5 + lv * 0.6).toFixed(1), f: (0.8 + lv * 0.15).toFixed(2) }),
    cast(c) { c.L_.ring(c.p.x, c.p.z, c.st.r, 0.4, COL.ice, (e) => strike(c.g, e, c.st.dmg * power(c.g), { source: 'frost', color: COL.ice, freeze: c.st.freeze, kb: 3 })); c.g.audio.play('zap', 0.7); },
  },
  hellfire: {
    slot: 'magic', name: 'Hellfire Kanji', icon: '✹', desc: 'Writes a line of burning glyphs that erupt into fire pillars.',
    stats: (L) => ({ dmg: lerpL(15, 30, L), cd: cdL(7, L), n: 4 + L, burn: 3 + L * 1.5 }),
    lvDesc: (lv) => L('{n} pillars · {dmg} damage · burn {b}/s', { n: 4 + lv, dmg: Math.round(lerpL(15, 30, lv)), b: 3 + lv * 1.5 }),
    cast(c) { pillarLine(c, c.st.n, 1.8, c.st.dmg * power(c.g), c.st.burn * power(c.g)); },
  },
  bloodmoon: {
    slot: 'magic', name: 'Blood Moon', icon: '◐', desc: 'Raises a crimson moon that drains nearby foes and feeds you.',
    stats: (L) => ({ dmg: lerpL(4, 9, L), cd: cdL(12, L), dur: 4 + L * 0.4, r: 6.5 }),
    lvDesc: (lv) => L('{d} s · drains {dmg} per pulse', { d: (4 + lv * 0.4).toFixed(1), dmg: Math.round(lerpL(4, 9, lv)) }),
    cast(c) { bloodMoon(c, c.st.dur, c.st.r, c.st.dmg, false); },
  },
  voidorb: {
    slot: 'magic', name: 'Void Orb', icon: '◉', desc: 'A slow orb of nothing that drags foes in, grinds them and bursts.',
    stats: (L) => ({ dmg: lerpL(6, 12, L), cd: cdL(9, L), r: 4.5 + L * 0.4 }),
    lvDesc: (lv) => L('{r} m pull · {dmg} per tick', { r: (4.5 + lv * 0.4).toFixed(1), dmg: Math.round(lerpL(6, 12, lv)) }),
    cast(c) {
      const dmg = c.st.dmg * power(c.g), r = c.st.r;
      shoot(c.g, { kind: 'orb', vx: c.aim.dx * 6, vz: c.aim.dz * 6, life: 3, pierce: 999, dmg: 0, r: 0.1, color: COL.void, noGround: true, groundSkim: true,
        tick: (pr, dt) => pull(c.g, pr, r, dmg, dt, 16),
        onEnd: (pr) => { c.g.shockwave(pr.x, pr.z, r * 0.8, COL.void, false); blast(c.g, pr.x, pr.z, r * 0.8, dmg * 4, { source: 'void', color: COL.void }); } });
    },
  },

  // ---------------------------------------------------------------- POWER (press, long cooldown)
  afterimage: {
    slot: 'power', name: 'Afterimage', icon: '◈', desc: 'Dash through space; the shadows you leave behind strike on their own.',
    stats: (L) => ({ dmg: lerpL(16, 34, L), cd: cdL(10, L), n: 2 + Math.floor(L / 2) }),
    lvDesc: (lv) => L('{n} shadows · {dmg} damage each', { n: 2 + Math.floor(lv / 2), dmg: Math.round(lerpL(16, 34, lv)) }),
    cast(c) { afterimageDash(c, c.st.n, c.st.dmg); },
  },
  gravity: {
    slot: 'power', name: 'Gravity Crush', icon: '▼', desc: 'Drags every foe nearby into you, then slams the ground flat.',
    stats: (L) => ({ dmg: lerpL(28, 60, L), cd: cdL(12, L), r: 7 + L * 0.6 }),
    lvDesc: (lv) => L('{r} m pull · {dmg} slam damage', { r: (7 + lv * 0.6).toFixed(1), dmg: Math.round(lerpL(28, 60, lv)) }),
    cast(c) { gravityCrush(c, c.st.r, c.st.dmg, false); },
  },
  chrono: {
    slot: 'power', name: 'Chrono Stop', icon: '⌛', desc: 'Stops time for everything but you. Frozen foes take 25% more damage.',
    stats: (L) => ({ cd: cdL(18, L), dur: 2 + L * 0.3 }),
    lvDesc: (lv) => L('{d} s of stopped time', { d: (2 + lv * 0.3).toFixed(1) }),
    cast(c) { c.g.timeStop(c.st.dur); },
  },
  berserk: {
    slot: 'power', name: 'Berserk Aura', icon: '☠', desc: 'Burn hot: faster attacks, more damage and a scorching aura.',
    stats: (L) => ({ cd: cdL(20, L), dur: 5 + L * 0.5, dps: 6 + L * 2 }),
    lvDesc: (lv) => L('{d} s · +35% attack speed · +{dmg}% damage', { d: (5 + lv * 0.5).toFixed(1), dmg: 25 + lv * 5 }),
    cast(c) { const b = c.p.buffs; b.berserkT = c.st.dur; b.berserkL = c.level; b.berserkDps = c.st.dps; c.g.audio.play('roar', 0.5); c.g.shake(0.3); },
  },
  phantom: {
    slot: 'power', name: 'Phantom Arms', icon: '☸', desc: 'Summons spectral arms that orbit you and pummel anything close.',
    stats: (L) => ({ dmg: lerpL(8, 16, L), cd: cdL(16, L), n: 2 + Math.floor(L / 2), dur: 8 }),
    lvDesc: (lv) => L('{n} arms for 8 s · {dmg} per punch', { n: 2 + Math.floor(lv / 2), dmg: Math.round(lerpL(8, 16, lv)) }),
    cast(c) { phantomArms(c, c.st.n, c.st.dmg, c.st.dur, false); },
  },

  // ---------------------------------------------------------------- EVOLUTIONS
  raijin: {
    slot: 'blade', evolved: true, name: 'Raijin Edge', icon: 'ϟ', model: 'blade', combo: ['slashR', 'slashL', 'thrust', 'spin'], tint: COL.volt,
    desc: 'Every cut calls down lightning that leaps between foes; the chain ends in a thunder crescent.',
    stats: () => ({ dmg: 30, speed: 1.15 }),
    onHit(c, e, info) { if (info.source === 'melee' && Math.random() < 0.5) chain(c.g, e, 3, c.st.dmg * 0.45 * power(c.g), COL.volt); },
    onSwing(c, move, idx) {
      if (idx !== 0 || c.p.comboIdx % 4 !== 0) return;
      const [dx, dz] = faceDir(c.p);
      crescent(c.g, c.p.x, c.p.z, dx, dz, c.st.dmg * power(c.g), COL.volt, { onHit: (pr, e) => chain(c.g, e, 2, c.st.dmg * 0.4 * power(c.g), COL.volt) });
    },
  },
  muramasa: {
    slot: 'blade', evolved: true, name: 'Muramasa', icon: '◐', model: 'blade', combo: ['slashR', 'slashL', 'thrust', 'spin'], tint: COL.blood,
    desc: 'A hungry blade. Cuts drink blood; every tenth cut tears a crimson crescent storm around you.',
    stats: () => ({ dmg: 28, speed: 1.12 }),
    onHit(c, e, info) {
      if (info.source !== 'melee') return;
      heal(c.g, info.dmg * 0.03);
      c.s.blood = (c.s.blood || 0) + 1;
      if (c.s.blood >= 10) {
        c.s.blood = 0;
        for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; crescent(c.g, c.p.x, c.p.z, Math.sin(a), Math.cos(a), c.st.dmg * 1.2 * power(c.g), COL.blood); }
        c.g.audio.play('crit'); c.g.impact();
      }
    },
  },
  shadowwaltz: {
    slot: 'blade', evolved: true, name: 'Shadow Waltz', icon: '◈', model: 'dual', combo: ['dualFlurry', 'dualFlurry', 'dualCross', 'dualFlurry', 'dualFlurry', 'spin'], tint: COL.shadow,
    desc: 'Every fourth cut calls a shadow of you that blinks onto a foe and dances through its friends.',
    stats: () => ({ dmg: 16, speed: 1.55, bleed: 8 }),
    onHit(c, e, info) {
      e.burnT = 2; e.burnDps = Math.max(e.burnDps || 0, c.st.bleed * power(c.g)); e.dotCol = COL.blood;
      if (info.source !== 'melee') return;
      c.s.n = (c.s.n || 0) + 1;
      if (c.s.n % 4 === 0) c.L_.clone(e.x + (Math.random() - 0.5) * 2, e.z + (Math.random() - 0.5) * 2, c.st.dmg * 1.6 * power(c.g), 3, COL.shadow);
    },
  },
  worldsplitter: {
    slot: 'blade', evolved: true, name: 'Worldsplitter', icon: '▼', model: 'cleaver', combo: ['slashR', 'overhead', 'slam'], tint: COL.ember,
    desc: 'Overheads and slams split the earth: a fissure races ahead and erupts in sequence.',
    stats: () => ({ dmg: 46, speed: 0.86, shock: 5 }),
    onSwing(c, move, idx) {
      if (idx !== 0 || (move.name !== 'overhead' && move.name !== 'slam')) return;
      const [dx, dz] = faceDir(c.p);
      for (let i = 1; i <= 7; i++) {
        c.g.addHazard({ x: c.p.x + dx * i * 1.7, z: c.p.z + dz * i * 1.7, r: 1.8, t: 0.05 + i * 0.07, dmg: c.st.dmg * 0.8 * power(c.g), kind: 'pillar', owner: 'player', color: COL.ember });
      }
    },
  },
  eclipse: {
    slot: 'blade', evolved: true, name: 'Eclipse Reaper', icon: '◉', model: 'scythe', combo: ['reap', 'slashL', 'reap', 'spin'], tint: COL.void,
    desc: 'Reaps drag foes into the blade. The slain rise as soul wisps that hunt their kin.',
    stats: () => ({ dmg: 32, speed: 1.0, leech: 3 }),
    onSwing(c, move, idx) {
      if (idx !== 0 || move.name !== 'reap') return;
      const p = c.p;
      c.g.forEnemiesNear(p.x, p.z, 7, (e) => { if (!e.boss) { const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz) || 1; e.kbx += (dx / d) * 9; e.kbz += (dz / d) * 9; } });
    },
    onKill(c, e) {
      heal(c.g, c.st.leech);
      shoot(c.g, { kind: 'wisp', x: e.x, y: e.y + 1.5, z: e.z, vx: 0, vy: 4, vz: 0, homing: 12, life: 3, dmg: c.st.dmg * 0.8 * power(c.g), color: COL.soul, r: 0.5 });
    },
  },
  glacialpike: {
    slot: 'blade', evolved: true, name: 'Glacial Pike', icon: '❄', model: 'spear', combo: ['thrust', 'thrust', 'slashL', 'thrust', 'spin'], tint: COL.ice,
    desc: 'Thrusts launch freezing ice lances. Frozen foes shatter into shards when they die.',
    stats: () => ({ dmg: 30, speed: 1.1 }),
    onSwing(c, move, idx) {
      if (move.name !== 'thrust' || idx !== 0) return;
      const [dx, dz] = faceDir(c.p);
      shoot(c.g, { kind: 'lance', vx: dx * 34, vz: dz * 34, dmg: c.st.dmg * power(c.g), pierce: 99, life: 0.55, color: COL.ice, r: 0.7, freeze: 1 });
    },
    onKill(c, e) { if (e.iceT > 0) iceShards(c.g, e.x, e.y + 1, e.z, 6, c.st.dmg * 0.6 * power(c.g)); },
  },
  asura: {
    slot: 'blade', evolved: true, name: 'Asura Hundred Fists', icon: '☸', model: 'fists', combo: ['jab', 'cross', 'hook', 'kick', 'spinKick'], tint: COL.gold,
    desc: 'Each blow is echoed by a volley of phantom fists that fan out ahead of you.',
    stats: () => ({ dmg: 16, speed: 1.5, palm: 4.5 }),
    onSwing(c, move, idx) {
      if (idx !== 0) return;
      const [dx, dz] = faceDir(c.p);
      const a0 = Math.atan2(dx, dz);
      for (let i = 0; i < 3; i++) {
        const a = a0 + (i - 1) * 0.3;
        shoot(c.g, { kind: 'fist', vx: Math.sin(a) * 26, vz: Math.cos(a) * 26, dmg: c.st.dmg * 0.6 * power(c.g), pierce: 1, life: 0.3, color: COL.gold, r: 0.7 });
      }
      if (move.name === 'spinKick') { c.g.shockwave(c.p.x, c.p.z, c.st.palm, COL.gold, false); blast(c.g, c.p.x, c.p.z, c.st.palm, c.st.dmg * 2 * power(c.g), { source: 'palm', color: COL.gold, kb: 10 }); }
    },
  },
  inferno: {
    slot: 'arms', evolved: true, name: 'Thousand Seal Inferno', icon: '✹', desc: 'Seals erupt into fire pillars and scatter burning seals onto nearby foes.',
    stats: () => ({ dmg: 26, cd: 0.5, n: 3 }),
    fire(c) {
      for (let i = 0; i < c.st.n; i++) {
        const a = Math.atan2(c.aim.dx, c.aim.dz) + (i - 1) * 0.45;
        shoot(c.g, { kind: 'seal', vx: Math.sin(a) * 15, vy: 3, vz: Math.cos(a) * 15, homing: 11, target: c.aim.e, life: 2.4, dmg: 1, color: COL.ember, r: 0.5, onHit: (pr, e) => sealBlast(c.g, e, c.st.dmg * power(c.g), true) });
      }
    },
  },
  comet: {
    slot: 'arms', evolved: true, name: 'Glacier Comet', icon: '✧', desc: 'Arrows freeze what they pierce and burst into a spray of ice shards.',
    stats: () => ({ dmg: 24, cd: 0.42 }),
    fire(c) {
      shoot(c.g, { kind: 'arrow', vx: c.aim.dx * 44, vy: c.aim.dy * 44, vz: c.aim.dz * 44, dmg: c.st.dmg * power(c.g), pierce: 4, life: 0.9, color: COL.ice, r: 0.5, freeze: 0.8,
        onEnd: (pr) => iceShards(c.g, pr.x, pr.y, pr.z, 6, c.st.dmg * 0.5 * power(c.g)) });
    },
  },
  raiju: {
    slot: 'arms', evolved: true, name: 'Raiju Longbow', icon: '⚡', desc: 'Thunder arrows pass through everything; each foe struck arcs lightning to two more.',
    stats: () => ({ dmg: 22, cd: 0.4 }),
    fire(c) {
      shoot(c.g, { kind: 'arrow', vx: c.aim.dx * 50, vy: c.aim.dy * 50, vz: c.aim.dz * 50, dmg: c.st.dmg * power(c.g), pierce: 99, life: 0.8, color: COL.volt, r: 0.5,
        onHit: (pr, e) => chain(c.g, e, 2, c.st.dmg * 0.45 * power(c.g), COL.volt, pr.hit) });
    },
  },
  kunaistorm: {
    slot: 'arms', evolved: true, name: 'Thousand Kunai Storm', icon: '✦', desc: 'Kunai split three ways mid-flight, then whirl back to your hand.',
    stats: () => ({ dmg: 11, cd: 0.7, n: 7 }),
    fire(c) { kunaiFan(c, c.st.n, 0.9, true); },
  },
  clockwork: {
    slot: 'arms', evolved: true, name: 'Clockwork Halo', icon: '⌛', desc: 'Two halos orbit you forever; thrown halos lock foes out of time.',
    stats: () => ({ dmg: 22, cd: 1.0, n: 2, range: 15 }),
    fire(c) { throwChakram(c, true); },
    passive(c, dt) { orbitBlades(c, dt, 2, 2.6, c.st.dmg * 0.5 * power(c.g), COL.gold); },
  },
  lastrites: {
    slot: 'arms', evolved: true, name: 'Last Rites', icon: '☠', desc: 'Eight-shot soul revolver; every sixth shot is a piercing beam. Instant reloads while berserk.',
    stats: () => ({ dmg: 22, cd: 0.17, mag: 8, reload: 0.7 }),
    fire(c) { revolverShot(c, true); },
  },
  calligraphy: {
    slot: 'magic', evolved: true, name: 'Infernal Calligraphy', icon: '✺', desc: 'Writes two rings of burning glyphs around you and sets your blood alight.',
    stats: () => ({ dmg: 40, cd: 6.5, burn: 12 }),
    cast(c) {
      const p = c.p, dmg = c.st.dmg * power(c.g);
      for (let ring = 0; ring < 2; ring++) {
        const r = ring ? 7.5 : 4, n = ring ? 16 : 10;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + ring * 0.2;
          c.g.addHazard({ x: p.x + Math.sin(a) * r, z: p.z + Math.cos(a) * r, r: 1.9, t: 0.15 + ring * 0.35 + i * 0.015, dmg, kind: 'pillar', owner: 'player', color: COL.ember, burn: c.st.burn * power(c.g) });
        }
      }
      p.buffs.berserkT = Math.max(p.buffs.berserkT, 2.5); p.buffs.berserkL = Math.max(p.buffs.berserkL || 1, 3); p.buffs.berserkDps = Math.max(p.buffs.berserkDps || 0, 10);
    },
  },
  horizon: {
    slot: 'magic', evolved: true, name: 'Event Horizon', icon: '●', desc: 'Opens a black hole that devours the battlefield, then collapses in a cataclysm.',
    stats: () => ({ dmg: 18, cd: 10, r: 10 }),
    cast(c) {
      const dmg = c.st.dmg * power(c.g), r = c.st.r;
      shoot(c.g, { kind: 'orb', big: true, x: c.aim.x, y: c.g.world.height(c.aim.x, c.aim.z) + 2.2, z: c.aim.z, vx: 0, vz: 0, life: 4, pierce: 999, dmg: 0, r: 0.1, color: COL.void, noGround: true,
        tick: (pr, dt) => pull(c.g, pr, r, dmg, dt, 30),
        onEnd: (pr) => { c.g.shockwave(pr.x, pr.z, 8, COL.void, true); blast(c.g, pr.x, pr.z, 8, dmg * 8, { source: 'void', color: COL.void, impact: true }); } });
    },
  },
  crimsonmoon: {
    slot: 'magic', evolved: true, name: 'Crimson Moonrise', icon: '☽', desc: 'A vast moon drains everything nearby and hurls blood crescents at the living.',
    stats: () => ({ dmg: 12, cd: 9, dur: 8, r: 8.5 }),
    cast(c) { bloodMoon(c, c.st.dur, c.st.r, c.st.dmg, true); },
  },
};

export const ITEM_IDS = Object.keys(ITEMS).filter((k) => !ITEMS[k].evolved);

/** Evolution recipes. Each has a unique mark shown on both ingredients. */
export const RECIPES = [
  { into: 'raijin', base: 'katana', with: 'thunder', mark: 'ϟ', color: '#7fe6ff' },
  { into: 'muramasa', base: 'katana', with: 'bloodmoon', mark: '◐', color: '#ff3a52' },
  { into: 'shadowwaltz', base: 'fangs', with: 'afterimage', mark: '◈', color: '#b79bff' },
  { into: 'worldsplitter', base: 'cleaver', with: 'gravity', mark: '▼', color: '#ff9a4a' },
  { into: 'eclipse', base: 'scythe', with: 'voidorb', mark: '◉', color: '#9a6bff' },
  { into: 'glacialpike', base: 'spear', with: 'frost', mark: '❄', color: '#9ff0ff' },
  { into: 'asura', base: 'fists', with: 'phantom', mark: '☸', color: '#ffcf4a' },
  { into: 'inferno', base: 'ofuda', with: 'hellfire', mark: '✹', color: '#ff6a2a' },
  { into: 'comet', base: 'bow', with: 'frost', mark: '✧', color: '#c8f6ff' },
  { into: 'raiju', base: 'bow', with: 'thunder', mark: '⚡', color: '#fff27a' },
  { into: 'kunaistorm', base: 'kunai', with: 'afterimage', mark: '✦', color: '#d6c8ff' },
  { into: 'clockwork', base: 'chakram', with: 'chrono', mark: '⌛', color: '#ffd27a' },
  { into: 'lastrites', base: 'revolver', with: 'berserk', mark: '☠', color: '#ff7a8a' },
  { into: 'calligraphy', base: 'hellfire', with: 'berserk', mark: '✺', color: '#ff8a3a' },
  { into: 'horizon', base: 'voidorb', with: 'gravity', mark: '●', color: '#7a4aff' },
  { into: 'crimsonmoon', base: 'bloodmoon', with: 'scythe', mark: '☽', color: '#e8253f' },
];

export const recipesFor = (id) => RECIPES.filter((r) => r.base === id || r.with === id);

// ------------------------------------------------------------------ behaviour helpers used by several items
function sealBlast(g, e, dmg, inferno) {
  const x = e.x, z = e.z;
  g.addHazard({ x, z, r: inferno ? 2.4 : 1.7, t: 0.4, dmg, kind: inferno ? 'pillar' : 'nova', owner: 'player', color: inferno ? COL.ember : COL.paper, burn: inferno ? 6 * power(g) : 0 });
  if (inferno) {
    for (let k = 0; k < 2; k++) {
      const t = g.randomEnemyNear(x, z, 9);
      if (!t || t === e) continue;
      g.spawnProjectile({ kind: 'seal', x, y: e.y + 1.5, z, vx: (Math.random() - 0.5) * 8, vy: 6, vz: (Math.random() - 0.5) * 8, homing: 12, target: t, life: 2, dmg: 1, r: 0.45, owner: 'player', color: COL.ember, pierce: 0,
        onHit: (pr, e2) => g.addHazard({ x: e2.x, z: e2.z, r: 1.8, t: 0.3, dmg: dmg * 0.6, kind: 'pillar', owner: 'player', color: COL.ember }) });
    }
  }
}

function kunaiFan(c, n, spreadRad, storm) {
  const a0 = Math.atan2(c.aim.dx, c.aim.dz);
  for (let i = 0; i < n; i++) {
    const a = a0 + (n > 1 ? (i / (n - 1) - 0.5) * spreadRad : 0);
    const o = { kind: 'kunai', vx: Math.sin(a) * 28, vz: Math.cos(a) * 28, dmg: c.st.dmg * power(c.g), pierce: storm ? 1 : 0, life: storm ? 0.7 : 0.42, color: storm ? COL.shadow : COL.steel, r: 0.4 };
    if (storm) {
      o.splitAt = 0.25;
      o.returnAt = 0.45;
    }
    shoot(c.g, o);
  }
}

function throwChakram(c, clockwork) {
  const a0 = Math.atan2(c.aim.dx, c.aim.dz);
  for (let i = 0; i < c.st.n; i++) {
    const a = a0 + (c.st.n > 1 ? (i - 0.5) * 0.35 : 0);
    shoot(c.g, { kind: 'chakram', vx: Math.sin(a) * 24, vz: Math.cos(a) * 24, dmg: c.st.dmg * power(c.g), pierce: 99, life: 3, color: clockwork ? COL.gold : COL.steel, r: 0.9,
      returnAt: c.st.range / 24, freeze: clockwork ? 0.8 : 0 });
  }
}

function revolverShot(c, rites) {
  const s = c.s;
  if (s.ammo === undefined) s.ammo = c.st.mag;
  if (s.reloadT > 0) return false;
  const berserk = c.p.buffs.berserkT > 0;
  s.shot = (s.shot || 0) + 1;
  if (rites && s.shot % 6 === 0) {
    // piercing soul beam: instant line damage
    const p = c.p, len = 30;
    const x0 = p.x, z0 = p.z, y0 = p.y + 1.35;
    const x1 = x0 + c.aim.dx * len, z1 = z0 + c.aim.dz * len;
    c.L_.beam(x0, y0, z0, x1, y0 + c.aim.dy * len, z1, COL.soul, 0.22);
    for (const e of c.g.enemies) {
      if (!e.alive || e.state === 'spawn') continue;
      const t = clamp(((e.x - x0) * c.aim.dx + (e.z - z0) * c.aim.dz), 0, len);
      const d = Math.hypot(e.x - (x0 + c.aim.dx * t), e.z - (z0 + c.aim.dz * t));
      if (d < e.radius + 0.8) strike(c.g, e, c.st.dmg * 4 * power(c.g), { source: 'beam', color: COL.soul, critBonus: 0.3, kb: 8 });
    }
    c.g.audio.play('crit'); c.g.shake(0.3);
  } else {
    shoot(c.g, { kind: 'bullet', vx: c.aim.dx * 75, vy: c.aim.dy * 75, vz: c.aim.dz * 75, dmg: c.st.dmg * power(c.g), pierce: 0, life: 0.5, color: rites ? COL.soul : COL.gold, r: 0.4, critBonus: 0.15 });
    c.g.audio.play('hit', 0.35);
  }
  s.ammo--;
  if (s.ammo <= 0) { s.reloadT = rites && berserk ? 0.05 : c.st.reload; s.ammo = c.st.mag; }
  return true;
}

function pillarLine(c, n, step, dmg, burn) {
  const p = c.p;
  for (let i = 1; i <= n; i++) {
    c.g.addHazard({ x: p.x + c.aim.dx * i * step, z: p.z + c.aim.dz * i * step, r: 1.6, t: 0.12 + i * 0.07, dmg, kind: 'pillar', owner: 'player', color: COL.ember, burn });
  }
  c.g.audio.play('boom', 0.6);
}

function pull(g, pr, r, dmg, dt, strength) {
  pr.tickT = (pr.tickT || 0) - dt;
  const tick = pr.tickT <= 0;
  if (tick) pr.tickT = 0.3;
  g.forEnemiesNear(pr.x, pr.z, r, (e) => {
    if (!e.boss && !e.def.stationary) {
      const dx = pr.x - e.x, dz = pr.z - e.z, d = Math.hypot(dx, dz) || 1;
      e.kbx += (dx / d) * strength * dt * 1.6; e.kbz += (dz / d) * strength * dt * 1.6;
    }
    if (tick) strike(g, e, dmg, { source: 'void', color: COL.void, quiet: true, kb: 0 });
  });
  g.grassBlast(pr.x, pr.z, r, -0.6);
  for (let i = 0; i < 3; i++) {
    const a = Math.random() * TAU;
    g.particles.emit({ x: pr.x + Math.cos(a) * r, y: pr.y + (Math.random() - 0.5), z: pr.z + Math.sin(a) * r, vx: -Math.cos(a) * r * 2.2, vz: -Math.sin(a) * r * 2.2, life: 0.45, size: 0.1, color: COL.void, shape: SHAPE.SPARK });
  }
}

function iceShards(g, x, y, z, n, dmg) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    g.spawnProjectile({ kind: 'shard', x, y, z, vx: Math.sin(a) * 20, vy: 1, vz: Math.cos(a) * 20, dmg, pierce: 1, life: 0.4, color: COL.ice, r: 0.5, owner: 'player', freeze: 0.5 });
  }
  g.particles.burst(x, y, z, 18, { speed: 7, color: COL.ice, shape: SHAPE.CHUNK, size: 0.1, life: 0.6, grav: 12, additive: false });
}

function bloodMoon(c, dur, r, dmg, crimson) {
  const g = c.g;
  c.L_.add({
    t: dur, tick: 0, crimson,
    update(ent, dt) {
      const p = g.player;
      ent.tick -= dt;
      if (ent.tick <= 0) {
        ent.tick = 0.4;
        let healed = 0;
        const targets = [];
        g.forEnemiesNear(p.x, p.z, r, (e) => targets.push(e));
        for (const e of targets) {
          strike(g, e, dmg * power(g), { source: 'drain', color: COL.blood, quiet: true, kb: 0 });
          if (healed < 4) { healed += 0.6; g.lightning(p.x, p.y + 4.2, p.z, e.x, e.y + 1, e.z, COL.blood); }
        }
        heal(g, healed);
        if (crimson && targets.length) {
          for (let k = 0; k < 2; k++) {
            const e = targets[(Math.random() * targets.length) | 0];
            const dx = e.x - p.x, dz = e.z - p.z, l = Math.hypot(dx, dz) || 1;
            crescent(g, p.x, p.z, dx / l, dz / l, dmg * 2.5 * power(g), COL.blood);
          }
        }
      }
    },
    draw(ent, R) {
      const p = g.player;
      const y = p.y + 4.4 + Math.sin(g.time * 2) * 0.15;
      const s = crimson ? 1.1 : 0.75;
      R.ball(p.x, y, p.z, s, [0.9, 0.1, 0.15], 2.5, true);
      R.ball(p.x + s * 0.35, y + s * 0.15, p.z, s * 0.85, [0.1, 0.0, 0.03], 0, true);
      R.decal(p.x, p.y + 0.07, p.z, r, 0.85, 0.08, 0.15, 0.22, SHAPE.RING);
      R.light(p.x, y, p.z, r * 1.6, 1, 0.15, 0.2, 1.4);
    },
  });
  g.audio.play('portal', 0.6);
}

function afterimageDash(c, n, dmg) {
  const g = c.g, p = c.p;
  const dx = c.aim.dx, dz = c.aim.dz;
  const x0 = p.x, z0 = p.z;
  p.dash(dx, dz, 8, 0.22);
  for (let i = 0; i < n; i++) {
    const k = (i + 0.5) / n;
    c.L_.clone(x0 + dx * 8 * k, z0 + dz * 8 * k, dmg * power(g), 1, COL.shadow, 0.25 + i * 0.08);
  }
  g.audio.play('dodge');
}

function gravityCrush(c, r, dmg, horizon) {
  const g = c.g, p = c.p;
  g.forEnemiesNear(p.x, p.z, r, (e) => { if (!e.boss && !e.def.stationary) { const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz) || 1; e.kbx += (dx / d) * Math.min(22, d * 3.2); e.kbz += (dz / d) * Math.min(22, d * 3.2); } });
  g.grassBlast(p.x, p.z, r, -1.2);
  c.L_.add({
    t: 0.35,
    update() {},
    end() {
      g.shockwave(p.x, p.z, 5, COL.void, true);
      const hits = blast(g, p.x, p.z, 5.5, dmg * power(g), { source: 'gravity', color: COL.void, kb: 12, impact: true });
      for (const e of hits) if (e.alive && !e.boss) e.stagger(0.9);
      g.shake(0.8);
    },
  });
  g.audio.play('heavyWhoosh');
}

function phantomArms(c, n, dmg, dur) {
  const g = c.g;
  const arms = Array.from({ length: n }, (_, i) => ({ a: (i / n) * TAU, cd: i * 0.1, punch: 0, tx: 0, tz: 0 }));
  c.L_.add({
    t: dur,
    update(ent, dt) {
      const p = g.player;
      for (const arm of arms) {
        arm.a += dt * 2.2;
        arm.cd -= dt;
        arm.punch = Math.max(0, arm.punch - dt * 4);
        if (arm.cd <= 0) {
          const ax = p.x + Math.cos(arm.a) * 1.6, az = p.z + Math.sin(arm.a) * 1.6;
          const e = g.nearestEnemy(ax, az, 5);
          if (e) {
            arm.cd = 0.4; arm.punch = 1; arm.tx = e.x; arm.tz = e.z;
            strike(g, e, dmg * power(g), { source: 'phantom', color: COL.gold, kb: 6, fromX: ax, fromZ: az });
            g.particles.burst(e.x, e.y + 1, e.z, 8, { speed: 5, color: COL.gold, shape: SHAPE.SPARK, size: 0.06, life: 0.3 });
          } else arm.cd = 0.15;
        }
      }
    },
    draw(ent, R) {
      const p = g.player;
      for (const arm of arms) {
        const ax = p.x + Math.cos(arm.a) * 1.6, az = p.z + Math.sin(arm.a) * 1.6, ay = p.y + 2.1;
        const k = arm.punch;
        const fx = ax + (arm.tx - ax) * k * 0.85, fz = az + (arm.tz - az) * k * 0.85, fy = ay - k * 0.8;
        R.seg(p.x, p.y + 1.5, p.z, ax, ay, az, 0.07, [0.95, 0.75, 0.3], 1.4);
        R.seg(ax, ay, az, fx, fy, fz, 0.09, [0.95, 0.75, 0.3], 1.6);
        R.ball(fx, fy, fz, 0.22, [1, 0.85, 0.4], 2.2);
      }
      R.light(p.x, p.y + 2, p.z, 6, 1, 0.8, 0.4, 0.7);
    },
  });
  g.audio.play('portal', 0.5);
}

function orbitBlades(c, dt, n, r, dmg, color) {
  const g = c.g, p = c.p, s = c.s;
  s.orbA = (s.orbA || 0) + dt * 3.2;
  for (let i = 0; i < n; i++) {
    const a = s.orbA + (i / n) * TAU;
    const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    g.forEnemiesNear(x, z, 0.9, (e) => {
      if ((e._orbHit || 0) > g.time) return;
      e._orbHit = g.time + 0.45;
      strike(g, e, dmg, { source: 'orbital', color, kb: 4, fromX: p.x, fromZ: p.z });
    });
  }
}

// ------------------------------------------------------------------ Loadout
export class Loadout {
  constructor(game) {
    this.game = game;
    this.slots = { blade: null, arms: null, magic: null, power: null };
    this.ents = [];
    this.evolutions = 0;
  }

  get(slot) { return this.slots[slot]; }
  item(slot) { const s = this.slots[slot]; return s ? ITEMS[s.id] : null; }
  has(id) { return SLOTS.some((k) => this.slots[k] && this.slots[k].id === id); }
  levelOf(id) { for (const k of SLOTS) { const s = this.slots[k]; if (s && s.id === id) return s.level; } return 0; }

  /** Put an item into its slot (replacing whatever was there) at a level. */
  equip(id, level = 1) {
    const def = ITEMS[id];
    this.slots[def.slot] = { id, level: def.evolved ? MAX_LEVEL : Math.min(MAX_LEVEL, level), cd: 0, state: {} };
    if (def.slot === 'blade') this.game.player.refreshBlade();
  }

  levelUp(id, n = 1) {
    for (const k of SLOTS) {
      const s = this.slots[k];
      if (s && s.id === id && !ITEMS[id].evolved) {
        s.level = Math.min(MAX_LEVEL, s.level + n);
        if (k === 'blade') this.game.player.refreshBlade();
      }
    }
  }

  /** Recipes whose base is at its evolution level and whose partner is equipped. */
  readyEvolutions(discount = 0) {
    return RECIPES.filter((r) => this.has(r.base) && this.has(r.with) && this.levelOf(r.base) >= MAX_LEVEL - discount && !this.has(r.into));
  }

  evolve(recipe) {
    this.equip(recipe.into);
    this.evolutions++;
    const g = this.game, p = g.player;
    g.shockwave(p.x, p.z, 6, hex(recipe.color), true);
    g.impact(2);
  }

  /** Per-item stats at the current level. */
  stats(slot) {
    const s = this.slots[slot];
    return s ? ITEMS[s.id].stats(s.level) : null;
  }

  ctx(slot) {
    const s = this.slots[slot];
    const g = this.game;
    return { g, p: g.player, s: s.state, level: s.level, st: ITEMS[s.id].stats(s.level), L_: this, aim: g.aim(30), slot: s };
  }

  cdMul(slot) {
    const p = this.game.player;
    let m = slot === 'magic' || slot === 'power' ? p.stats.cdMul : 1;
    if (slot === 'arms' && p.buffs.berserkT > 0) m *= 0.75;
    return m;
  }

  /** Arcana and Power: press to cast when off cooldown. Returns true when cast. */
  trigger(slot) {
    const s = this.slots[slot];
    if (!s || s.cd > 0) return false;
    const def = ITEMS[s.id];
    const c = this.ctx(slot);
    def.cast(c);
    s.cd = c.st.cd * this.cdMul(slot);
    s.max = s.cd;
    this.game.player.castPose();
    return true;
  }

  update(dt, input, canFire) {
    const g = this.game, p = g.player;
    for (const k of SLOTS) {
      const s = this.slots[k];
      if (!s) continue;
      if (s.cd > 0) s.cd -= dt;
      if (s.state.reloadT > 0) s.state.reloadT -= dt;
      const def = ITEMS[s.id];
      if (def.passive) def.passive(this.ctx(k), dt);
    }
    // held fire for Arms
    const a = this.slots.arms;
    if (a && canFire && input.held('arms') && a.cd <= 0) {
      const def = ITEMS[a.id];
      const c = this.ctx('arms');
      const fired = def.fire(c);
      if (fired !== false) {
        a.cd = c.st.cd * this.cdMul('arms') / p.stats.atkSpeed;
        a.max = a.cd;
        p.aimPose(c.aim);
        if (a.id !== 'revolver' && a.id !== 'lastrites') g.audio.play('whoosh', 0.45);
      }
    }
    // berserk aura
    const b = p.buffs;
    if (b.berserkT > 0) {
      b.berserkT -= dt;
      b.auraT = (b.auraT || 0) - dt;
      if (b.auraT <= 0) {
        b.auraT = 0.5;
        g.forEnemiesNear(p.x, p.z, 3.2, (e) => strike(g, e, (b.berserkDps || 6) * 0.5 * p.stats.dmgMul, { source: 'aura', color: COL.ember, quiet: true, kb: 1 }));
      }
      if (Math.random() < 0.7) g.particles.emit({ x: p.x + (Math.random() - 0.5) * 1.6, y: p.y + Math.random() * 2, z: p.z + (Math.random() - 0.5) * 1.6, vy: 3, life: 0.5, size: 0.25, size1: 0.02, color: COL.ember, shape: SHAPE.GLOW });
    }
    // summons and lingering effects
    for (const e of this.ents) {
      e.t -= dt;
      if (e.delay > 0) { e.delay -= dt; continue; }
      if (e.update) e.update(e, dt);
      if (e.t <= 0 && e.end) e.end(e);
    }
    this.ents = this.ents.filter((e) => e.t > 0);
  }

  // ---- hooks from melee resolution
  bladeCtx() { return this.slots.blade ? this.ctx('blade') : null; }

  onSwing(move, idx, hits) {
    const def = this.item('blade');
    if (def && def.onSwing) def.onSwing(this.bladeCtx(), move, idx, hits);
  }

  onHit(e, info) {
    const def = this.item('blade');
    if (def && def.onHit && (info.source === 'melee')) def.onHit(this.bladeCtx(), e, info);
  }

  onKill(e, info) {
    const def = this.item('blade');
    if (def && def.onKill && info && info.source === 'melee') def.onKill(this.bladeCtx(), e);
    else if (def && def.onKill && def.evolved && e.iceT > 0) def.onKill(this.bladeCtx(), e);
  }

  // ---- lingering effect builders
  add(ent) { this.ents.push(ent); return ent; }

  sigil(x, z, r, color, delay, onFire) {
    const g = this.game;
    this.add({ t: delay, x, z, update() {}, end: onFire, draw(ent, R) {
      const y = g.world.height(x, z) + 0.08;
      const k = 1 - Math.max(0, ent.t) / delay;
      R.decal(x, y, z, r, color[0], color[1], color[2], 0.7, SHAPE.RING, g.time * 3);
      R.decal(x, y, z, r * 0.6, color[0], color[1], color[2], 0.5, 4, -g.time * 4);
      R.decal(x, y, z, r * k, color[0], color[1], color[2], 0.3, 0);
    } });
  }

  ring(x, z, r, dur, color, onTouch) {
    const g = this.game;
    const hit = new Set();
    this.add({ t: dur, update(ent) {
      const rad = r * (1 - Math.max(0, ent.t) / dur);
      g.forEnemiesNear(x, z, rad, (e) => { if (!hit.has(e)) { hit.add(e); onTouch(e); } });
      g.grassBlast(x, z, rad + 1, 1);
    }, draw(ent, R) {
      const rad = r * (1 - Math.max(0, ent.t) / dur);
      const y = g.world.height(x, z) + 0.1;
      R.decal(x, y, z, rad, color[0], color[1], color[2], 0.9, SHAPE.RING);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + rad * 0.3;
        R.segPrim(PRIM.OCTA, x + Math.cos(a) * rad, y, z + Math.sin(a) * rad, x + Math.cos(a) * rad * 1.02, y + 0.9, z + Math.sin(a) * rad * 1.02, 0.18, color, 1.2);
      }
    } });
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * TAU;
      g.particles.emit({ x, y: g.world.height(x, z) + 0.3, z, vx: Math.cos(a) * r * 2.4, vy: 1.5, vz: Math.sin(a) * r * 2.4, life: 0.5, size: 0.2, color, shape: SHAPE.STAR, drag: 2.5 });
    }
  }

  beam(x0, y0, z0, x1, y1, z1, color, dur) {
    this.add({ t: dur, update() {}, draw(ent, R) {
      const w = 0.1 + (ent.t / dur) * 0.35;
      R.seg(x0, y0, z0, x1, y1, z1, w, color, 4);
      R.seg(x0, y0, z0, x1, y1, z1, w * 0.4, [1, 1, 1], 5);
      R.light((x0 + x1) / 2, y0, (z0 + z1) / 2, 14, color[0], color[1], color[2], 2);
    } });
  }

  /** A shadow clone that appears at (x, z), slashes `hitsN` times around itself and fades. */
  clone(x, z, dmg, hitsN, color, delay = 0) {
    const g = this.game, p = g.player;
    const pts = new Float32Array(p.anim.pts);
    const dx = x - p.x, dz = z - p.z;
    for (let i = 0; i < pts.length; i += 3) { pts[i] += dx; pts[i + 2] += dz; pts[i + 1] += g.world.height(x, z) - p.y; }
    const pal = [{ c: [0.12, 0.05, 0.25], e: 1.4 }];
    let n = 0;
    this.add({ t: 0.7 + hitsN * 0.12, delay, cd: 0.05, update(ent, dt) {
      ent.cd -= dt;
      if (ent.cd <= 0 && n < hitsN) {
        n++; ent.cd = 0.12;
        g.forEnemiesNear(x, z, 2.6, (e) => strike(g, e, dmg, { source: 'clone', color, kb: 4, fromX: x, fromZ: z }));
        g.particles.burst(x, g.world.height(x, z) + 1, z, 10, { speed: 7, color, shape: SHAPE.SPARK, size: 0.07, life: 0.3 });
        g.audio.play('whoosh', 0.5);
      }
    }, draw(ent, R) {
      if (ent.delay > 0) return;
      drawRig(R, p.topo, pts, pal, 0, 1);
      if (Math.random() < 0.6) {
        const i = ((Math.random() * 16) | 0) * 3;
        g.particles.emit({ x: pts[i], y: pts[i + 1], z: pts[i + 2], vy: 1, life: 0.4, size: 0.2, size1: 0, color, shape: SHAPE.GLOW, alpha: 0.6 });
      }
    } });
  }

  draw(R) {
    const g = this.game, p = g.player;
    for (const e of this.ents) if (e.draw && !(e.delay > 0)) e.draw(e, R);
    // orbiting halos (Clockwork Halo)
    const a = this.slots.arms;
    if (a && a.id === 'clockwork') {
      for (let i = 0; i < 2; i++) {
        const ang = (a.state.orbA || 0) + i * Math.PI;
        const x = p.x + Math.cos(ang) * 2.6, z = p.z + Math.sin(ang) * 2.6;
        drawChakram(R, x, p.y + 1.1, z, g.time * 14, COL.gold);
      }
    }
    if (p.buffs.berserkT > 0) R.light(p.x, p.y + 1, p.z, 6, 1, 0.4, 0.1, 1.2);
  }
}

// ------------------------------------------------------------------ projectile visuals
export function drawChakram(R, x, y, z, spin, color) {
  for (let i = 0; i < 6; i++) {
    const a = spin + (i / 6) * TAU, b = a + TAU / 6;
    R.seg(x + Math.cos(a) * 0.45, y, z + Math.sin(a) * 0.45, x + Math.cos(b) * 0.45, y, z + Math.sin(b) * 0.45, 0.05, color, 1.5);
    R.segPrim(PRIM.CONE, x + Math.cos(a) * 0.45, y, z + Math.sin(a) * 0.45, x + Math.cos(a + 0.4) * 0.7, y, z + Math.sin(a + 0.4) * 0.7, 0.07, color, 1.2);
  }
}

/** Draw an arsenal projectile; returns false for kinds this module doesn't own. */
export function drawProjectile(R, pr, g) {
  const c = pr.color;
  const l = Math.hypot(pr.vx, pr.vy, pr.vz) || 1;
  const ux = pr.vx / l, uy = pr.vy / l, uz = pr.vz / l;
  switch (pr.kind) {
    case 'wave': {
      // a flat crescent of light perpendicular to travel
      const px = -uz, pz = ux, w = pr.r;
      for (let i = -3; i <= 3; i++) {
        const k = i / 3, bend = (1 - k * k) * 0.5;
        const ax = pr.x + px * w * k + ux * bend, az = pr.z + pz * w * k + uz * bend;
        const k2 = (i + 1) / 3, bend2 = (1 - k2 * k2) * 0.5;
        if (i < 3) R.seg(ax, pr.y, az, pr.x + px * w * k2 + ux * bend2, pr.y, pr.z + pz * w * k2 + uz * bend2, 0.09 * (1 - Math.abs(k) * 0.6), c, 3);
      }
      return true;
    }
    case 'seal':
      R.trs(PRIM.BOX, pr.x, pr.y, pr.z, g.time * 9, 0.3, 0, 0.16, 0.3, 0.02, c, 1.2);
      R.trs(PRIM.BOX, pr.x, pr.y, pr.z, g.time * 9, 0.3, 0, 0.04, 0.2, 0.03, [0.85, 0.1, 0.1], 0.8);
      return true;
    case 'arrow':
    case 'bullet':
    case 'kunai': {
      const len = pr.kind === 'arrow' ? 0.9 : pr.kind === 'bullet' ? 0.6 : 0.4;
      R.segPrim(PRIM.OCTA, pr.x - ux * len, pr.y - uy * len, pr.z - uz * len, pr.x, pr.y, pr.z, pr.kind === 'kunai' ? 0.07 : 0.05, c, 3);
      return true;
    }
    case 'lance':
    case 'shard':
    case 'fist': {
      const len = pr.kind === 'lance' ? 1.4 : pr.kind === 'fist' ? 0.4 : 0.5;
      if (pr.kind === 'fist') R.ball(pr.x, pr.y, pr.z, 0.28, c, 2.2);
      else R.segPrim(PRIM.OCTA, pr.x - ux * len, pr.y - uy * len, pr.z - uz * len, pr.x + ux * 0.3, pr.y + uy * 0.3, pr.z + uz * 0.3, pr.kind === 'lance' ? 0.16 : 0.08, c, 2);
      return true;
    }
    case 'chakram':
      drawChakram(R, pr.x, pr.y, pr.z, g.time * 16, c);
      return true;
    case 'orb': {
      const s = pr.big ? 1.6 : 0.6;
      R.ball(pr.x, pr.y, pr.z, s + Math.sin(g.time * 12) * 0.05, [0.02, 0, 0.04], 0);
      R.decal(pr.x, g.world.height(pr.x, pr.z) + 0.08, pr.z, pr.big ? 10 : 4.5, 0.5, 0.25, 1, 0.35, SHAPE.RING, g.time);
      R.light(pr.x, pr.y, pr.z, pr.big ? 16 : 8, 0.5, 0.2, 1, 1.6);
      return true;
    }
    case 'wisp':
      R.ball(pr.x, pr.y, pr.z, 0.2, c, 3);
      return true;
    default:
      return false;
  }
}

function hex(h) {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
