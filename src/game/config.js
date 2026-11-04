// Shared tuning tables.

export const RARITY = [
  { id: 'common', name: 'Common', color: [0.78, 0.78, 0.82], hex: '#c4c4cc', weight: 56, mul: 1 },
  { id: 'uncommon', name: 'Uncommon', color: [0.35, 0.92, 0.45], hex: '#5ae672', weight: 26, mul: 1.25 },
  { id: 'rare', name: 'Rare', color: [0.3, 0.6, 1.0], hex: '#4c9bff', weight: 11.5, mul: 1.55 },
  { id: 'epic', name: 'Epic', color: [0.78, 0.36, 1.0], hex: '#c05cff', weight: 4.5, mul: 1.9 },
  { id: 'legendary', name: 'Legendary', color: [1.0, 0.66, 0.15], hex: '#ffa826', weight: 1.6, mul: 2.4 },
  { id: 'eldritch', name: 'Eldritch', color: [0.2, 1.0, 0.85], hex: '#33ffd9', weight: 0.35, mul: 3.0 },
];

/** Roll a rarity index. luck >= 0 shifts weight toward higher tiers; minTier clamps the floor. */
export function rollRarity(rng, luck = 0, minTier = 0, maxTier = RARITY.length - 1) {
  const items = [];
  for (let i = minTier; i <= maxTier; i++) {
    items.push({ i, weight: RARITY[i].weight * Math.pow(1 + luck, i) });
  }
  return rng.weighted(items).i;
}

// Deliberately lean: the run has to earn its power through the arsenal.
export const PLAYER_BASE = {
  maxHp: 90,
  moveSpeed: 6.6,
  sprintMul: 1,
  dmgMul: 1,
  atkSpeed: 1,
  critChance: 0.04,
  critMul: 1.6,
  lifesteal: 0,
  armor: 0,
  regen: 0.15,
  magnet: 2.6,
  luck: 0,
  reach: 1,
  xpMul: 0.65,
  shardMul: 1,
  dodgeCd: 0.8,
  knockback: 1,
  thorns: 0,
  ultCharge: 0.7,
  cdMul: 1,
  rerolls: 0,
  revives: 0,
  chestDiscount: 0,
  areaMul: 1,
  evoDiscount: 0,
};

export const WORLD_SIZE = 300;
export const ARENA_RADIUS = 40;
