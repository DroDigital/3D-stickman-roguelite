// Level-up / chest reward table. Every entry scales with rarity (RARITY[i].mul).
import { RARITY, rollRarity } from './config.js';
import { WEAPONS, WEAPON_IDS } from './weapons.js';

const pct = (v) => `${Math.round(v * 100)}%`;
const num = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toString();

export const UPGRADES = [
  // ---- stats
  { id: 'might', name: 'Abyssal Might', kind: 'stat', icon: '⚔', base: 0.1, desc: (v) => `+${pct(v)} damage`, apply: (s, v) => { s.dmgMul += v; } },
  { id: 'fervor', name: 'Fervor', kind: 'stat', icon: '⚡', base: 0.08, desc: (v) => `+${pct(v)} attack speed`, apply: (s, v) => { s.atkSpeed += v; } },
  { id: 'swift', name: 'Swiftness', kind: 'stat', icon: '➶', base: 0.06, desc: (v) => `+${pct(v)} movement speed`, apply: (s, v) => { s.moveSpeed *= 1 + v; } },
  { id: 'vigor', name: 'Ichor Vigor', kind: 'stat', icon: '❤', base: 20, desc: (v) => `+${Math.round(v)} max health, heal fully`, apply: (s, v, p) => { s.maxHp += v; p.hp = s.maxHp; } },
  { id: 'thirst', name: 'Sanguine Thirst', kind: 'stat', icon: '🩸', base: 0.015, desc: (v) => `Heal ${num(v * 100)}% of damage dealt`, apply: (s, v) => { s.lifesteal += v; } },
  { id: 'precision', name: 'Third Eye', kind: 'stat', icon: '👁', base: 0.04, desc: (v) => `+${pct(v)} critical chance`, apply: (s, v) => { s.critChance += v; } },
  { id: 'brutality', name: 'Brutality', kind: 'stat', icon: '☠', base: 0.18, desc: (v) => `+${pct(v)} critical damage`, apply: (s, v) => { s.critMul += v; } },
  { id: 'reach', name: 'Long Shadow', kind: 'stat', icon: '↔', base: 0.07, desc: (v) => `+${pct(v)} weapon reach and area`, apply: (s, v) => { s.reach += v; s.areaMul += v; } },
  { id: 'magnet', name: 'Soul Gravity', kind: 'stat', icon: '◎', base: 1.2, desc: (v) => `+${num(v)}m pickup radius`, apply: (s, v) => { s.magnet += v; } },
  { id: 'fortune', name: 'Hollow Fortune', kind: 'stat', icon: '✧', base: 0.08, desc: (v) => `+${pct(v)} luck and shards`, apply: (s, v) => { s.luck += v; s.shardMul += v; } },
  { id: 'carapace', name: 'Chitin Carapace', kind: 'stat', icon: '⛨', base: 0.045, desc: (v) => `${pct(v)} damage reduction`, apply: (s, v) => { s.armor = 1 - (1 - s.armor) * (1 - v); } },
  { id: 'momentum', name: 'Momentum', kind: 'stat', icon: '∞', base: 0.006, desc: (v) => `+${num(v * 100)}% damage per combo hit`, apply: (s, v) => { s.comboDmg += v; } },
  { id: 'regen', name: 'Black Blood', kind: 'stat', icon: '✚', base: 0.8, desc: (v) => `+${num(v)} health regenerated per second`, apply: (s, v) => { s.regen += v; } },
  { id: 'wisdom', name: 'Forbidden Wisdom', kind: 'stat', icon: '✎', base: 0.1, desc: (v) => `+${pct(v)} experience gained`, apply: (s, v) => { s.xpMul += v; } },
  { id: 'phase', name: 'Phase Step', kind: 'stat', icon: '⇋', base: 0.08, desc: (v) => `-${pct(v)} dodge cooldown`, apply: (s, v) => { s.dodgeCd *= 1 - v; } },
  { id: 'thorns', name: 'Thorned Hide', kind: 'stat', icon: '✴', base: 8, desc: (v) => `Attackers take ${Math.round(v)} damage`, apply: (s, v) => { s.thorns += v; } },

  // ---- abilities (power stacks)
  { id: 'orbitals', name: 'Void Orbitals', kind: 'ability', icon: '☄', base: 1, desc: (v, lvl) => `${lvl ? 'Empower' : 'Summon'} shards of void that orbit you (+${num(v)} power)`, apply: (s, v, p) => { p.ab.orbitals = (p.ab.orbitals || 0) + v; } },
  { id: 'chain', name: 'Starlight Arc', kind: 'ability', icon: 'ϟ', base: 1, desc: (v) => `Hits may arc lightning to nearby foes (+${num(v)} power)`, apply: (s, v, p) => { p.ab.chain = (p.ab.chain || 0) + v; } },
  { id: 'nova', name: 'Blood Nova', kind: 'ability', icon: '✺', base: 1, desc: (v) => `Kills may detonate in a bloody nova (+${num(v)} power)`, apply: (s, v, p) => { p.ab.nova = (p.ab.nova || 0) + v; } },
  { id: 'blades', name: 'Spectral Blades', kind: 'ability', icon: '⟁', base: 1, desc: (v) => `Periodically loose homing phantom blades (+${num(v)} power)`, apply: (s, v, p) => { p.ab.blades = (p.ab.blades || 0) + v; } },
  { id: 'entropy', name: 'Entropy Field', kind: 'ability', icon: '◌', base: 1, desc: (v) => `An aura that withers and slows nearby foes (+${num(v)} power)`, apply: (s, v, p) => { p.ab.entropy = (p.ab.entropy || 0) + v; } },
  { id: 'echo', name: 'Echo Strike', kind: 'ability', icon: '❖', base: 1, desc: (v) => `Attacks may repeat as a ghostly echo (+${num(v)} power)`, apply: (s, v, p) => { p.ab.echo = (p.ab.echo || 0) + v; } },
  { id: 'starfall', name: 'Starfall', kind: 'ability', icon: '✶', base: 1, desc: (v) => `Dying stars periodically crash into foes (+${num(v)} power)`, apply: (s, v, p) => { p.ab.starfall = (p.ab.starfall || 0) + v; } },
  { id: 'singularity', name: 'Singularity', kind: 'ability', icon: '◉', base: 1, desc: (v) => `Heavy attacks open a devouring gravity well (+${num(v)} power)`, apply: (s, v, p) => { p.ab.singularity = (p.ab.singularity || 0) + v; } },
  { id: 'emberstep', name: 'Ember Step', kind: 'ability', icon: '♨', base: 1, desc: (v) => `Dodging leaves a trail of hellfire (+${num(v)} power)`, apply: (s, v, p) => { p.ab.emberstep = (p.ab.emberstep || 0) + v; } },
  { id: 'gaze', name: 'Eldritch Gaze', kind: 'ability', icon: '⊙', base: 1, desc: (v) => `A floating eye sears foes with a beam (+${num(v)} power)`, apply: (s, v, p) => { p.ab.gaze = (p.ab.gaze || 0) + v; } },
];

