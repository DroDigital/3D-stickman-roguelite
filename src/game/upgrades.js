// Level-up / chest reward table: arsenal items (new, level-up, replace), ready evolutions and passive stats.
import { RARITY, rollRarity } from './config.js';
import { ITEMS, ITEM_IDS, SLOTS, SLOT_INFO, MAX_LEVEL, RECIPES, recipesFor } from './arsenal.js';

import { L } from '../core/i18n.js';

const pct = (v) => `${Math.round(v * 100)}%`;
const num = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toString();

// Passive stats. Magnitudes are deliberately modest: the arsenal carries most of a build's power.
export const UPGRADES = [
  { id: 'might', name: 'Abyssal Might', kind: 'stat', icon: '⚔', base: 0.06, desc: (v) => L('+{v} damage', { v: pct(v) }), apply: (s, v) => { s.dmgMul += v; } },
  { id: 'fervor', name: 'Fervor', kind: 'stat', icon: '⚡', base: 0.05, desc: (v) => L('+{v} attack and fire rate', { v: pct(v) }), apply: (s, v) => { s.atkSpeed += v; } },
  { id: 'swift', name: 'Swiftness', kind: 'stat', icon: '➶', base: 0.04, desc: (v) => L('+{v} movement speed', { v: pct(v) }), apply: (s, v) => { s.moveSpeed *= 1 + v; } },
  { id: 'vigor', name: 'Ichor Vigor', kind: 'stat', icon: '❤', base: 12, desc: (v) => L('+{hp} max health, heal {heal}', { hp: Math.round(v), heal: Math.round(v * 2) }), apply: (s, v, p) => { s.maxHp += v; p.hp = Math.min(s.maxHp, p.hp + v * 2); } },
  { id: 'thirst', name: 'Sanguine Thirst', kind: 'stat', icon: '🩸', base: 0.008, desc: (v) => L('Heal {v}% of blade damage dealt', { v: num(v * 100) }), apply: (s, v) => { s.lifesteal += v; } },
  { id: 'precision', name: 'Third Eye', kind: 'stat', icon: '👁', base: 0.03, desc: (v) => L('+{v} critical chance', { v: pct(v) }), apply: (s, v) => { s.critChance += v; } },
  { id: 'brutality', name: 'Brutality', kind: 'stat', icon: '☠', base: 0.12, desc: (v) => L('+{v} critical damage', { v: pct(v) }), apply: (s, v) => { s.critMul += v; } },
  { id: 'reach', name: 'Long Shadow', kind: 'stat', icon: '↔', base: 0.05, desc: (v) => L('+{v} blade reach and effect area', { v: pct(v) }), apply: (s, v) => { s.reach += v; s.areaMul += v; } },
  { id: 'magnet', name: 'Soul Gravity', kind: 'stat', icon: '◎', base: 0.8, desc: (v) => L('+{v} m pickup radius', { v: num(v) }), apply: (s, v) => { s.magnet += v; } },
  { id: 'fortune', name: 'Hollow Fortune', kind: 'stat', icon: '✧', base: 0.06, desc: (v) => L('+{v} luck and shards', { v: pct(v) }), apply: (s, v) => { s.luck += v; s.shardMul += v; } },
  { id: 'carapace', name: 'Chitin Carapace', kind: 'stat', icon: '⛨', base: 0.03, desc: (v) => L('{v} damage reduction', { v: pct(v) }), apply: (s, v) => { s.armor = 1 - (1 - s.armor) * (1 - v); } },
  { id: 'focus', name: 'Arcane Focus', kind: 'stat', icon: '✺', base: 0.05, desc: (v) => L('-{v} Arcana and Power cooldowns', { v: pct(v) }), apply: (s, v) => { s.cdMul *= 1 - v; } },
  { id: 'regen', name: 'Black Blood', kind: 'stat', icon: '✚', base: 0.25, desc: (v) => L('+{v} health regenerated per second', { v: num(v, 2) }), apply: (s, v) => { s.regen += v; } },
  { id: 'wisdom', name: 'Forbidden Wisdom', kind: 'stat', icon: '✎', base: 0.06, desc: (v) => L('+{v} experience gained', { v: pct(v) }), apply: (s, v) => { s.xpMul += v; } },
  { id: 'phase', name: 'Phase Step', kind: 'stat', icon: '⇋', base: 0.06, desc: (v) => L('-{v} dodge cooldown', { v: pct(v) }), apply: (s, v) => { s.dodgeCd *= 1 - v; } },
  { id: 'stride', name: 'Gale Stride', kind: 'stat', icon: '≫', base: 0.06, desc: (v) => L('+{v} sprint speed', { v: pct(v) }), apply: (s, v) => { s.sprintMul += v; } },
  { id: 'thorns', name: 'Thorned Hide', kind: 'stat', icon: '✴', base: 5, desc: (v) => L('Attackers take {v} damage', { v: Math.round(v) }), apply: (s, v) => { s.thorns += v; } },
];

