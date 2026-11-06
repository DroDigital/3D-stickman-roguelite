import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RNG } from '../src/core/rng.js';
import { RARITY, rollRarity, PLAYER_BASE } from '../src/game/config.js';
import { rollOffers, applyOffer, UPGRADES } from '../src/game/upgrades.js';
import { Meta, SKILLS, SKILL_BY_ID, echoesForRun } from '../src/game/meta.js';
import { makeWeapon, WEAPONS } from '../src/game/weapons.js';
import { solveHumanoid, makePose, STANCE, CLIPS, sampleClip, J, HumanoidAnimator, tickAnimClock } from '../src/game/humanoid.js';
import { World } from '../src/game/world.js';
import { DIMENSIONS } from '../src/game/dimensions.js';
import { Legs } from '../src/game/legs.js';
import { Loadout, ITEMS, ITEM_IDS, RECIPES, SLOTS, MAX_LEVEL } from '../src/game/arsenal.js';

function fakePlayer() {
  const game = { shockwave() {}, impact() {}, player: null };
  const p = {
    stats: { ...PLAYER_BASE },
    hp: PLAYER_BASE.maxHp,
    taken: {},
    buffs: {},
    blades: 0,
    refreshBlade() { this.blades++; },
  };
  game.player = p;
  p.loadout = new Loadout(game);
  p.loadout.equip('katana', 1);
  return p;
}

test('rarity rolls stay in range and luck shifts the distribution upward', () => {
  const rng = new RNG(1);
  const avg = (luck) => {
    let s = 0;
    for (let i = 0; i < 5000; i++) s += rollRarity(rng, luck);
    return s / 5000;
  };
  const base = avg(0), lucky = avg(1.5);
  assert.ok(lucky > base + 0.3, `${base} vs ${lucky}`);
  for (let i = 0; i < 1000; i++) {
    const r = rollRarity(rng, 0.5, 3);
    assert.ok(r >= 3 && r < RARITY.length);
  }
});

test('offers are distinct, valid and apply to the player', () => {
  const rng = new RNG(99);
  const p = fakePlayer();
  for (let round = 0; round < 80; round++) {
    const offers = rollOffers(rng, p, 3, {});
    assert.equal(offers.length, 3);
    assert.equal(new Set(offers.map((o) => o.id)).size, 3);
    for (const o of offers) {
      assert.ok(o.rarity >= 0 && o.rarity < RARITY.length);
      assert.ok(o.name && o.desc && o.icon);
      if (o.kind === 'item') assert.ok(SLOTS.includes(o.slot) && o.next >= 1 && o.next <= MAX_LEVEL);
    }
    applyOffer(p, offers[0]);
  }
  // a long run fills slots and levels items without ever exceeding the cap
  for (const k of SLOTS) { const s = p.loadout.get(k); if (s) assert.ok(s.level >= 1 && s.level <= MAX_LEVEL); }
  assert.ok(SLOTS.filter((k) => p.loadout.get(k)).length >= 3);
});

test('stat upgrades scale with rarity but stay modest', () => {
  const might = UPGRADES.find((u) => u.id === 'might');
  const p1 = fakePlayer(), p2 = fakePlayer();
  applyOffer(p1, { kind: 'stat', id: 'might', value: might.base * RARITY[0].mul });
  applyOffer(p2, { kind: 'stat', id: 'might', value: might.base * RARITY[5].mul });
  assert.ok(p2.stats.dmgMul - 1 > (p1.stats.dmgMul - 1) * 2.5);
  assert.ok(p2.stats.dmgMul < 1.25);
});

test('arsenal: every item is well-formed and every recipe pairs items from different slots', () => {
  for (const [id, def] of Object.entries(ITEMS)) {
    assert.ok(SLOTS.includes(def.slot), id);
    for (let L = 1; L <= MAX_LEVEL; L++) {
      const st = def.stats(L);
      for (const v of Object.values(st)) if (typeof v === 'number') assert.ok(Number.isFinite(v), `${id} L${L}`);
      if (def.slot !== 'blade') assert.ok(st.cd > 0, `${id} has a cooldown`);
      else { assert.ok(st.dmg > 0 && st.speed > 0); assert.ok(WEAPONS[def.model], `${id} model`); }
    }
    if (def.slot === 'arms') assert.equal(typeof def.fire, 'function', id);
    if (def.slot === 'magic' || def.slot === 'power') assert.equal(typeof def.cast, 'function', id);
    if (!def.evolved && def.slot !== 'blade') assert.ok(def.stats(MAX_LEVEL).cd < def.stats(1).cd || def.slot === 'arms', `${id} cooldown improves`);
  }
  const marks = new Set();
  for (const r of RECIPES) {
    assert.ok(ITEMS[r.base] && ITEMS[r.with] && ITEMS[r.into], r.into);
    assert.notEqual(ITEMS[r.base].slot, ITEMS[r.with].slot, `${r.into} pairs different slots`);
    assert.equal(ITEMS[r.into].slot, ITEMS[r.base].slot, `${r.into} evolves in place`);
    assert.ok(ITEMS[r.into].evolved && !ITEMS[r.base].evolved);
    assert.ok(!marks.has(r.mark), `unique mark ${r.mark}`);
    marks.add(r.mark);
  }
  // branching paths exist, and every base item takes part in at least one evolution
  assert.ok(RECIPES.filter((r) => r.base === 'katana').length >= 2);
  for (const id of ITEM_IDS) assert.ok(RECIPES.some((r) => r.base === id || r.with === id), `${id} has a recipe`);
});