export const UPGRADE_BY_ID = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

/** Build a concrete offer: {kind, id, rarity, value, name, icon, desc, color}. */
export function makeOffer(up, rarity, player) {
  if (up.kind === 'weapon') {
    const def = WEAPONS[up.weapon];
    return {
      kind: 'weapon', id: 'w_' + up.weapon, weapon: up.weapon, rarity,
      name: def.name, icon: def.icon,
      desc: `${def.desc} Tier ${rarity + 1} model and effects.`,
      color: RARITY[rarity].hex,
    };
  }
  const v = up.base * RARITY[rarity].mul;
  const lvl = up.kind === 'ability' ? player?.ab?.[up.id] || 0 : 0;
  return { kind: up.kind, id: up.id, rarity, value: v, name: up.name, icon: up.icon, desc: up.desc(v, lvl), color: RARITY[rarity].hex, level: lvl };
}

/**
 * Roll n distinct offers. opts: {luck, minTier, weaponChance}
 */
export function rollOffers(rng, player, n = 3, opts = {}) {
  const luck = opts.luck ?? 0;
  const pool = UPGRADES.filter((u) => !(u.kind === 'ability' && (player?.ab?.[u.id] || 0) >= 8));
  const offers = [];
  const used = new Set();
  const weaponChance = opts.weaponChance ?? 0.16;
  for (let i = 0; i < n; i++) {
    const rarity = rollRarity(rng, luck, opts.minTier ?? 0);
    if (rng.chance(weaponChance) && !used.has('weapon')) {
      const choices = WEAPON_IDS.filter((w) => !(player && player.weapon && player.weapon.type === w && player.weapon.tier >= rarity));
      if (choices.length) {
        used.add('weapon');
        offers.push(makeOffer({ kind: 'weapon', weapon: rng.pick(choices) }, rarity, player));
        continue;
      }
    }
    let up = null;
    for (let tries = 0; tries < 30 && !up; tries++) {
      const cand = rng.pick(pool);
      if (!used.has(cand.id)) up = cand;
    }
    if (!up) break;
    used.add(up.id);
    offers.push(makeOffer(up, rarity, player));
  }
  return offers;
}

/** Apply a chosen offer to the player. Returns true when a weapon swap happened. */
export function applyOffer(player, offer) {
  if (offer.kind === 'weapon') {
    player.equip(offer.weapon, offer.rarity);
    return true;
  }
  const up = UPGRADE_BY_ID[offer.id];
  up.apply(player.stats, offer.value, player);
  player.taken[offer.id] = (player.taken[offer.id] || 0) + 1;
  return false;
}
