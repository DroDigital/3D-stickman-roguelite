// Meta progression: the Ossuary of Echoes skill tree, persistence and full respec.

const SAVE_KEY = 'abyssal-stride-save-v1';

// Positions are in tree-space units (center 0,0). Branches radiate: Body (N), Blade (E), Mind (S), Rift (W).
export const SKILLS = [
  { id: 'core', name: 'Awakened Husk', branch: 'core', max: 1, cost: [0], pos: [0, 0], req: [], desc: () => 'Your descent begins here.', apply: () => {} },

  // Body — north
  { id: 'vital1', name: 'Ichor Veins', branch: 'body', max: 5, cost: [20, 35, 55, 80, 110], pos: [0, -1], req: ['core'], desc: (r) => `+${r * 10} max health`, apply: (s, r) => { s.maxHp += r * 10; } },
  { id: 'regen1', name: 'Clotting Hunger', branch: 'body', max: 3, cost: [40, 80, 140], pos: [-0.8, -1.7], req: ['vital1'], desc: (r) => `+${(r * 0.3).toFixed(1)} health regen`, apply: (s, r) => { s.regen += r * 0.3; } },
  { id: 'armor1', name: 'Bone Lattice', branch: 'body', max: 4, cost: [45, 80, 125, 180], pos: [0.8, -1.7], req: ['vital1'], desc: (r) => `${r * 3}% damage reduction`, apply: (s, r) => { s.armor = 1 - (1 - s.armor) * (1 - r * 0.03); } },
  { id: 'vital2', name: 'Leviathan Heart', branch: 'body', max: 3, cost: [120, 200, 300], pos: [0, -2.4], req: ['regen1', 'armor1'], any: true, desc: (r) => `+${r * 25} max health`, apply: (s, r) => { s.maxHp += r * 25; } },
  { id: 'revive', name: 'Second Breath', branch: 'body', max: 1, cost: [400], pos: [0, -3.3], req: ['vital2'], desc: () => 'Once per run, rise again at half health', apply: (s, r) => { s.revives += r; } },
  { id: 'thorns1', name: 'Barbed Flesh', branch: 'body', max: 3, cost: [60, 110, 170], pos: [1.5, -2.6], req: ['armor1'], desc: (r) => `Attackers take ${r * 6} damage`, apply: (s, r) => { s.thorns += r * 6; } },

  // Blade — east
  { id: 'might1', name: 'Honed Malice', branch: 'blade', max: 5, cost: [25, 40, 60, 90, 130], pos: [1, 0], req: ['core'], desc: (r) => `+${r * 5}% damage`, apply: (s, r) => { s.dmgMul += r * 0.05; } },
  { id: 'speed1', name: 'Quickened Sinew', branch: 'blade', max: 4, cost: [40, 70, 110, 160], pos: [1.7, -0.8], req: ['might1'], desc: (r) => `+${r * 4}% attack speed`, apply: (s, r) => { s.atkSpeed += r * 0.04; } },
  { id: 'crit1', name: 'Vivisectionist', branch: 'blade', max: 4, cost: [45, 80, 120, 170], pos: [1.7, 0.8], req: ['might1'], desc: (r) => `+${r * 3}% critical chance`, apply: (s, r) => { s.critChance += r * 0.03; } },
  { id: 'brut1', name: 'Rending Edge', branch: 'blade', max: 3, cost: [90, 150, 230], pos: [2.5, 0.9], req: ['crit1'], desc: (r) => `+${r * 20}% critical damage`, apply: (s, r) => { s.critMul += r * 0.2; } },
  { id: 'arsenal', name: 'Reliquary Arsenal', branch: 'blade', max: 1, cost: [250], pos: [2.5, -0.9], req: ['speed1'], desc: () => 'Begin each run with a random Uncommon weapon', apply: (s, r) => { s.startWeapon = r; } },
  { id: 'combo1', name: 'Crescendo', branch: 'blade', max: 3, cost: [100, 170, 260], pos: [3.3, 0], req: ['brut1', 'arsenal'], any: true, desc: (r) => `+${(r * 0.4).toFixed(1)}% damage per combo hit`, apply: (s, r) => { s.comboDmg += r * 0.004; } },

  // Mind — south
  { id: 'xp1', name: 'Whispering Skull', branch: 'mind', max: 5, cost: [20, 35, 55, 80, 110], pos: [0, 1], req: ['core'], desc: (r) => `+${r * 6}% experience`, apply: (s, r) => { s.xpMul += r * 0.06; } },
  { id: 'reroll1', name: 'Fate Weaver', branch: 'mind', max: 3, cost: [60, 120, 200], pos: [-0.8, 1.7], req: ['xp1'], desc: (r) => `+${r} level-up reroll${r > 1 ? 's' : ''} per run`, apply: (s, r) => { s.rerolls += r; } },
  { id: 'luck1', name: 'Omen Reader', branch: 'mind', max: 4, cost: [50, 90, 140, 200], pos: [0.8, 1.7], req: ['xp1'], desc: (r) => `+${r * 6}% luck (rarer offers)`, apply: (s, r) => { s.luck += r * 0.06; } },
  { id: 'magnet1', name: 'Soul Siphon', branch: 'mind', max: 3, cost: [30, 60, 100], pos: [-1.5, 2.6], req: ['reroll1'], desc: (r) => `+${r}m pickup radius`, apply: (s, r) => { s.magnet += r; } },
  { id: 'insight', name: 'Clairvoyance', branch: 'mind', max: 1, cost: [350], pos: [0, 2.5], req: ['reroll1', 'luck1'], any: true, desc: () => 'Level-ups offer 4 choices instead of 3', apply: (s, r) => { s.extraChoice = r; } },
  { id: 'ult1', name: 'Rift Resonance', branch: 'mind', max: 3, cost: [70, 130, 210], pos: [0, 3.3], req: ['insight'], desc: (r) => `+${r * 20}% Rend Reality charge rate`, apply: (s, r) => { s.ultCharge += r * 0.2; } },

  // Rift — west
  { id: 'move1', name: 'Phantom Gait', branch: 'rift', max: 4, cost: [25, 45, 70, 100], pos: [-1, 0], req: ['core'], desc: (r) => `+${r * 4}% movement speed`, apply: (s, r) => { s.moveSpeed *= 1 + r * 0.04; } },
  { id: 'dodge1', name: 'Slipstream', branch: 'rift', max: 3, cost: [50, 90, 140], pos: [-1.7, -0.8], req: ['move1'], desc: (r) => `-${r * 8}% dodge cooldown`, apply: (s, r) => { s.dodgeCd *= 1 - r * 0.08; } },
  { id: 'shards1', name: 'Tithe of the Deep', branch: 'rift', max: 4, cost: [40, 70, 110, 160], pos: [-1.7, 0.8], req: ['move1'], desc: (r) => `+${r * 10}% shards, start with ${r * 15}`, apply: (s, r) => { s.shardMul += r * 0.1; s.startShards = (s.startShards || 0) + r * 15; } },
  { id: 'chest1', name: 'Lockbreaker', branch: 'rift', max: 3, cost: [70, 120, 190], pos: [-2.5, 0.9], req: ['shards1'], desc: (r) => `Loot containers cost ${r * 8}% less`, apply: (s, r) => { s.chestDiscount += r * 0.08; } },
  { id: 'counter1', name: 'Riposte Sense', branch: 'rift', max: 3, cost: [60, 110, 170], pos: [-2.5, -0.9], req: ['dodge1'], desc: (r) => `+${r * 1.5}m counter reach`, apply: (s, r) => { s.counterRange += r * 1.5; } },
  { id: 'lunge1', name: 'Freeflow Mastery', branch: 'rift', max: 3, cost: [90, 160, 250], pos: [-3.3, 0], req: ['counter1', 'chest1'], any: true, desc: (r) => `+${r * 2}m strike lunge range`, apply: (s, r) => { s.lungeRange += r * 2; } },
];