export const UPGRADE_BY_ID = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

/** Marks for an item: every recipe it takes part in, flagged when the partner is already owned. */
export function itemMarks(id, loadout) {
  return recipesFor(id).map((r) => {
    const partner = r.base === id ? r.with : r.base;
    return { mark: r.mark, color: r.color, into: L(ITEMS[r.into].name), partner: L(ITEMS[partner].name), owned: !!(loadout && loadout.has(partner)), asBase: r.base === id };
  });
}

function itemOffer(id, rarity, loadout, mode) {
  const def = ITEMS[id];
  const cur = mode === 'level' ? loadout.levelOf(id) : 0;
  const gain = mode === 'level' ? (rarity >= 4 ? 2 : 1) : rarity >= 3 ? 2 : 1;
  const next = Math.min(MAX_LEVEL, cur + gain);
  return {
    kind: 'item', mode, id, slot: def.slot, rarity, name: L(def.name), icon: def.icon,
    desc: mode === 'level' ? L('Lv {cur} → {next}: {effect}', { cur, next, effect: def.lvDesc(next) }) : L('{desc} Lv {next}: {effect}', { desc: L(def.desc), next, effect: def.lvDesc(next) }),
    level: cur, next, gain, color: RARITY[rarity].hex, marks: itemMarks(id, loadout),
    replaces: mode === 'replace' ? L(ITEMS[loadout.get(def.slot).id].name) : null,
  };
}

function evolveOffer(recipe) {
  const def = ITEMS[recipe.into];
  return {
    kind: 'evolve', id: recipe.into, recipe, slot: def.slot, rarity: RARITY.length - 1, name: L(def.name), icon: def.icon,
    desc: L(def.desc), color: recipe.color, from: L(ITEMS[recipe.base].name), with: L(ITEMS[recipe.with].name), mark: recipe.mark,
  };
}

/** Stat offer: magnitude scales with rarity. */
export function makeOffer(up, rarity, player) {
  const v = up.base * RARITY[rarity].mul;
  return { kind: up.kind, id: up.id, rarity, value: v, name: L(up.name), icon: up.icon, desc: up.desc(v), color: RARITY[rarity].hex };
}

/**
 * Roll n distinct offers. Ready evolutions always come first; then a weighted mix of new items for empty
 * slots, level-ups for owned items, rare replacements and passive stats. opts: {luck, minTier, itemChance}
 */
export function rollOffers(rng, player, n = 3, opts = {}) {
  const luck = opts.luck ?? 0;
  const LO = player.loadout;
  const offers = [];
  const used = new Set();
  for (const r of LO.readyEvolutions(player.stats.evoDiscount || 0)) {
    if (offers.length >= n || used.has(r.base)) continue;
    used.add(r.base);
    used.add(r.into);
    offers.push(evolveOffer(r));
  }
  const itemW = opts.itemChance ?? 1;
  const cands = [];
  for (const slot of SLOTS) {
    const s = LO.get(slot);
    const pool = ITEM_IDS.filter((id) => ITEMS[id].slot === slot);
    if (!s) for (const id of pool) cands.push({ w: 2.2 * itemW / pool.length * 2, make: (rar) => itemOffer(id, rar, LO, 'new'), key: id });
    else {
      if (!ITEMS[s.id].evolved && s.level < MAX_LEVEL) cands.push({ w: 2.6 * itemW, make: (rar) => itemOffer(s.id, rar, LO, 'level'), key: s.id });
      for (const id of pool) if (id !== s.id) cands.push({ w: 0.25 * itemW / pool.length * 2, make: (rar) => itemOffer(id, rar, LO, 'replace'), key: id });
    }
  }
  for (const up of UPGRADES) cands.push({ w: 0.75, make: (rar) => makeOffer(up, rar, player), key: up.id });
  while (offers.length < n) {
    const avail = cands.filter((c) => !used.has(c.key));
    if (!avail.length) break;
    const c = rng.weighted(avail, (x) => x.w);
    used.add(c.key);
    offers.push(c.make(rollRarity(rng, luck, opts.minTier ?? 0)));
  }
  return offers;
}

/** Apply a chosen offer to the player. Returns a short announcement or null. */
export function applyOffer(player, offer) {
  const LO = player.loadout;
  if (offer.kind === 'evolve') {
    LO.evolve(offer.recipe);
    return L('{name} awakened', { name: offer.name });
  }
  if (offer.kind === 'item') {
    if (offer.mode === 'level') { LO.levelUp(offer.id, offer.gain); return null; }
    LO.equip(offer.id, offer.next);
    return L('{name} equipped', { name: offer.name });
  }
  const up = UPGRADE_BY_ID[offer.id];
  up.apply(player.stats, offer.value, player);
  player.taken[offer.id] = (player.taken[offer.id] || 0) + 1;
  return null;
}

export { RECIPES, SLOT_INFO };