test('evolution needs the base at max level plus its marked partner, then replaces the base', () => {
  const p = fakePlayer();
  const L = p.loadout;
  L.equip('thunder', 1);
  assert.equal(L.readyEvolutions().length, 0);
  L.levelUp('katana', MAX_LEVEL);
  assert.equal(L.levelOf('katana'), MAX_LEVEL);
  const ready = L.readyEvolutions();
  assert.deepEqual(ready.map((r) => r.into), ['raijin']);
  const offers = rollOffers(new RNG(3), p, 3, {});
  assert.equal(offers[0].kind, 'evolve');
  applyOffer(p, offers[0]);
  assert.equal(L.get('blade').id, 'raijin');
  assert.ok(L.has('thunder'));
  assert.equal(L.readyEvolutions().length, 0);
  // the meta discount lets a base evolve one level early
  const q = fakePlayer();
  q.loadout.equip('bloodmoon', 1);
  q.loadout.levelUp('katana', MAX_LEVEL - 2);
  assert.equal(q.loadout.readyEvolutions(0).length, 0);
  assert.equal(q.loadout.readyEvolutions(1)[0].into, 'muramasa');
});

test('every weapon builds at every tier with progressively richer models', () => {
  for (const type of Object.keys(WEAPONS)) {
    let prevParts = 0, prevDmg = 0;
    for (let t = 0; t < RARITY.length; t++) {
      const w = makeWeapon(type, t);
      assert.ok(w.model.parts.length >= prevParts, `${type} tier ${t}`);
      assert.ok(w.dmg > prevDmg);
      for (const part of w.model.parts) {
        assert.equal(part.length, 11);
        assert.ok(w.colors[part[8]], `missing color ${part[8]}`);
      }
      prevParts = w.model.parts.length;
      prevDmg = w.dmg;
    }
    assert.ok(makeWeapon(type, 5).model.parts.length > makeWeapon(type, 0).model.parts.length);
  }
});

test('meta skill tree: unlocks, purchases, full reset refund', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const m = new Meta(storage);
  assert.equal(m.buy('vital1'), false, 'cannot buy without echoes');
  m.award(1000);
  assert.equal(m.canBuy('revive'), false, 'locked behind prerequisites');
  assert.ok(m.buy('vital1'));
  assert.ok(m.buy('vital1'));
  assert.ok(m.buy('might1'));
  assert.equal(m.rank('vital1'), 2);
  const spent = m.totalSpent();
  assert.equal(spent, SKILL_BY_ID.vital1.cost[0] + SKILL_BY_ID.vital1.cost[1] + SKILL_BY_ID.might1.cost[0]);
  const stats = m.applyTo({ ...PLAYER_BASE });
  assert.equal(stats.maxHp, PLAYER_BASE.maxHp + 20);
  const before = m.data.echoes;
  m.reset();
  assert.equal(m.data.echoes, before + spent);
  assert.equal(m.rank('vital1'), 0);
  // persisted
  const m2 = new Meta(storage);
  assert.equal(m2.data.echoes, m.data.echoes);
  // every requirement references a real node
  for (const s of SKILLS) for (const q of s.req) assert.ok(SKILL_BY_ID[q], `${s.id} -> ${q}`);
  assert.ok(echoesForRun({ kills: 100, level: 10, depth: 2, bosses: 1, time: 600, chests: 3 }) > 0);
});