export const SKILL_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

export function defaultSave() {
  return {
    echoes: 0,
    ranks: { core: 1 },
    stats: { runs: 0, bestDepth: 0, kills: 0, bosses: 0, bestTime: 0 },
    settings: { quality: 432, volume: 0.6, sensitivity: 1, shake: 1, style: 'retro' },
  };
}

export class Meta {
  constructor(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
    this.storage = storage;
    this.data = this.load();
  }

  load() {
    try {
      const raw = this.storage && this.storage.getItem(SAVE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        const base = defaultSave();
        return { ...base, ...d, ranks: { ...base.ranks, ...d.ranks }, stats: { ...base.stats, ...d.stats }, settings: { ...base.settings, ...d.settings } };
      }
    } catch { /* corrupted or unavailable storage */ }
    return defaultSave();
  }

  save() {
    try { this.storage && this.storage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch { /* storage full or blocked */ }
  }

  rank(id) { return this.data.ranks[id] || 0; }

  nextCost(id) {
    const s = SKILL_BY_ID[id];
    const r = this.rank(id);
    return r >= s.max ? Infinity : s.cost[r];
  }

  isUnlocked(id) {
    const s = SKILL_BY_ID[id];
    if (!s.req.length) return true;
    return s.any ? s.req.some((q) => this.rank(q) > 0) : s.req.every((q) => this.rank(q) > 0);
  }

  canBuy(id) {
    return this.isUnlocked(id) && this.rank(id) < SKILL_BY_ID[id].max && this.data.echoes >= this.nextCost(id);
  }

  buy(id) {
    if (!this.canBuy(id)) return false;
    this.data.echoes -= this.nextCost(id);
    this.data.ranks[id] = this.rank(id) + 1;
    this.save();
    return true;
  }

  totalSpent() {
    let t = 0;
    for (const s of SKILLS) {
      const r = this.rank(s.id);
      for (let i = 0; i < r; i++) t += s.cost[i];
    }
    return t;
  }

  /** Full reset: refunds every echo spent. */
  reset() {
    const refund = this.totalSpent();
    this.data.echoes += refund;
    this.data.ranks = { core: 1 };
    this.save();
    return refund;
  }

  /** Apply all purchased ranks onto a stats object. */
  applyTo(stats) {
    for (const s of SKILLS) {
      const r = this.rank(s.id);
      if (r > 0) s.apply(stats, r);
    }
    return stats;
  }

  award(echoes) {
    this.data.echoes += Math.max(0, Math.floor(echoes));
    this.save();
  }
}

/** Echoes earned for a run summary. */
export function echoesForRun(r) {
  return Math.floor(r.kills * 0.35 + r.level * 6 + r.depth * 60 + r.bosses * 120 + r.time / 6 + r.chests * 4);
}