test('humanoid solver preserves bone lengths for arbitrary poses', () => {
  const rng = new RNG(3);
  const pts = new Float32Array(48);
  const len = (a, b) => Math.hypot(pts[a * 3] - pts[b * 3], pts[a * 3 + 1] - pts[b * 3 + 1], pts[a * 3 + 2] - pts[b * 3 + 2]);
  for (let i = 0; i < 200; i++) {
    const p = makePose({
      lean: rng.range(-0.6, 0.8), twist: rng.range(-1, 1), side: rng.range(-0.3, 0.3),
      lp: rng.range(-1, 3), lo: rng.range(-1, 1.5), le: rng.range(0, 2), rp: rng.range(-1, 3), ro: rng.range(-1, 1.5), re: rng.range(0, 2),
      lfz: rng.range(-0.4, 0.4), rfz: rng.range(-0.4, 0.4), lfy: rng.range(0, 0.4), rfy: rng.range(0, 0.4), py: rng.range(-0.3, 0.05),
    });
    solveHumanoid(p, pts, 1);
    assert.ok(Math.abs(len(J.LSH, J.LEL) - 0.3) < 1e-4);
    assert.ok(Math.abs(len(J.REL, J.RHA) - 0.29) < 1e-4);
    assert.ok(Math.abs(len(J.LHIP, J.LKN) - 0.47) < 1e-3);
    assert.ok(Math.abs(len(J.RKN, J.RFT) - 0.46) < 1e-3);
    for (const v of pts) assert.ok(Number.isFinite(v));
  }
});

test('action clips sample smoothly within their stance', () => {
  const out = makePose();
  for (const [name, clip] of Object.entries(CLIPS)) {
    for (let t = 0; t <= 1; t += 0.05) {
      sampleClip(out, clip, STANCE.blade, t);
      for (const v of Object.values(out)) assert.ok(Number.isFinite(v), name);
    }
  }
});

const stubRenderer = () => ({
  setTerrain() {}, clearStatic() {}, uploadStatic() {}, hideStatic() {},
  staticTRS: (kind) => ({ kind, index: 0 }), staticSeg: () => ({ kind: 2, index: 0 }),
});

test('an action clip eases in from the pose the body is already in, so a cut never pops', () => {
  // with a fixed 60 Hz step, the first frame of a cut should move the body far less when it blends in
  const firstFrameJump = (blendIn) => {
    const a = new HumanoidAnimator(1);
    const ctx = { fwdSpeed: 7, sideSpeed: 0, accF: 0, accS: 0, combat: 1, x: 0, y: 0, z: 0, yaw: 0 };
    const dt = 1 / 60;
    for (let i = 0; i < 90; i++) { tickAnimClock(dt); a.update(dt, ctx); }
    const before = Float32Array.from(a.pts);
    a.play(CLIPS.slashR, 1, blendIn);
    tickAnimClock(dt);
    a.update(dt, ctx);
    let jump = 0;
    for (let i = 0; i < before.length; i++) jump = Math.max(jump, Math.abs(a.pts[i] - before[i]));
    return jump;
  };
  const snapped = firstFrameJump(0), eased = firstFrameJump(0.07);
  assert.ok(eased < snapped * 0.4, `blend-in should cut the first-frame jump: ${eased.toFixed(4)} vs ${snapped.toFixed(4)}`);
});

test('a spell reports how long its cooldown has left, so a press can wait for it', () => {
  const p = fakePlayer();
  p.loadout.equip('thunder', 1);
  assert.equal(p.loadout.cooldown('magic'), 0);
  p.loadout.slots.magic.cd = 0.4;
  assert.equal(p.loadout.cooldown('magic'), 0.4);
  assert.equal(p.loadout.cooldown('power'), Infinity, 'an empty slot never comes ready');
});

test('world height matches the generated terrain mesh and stays bounded', () => {
  for (const dim of DIMENSIONS) {
    const w = new World(dim, 1234, 'open', stubRenderer(), 0);
    const n = w.n;
    for (let j = 0; j <= n; j += 17) {
      for (let i = 0; i <= n; i += 13) {
        const x = i * w.step - w.half, z = j * w.step - w.half;
        assert.ok(Math.abs(w.height(x, z) - w.heights[j * (n + 1) + i]) < 1e-3);
      }
    }
    assert.equal(w.obelisks.length, 3);
    assert.ok(w.chests.length >= 16);
    assert.ok(w.portalSpot);
    const p = { x: 500, z: 0 };
    assert.ok(w.clampToBounds(p));
    assert.ok(Math.hypot(p.x, p.z) <= w.playRadius + 1e-6);
  }
});

test('arena worlds have a floor and no open-world objectives', () => {
  const w = new World(DIMENSIONS[0], 9, 'arena', stubRenderer(), 2);
  assert.equal(w.obelisks.length, 0);
  assert.equal(w.chests.length, 0);
  assert.ok(Math.abs(w.height(0, 0)) < 2);
  assert.ok(w.height(60, 0) < -10, 'void beyond the rim');
});

test('chest cost scales with opened count and depth, discounted by meta', () => {
  const shallow = new World(DIMENSIONS[0], 5, 'open', stubRenderer(), 0);
  const deep = new World(DIMENSIONS[0], 5, 'open', stubRenderer(), 3);
  const c = { tier: 1 };
  const base = shallow.chestCost(c);
  shallow.chestsOpened = 4;
  assert.ok(shallow.chestCost(c) > base);
  assert.ok(deep.chestCost(c) > base);
  assert.ok(deep.chestCost(c, 0.24) < deep.chestCost(c));
});

test('legged locomotion keeps feet planted near the ground', () => {
  const legs = new Legs([
    { hip: [0.2, 0.6, 0.2], rest: [0.6, 0.3], l1: 0.5, l2: 0.6, group: 0 },
    { hip: [-0.2, 0.6, 0.2], rest: [-0.6, 0.3], l1: 0.5, l2: 0.6, group: 1 },
  ]);
  const ground = (x) => Math.sin(x * 0.3) * 0.5;
  const body = { x: 0, y: 0.6, z: 0, yaw: 0, scale: 1 };
  for (let i = 0; i < 240; i++) {
    body.x += 4 / 60;
    body.y = ground(body.x) + 0.6;
    legs.update(1 / 60, body, 4, 0, ground);
    for (const l of legs.legs) {
      assert.ok(Number.isFinite(l.kx + l.ky + l.kz));
      if (l.t < 0) assert.ok(Math.abs(l.ey - ground(l.ex) - 0.04) < 0.6);
    }
  }
});

test('loot containers, obelisks and the rift are never placed inside indestructible props', () => {
  for (const dim of DIMENSIONS) {
    for (const seed of [185, 1, 77, 4242, 90210]) {
      for (const depth of [0, 2]) {
        const w = new World(dim, seed, 'open', stubRenderer(), depth);
        for (const c of w.chests) assert.ok(w.isClear(c.x, c.z, 1.8), `${dim.id} seed ${seed} chest at ${c.x},${c.z}`);
        for (const o of w.obelisks) assert.ok(w.isClear(o.x, o.z, 3), `${dim.id} seed ${seed} obelisk`);
        assert.ok(w.isClear(w.portalSpot.x, w.portalSpot.z, 4), `${dim.id} seed ${seed} rift`);
      }
    }
  }
});

test('anatomy expands the 16-joint pose into a stable 28-joint skeleton with settling cloth', async () => {
  const { expandSkeleton, Anatomy, BODIES, SKELETON_BONES } = await import('../src/game/anatomy.js');
  const rng = new RNG(11);
  const pts = new Float32Array(48);
  const names = new Set(SKELETON_BONES.flat());
  assert.equal(names.size, 28);
  const an = new Anatomy(BODIES.hero, 1);
  const ground = () => 0;
  for (let f = 0; f < 240; f++) {
    const t = f / 60;
    const p = makePose({ lean: Math.sin(t * 3) * 0.4, twist: Math.sin(t * 2) * 0.8, lp: rng.range(-0.5, 2.5), rp: rng.range(-0.5, 2.5), le: 0.6, re: 0.6, lfz: Math.sin(t * 9) * 0.3, rfz: -Math.sin(t * 9) * 0.3 });
    solveHumanoid(p, pts, 1);
    for (let i = 0; i < 16; i++) { pts[i * 3] += t * 4; }
    an.update(1 / 60, pts, ground);
    const sk = expandSkeleton(pts, 1, an);
    for (const n of names) {
      if (!sk[n]) continue; // feet joints are added at draw time (they need the ground)
      for (const c of sk[n]) assert.ok(Number.isFinite(c), n);
    }
    // the hand tip sits a hand's length from the wrist whatever the drag
    const d = Math.hypot(...sk.RTIP.map((c, k) => c - sk.RWRIST[k]));
    assert.ok(Math.abs(d - 0.11) < 1e-6);
  }
  for (const strand of [...an.tails, ...an.hair]) {
    for (let i = 1; i < strand.n; i++) {
      const seg = Math.hypot(...strand.p[i].map((c, k) => c - strand.p[i - 1][k]));
      assert.ok(seg < strand.seg * 1.6, 'cloth stays connected');
      assert.ok(strand.p[i][1] >= 0, 'cloth stays above the ground');
    }
  }
});

test('Ink Requiem is the default art style; old saves move to it unless the player picked a style', () => {
  const mem = (data) => { const m = new Map(data ? [['k', JSON.stringify(data)]] : []); return { getItem: () => (m.has('k') ? m.get('k') : null), setItem: (_, v) => m.set('k', v) }; };
  assert.equal(new Meta(mem()).data.settings.style, 'requiem');
  // a save from before the art direction was chosen stored the old default
  assert.equal(new Meta(mem({ settings: { style: 'retro' } })).data.settings.style, 'requiem');
  // an explicit choice is kept
  assert.equal(new Meta(mem({ settings: { style: 'retro', styleChosen: true } })).data.settings.style, 'retro');
});
