// Art-style previz capture: replays the same seeded, scripted scenes in one art style and saves
// stills + a combat clip, so styles can be compared like-for-like.
// Usage: node tools/previz.mjs <styleId> <outDir> [port]
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const style = process.argv[2] || 'retro';
const outDir = path.resolve(process.argv[3] || path.join(root, 'tools', 'previz'), style.replace(/\+/g, '-'));
// combinations only need enough frames to judge the mix
const lite = style.includes('+');
fs.mkdirSync(outDir, { recursive: true });
const port = Number(process.argv[4] || 8500 + Math.floor(Math.random() * 400));
// optional comma list of scenes (sheet, combat, world, oculus, shepherd) so long captures can be split
// across fresh browser sessions; default runs everything
const only = process.argv[5] ? new Set(process.argv[5].split(',')) : null;
const want = (scene) => !only || only.has(scene);

let chromium;
try {
  chromium = createRequire(import.meta.url)('playwright').chromium;
} catch {
  chromium = createRequire(path.join(execSync('npm root -g').toString().trim(), 'noop.js'))('playwright').chromium;
}
const server = spawn(process.execPath, [path.join(root, 'server.js'), String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

// deterministic randomness so every style replays the same fight
await page.addInitScript(() => {
  let s = 1;
  const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  Math.random = rnd;
  window.__seed = (v) => { s = v | 0; };
});
await page.goto(`http://localhost:${port}/?style=${encodeURIComponent(style)}`);
await page.waitForFunction(() => window.__game, null, { timeout: 30000 });

// take over the main loop and expose a fixed-step driver
await page.evaluate(() => {
  const g = window.__game;
  const upd = g.update.bind(g), ren = g.render.bind(g);
  window.__upd = upd; window.__ren = ren;
  g.update = () => {}; g.render = () => {};
  const canvas = document.getElementById('gl');
  window.__drive = (n, dt, capture) => {
    const frames = [];
    for (let i = 0; i < n; i++) {
      if (g.state === 'levelup') g.ui.pickIndex(0);
      upd(dt);
      ren(dt);
      // flush each frame: driving frames in a tight loop otherwise queues GPU work and balloons memory
      g.R.gl.finish();
      if (capture) frames.push({ img: canvas.toDataURL('image/jpeg', 0.9), impact: g.R.post_.impact });
    }
    return frames;
  };
  document.getElementById('menu').classList.add('hidden');
  g.startRun();
  g.ui.showHud(false);
});

const save = (name, dataUrl) => fs.writeFileSync(path.join(outDir, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
const drive = (n, capture = false) => page.evaluate(([n, c]) => window.__drive(n, 1 / 24, c), [n, capture]);

// ---- scene 0: model sheet — the hero as stick / expanded skeleton / finished model, plus an enemy lineup
const hasModels = await page.evaluate(() => !!(window.__game.style && window.__game.style.models));
if (want('sheet') || want('motion')) {
await page.evaluate(() => {
  window.__seed(2024);
  const g = window.__game;
  g.startRun();
  g.ui.showHud(false);
  g.enterDimension(0, 'arena');
  g.bossSpawnT = 1e9;
  g.spawner.enabled = false;
  g.enemies = [];
  const p = g.player;
  p.stats.xpMul = 0; p.stats.maxHp = p.hp = 1e5;
  p.loadout.equip('katana', 3);
  p.placeAt(0, 0); p.yaw = 0;
  g.camDist = 3.4; g.camPitch = 0.06;
  window.__sheet = (view, yaw) => { g.bodyView = view; g.camYaw = yaw; };
});
await drive(24);
const views = hasModels ? ['stick', 'skeleton', 'model'] : ['stick'];
const angles = [['front', Math.PI], ['three-quarter', Math.PI * 0.72], ['side', Math.PI * 0.5], ['back', 0]];
for (const vw of want('sheet') ? views : []) {
  for (const [an, yaw] of angles) {
    if (style !== 'requiem' && hasModels && vw !== 'model') continue;
    if (lite && an !== 'three-quarter') continue;
    await page.evaluate(([v, y]) => window.__sheet(v, y), [vw, yaw]);
    await drive(8);
    save(`sheet-${vw}-${an}.jpg`, (await drive(1, true))[0].img);
  }
}
// enemy lineup
if (want('sheet')) {
await page.evaluate(() => {
  const g = window.__game, p = g.player;
  g.bodyView = 'model';
  const line = [['hound', -4.2], ['husk', -2.4], ['brute', 0.2], ['choir', 2.8], ['crawler', 4.6]];
  for (const [t, x] of line) { const e = g.spawnEnemy(t, p.x + x, p.z + 4.5, { instant: true }); e.atkCd = 1e9; e.state = 'idle'; e.yaw = e.wantYaw = Math.PI; }
  p.placeAt(0, 1.6); p.yaw = Math.PI;
  g.camYaw = Math.PI; g.camDist = 9.5; g.camPitch = 0.12;
  // freeze the lineup in place: idle enemies only animate
  for (const e of g.enemies) e.def = Object.assign(Object.create(e.def), { think(q) { q.mvx = q.mvz = 0; q.wantYaw = Math.PI; } });
});
await drive(30);
save('lineup.jpg', (await drive(1, true))[0].img);
await page.evaluate(() => { window.__game.enemies = []; });
}
// motion study: run, turn and strike — rendered as stick, skeleton and model from the same simulation
if (style === 'requiem' && want('motion')) {
  await page.evaluate(() => {
    const g = window.__game, p = g.player;
    p.placeAt(-3, 0); p.yaw = Math.PI / 2;
    g.camYaw = 0; g.camDist = 5.2; g.camPitch = 0.1;
    let t = 0;
    g.inputWorldDir = function () { t += 1 / 24; const a = Math.PI / 2 - Math.min(t, 1.0) * 1.8; this._dirOut[0] = t < 1.15 ? Math.sin(a) : 0; this._dirOut[1] = t < 1.15 ? Math.cos(a) : 0; return this._dirOut; };
    const canvas = document.getElementById('gl');
    window.__mframe = 0;
    window.__motion = (n) => {
      const out = { stick: [], skeleton: [], model: [] };
      for (let k = 0; k < n; k++) {
        const i = window.__mframe++;
        if (i === 30 || i === 36 || i === 42) g.input._press('KeyJ');
        g.bodyView = 'model';
        window.__upd(1 / 24);
        for (const v of ['stick', 'skeleton', 'model']) {
          g.bodyView = v;
          window.__ren(v === 'stick' ? 1 / 24 : 0);
          g.R.gl.finish();
          out[v].push(canvas.toDataURL('image/jpeg', 0.85));
        }
      }
      return out;
    };
  });
  // fetch in small chunks so one call never holds many frames of GPU work and images
  for (let chunk = 0; chunk < 3; chunk++) {
    const mo = await page.evaluate(() => window.__motion(16));
    for (const [v, frames] of Object.entries(mo)) frames.forEach((d, i) => save(`motion-${v}-${String(chunk * 16 + i).padStart(3, '0')}.jpg`, d));
  }
  await page.evaluate(() => { const g = window.__game; delete g.inputWorldDir; g.bodyView = 'model'; });
}

}

// ---- scene 1: close combat in the Ashen Hollows
if (want('combat')) {
await page.evaluate(() => {
  window.__seed(4242);
  const g = window.__game;
  g.startRun();
  g.ui.showHud(false);
  g.enterDimension(0, 'open');
  g.spawner.enabled = false;
  const p = g.player;
  p.stats.xpMul = 0; p.stats.maxHp = p.hp = 1e5;
  p.loadout.equip('katana', 4); p.loadout.equip('thunder', 3);
  p.yaw = 0; g.camYaw = 0.35; g.camPitch = 0.3; g.camDist = 7.5;
  g.enemies = [];
  const spots = [[-1.6, 3.2, 'husk'], [1.4, 3.6, 'husk'], [0.2, 5.5, 'brute'], [-3.2, 5, 'hound'], [3.4, 4.8, 'crawler'], [2.2, 6.5, 'husk']];
  for (const [x, z, t] of spots) { const e = g.spawnEnemy(t, p.x + x, p.z + z, { instant: true }); e.atkCd = 3 + Math.random() * 3; }
});
await drive(12);
const clip = [];
for (let k = 0; k < 6; k++) {
  await page.keyboard.press('KeyJ');
  clip.push(...await drive(8, true));
}
save('combat.jpg', clip[30].img);
save('combat-b.jpg', clip[42].img);
clip.forEach((f, i) => save(`clip-${String(i).padStart(3, '0')}.jpg`, f.img));
// a Thunder Sigil strike + impact frame (Arcana slot, Q)
await page.evaluate(() => { const g = window.__game; g.lock = g.enemies.find((q) => q.alive && q.type === 'brute') || g.enemies[0]; g.lastImpact = -9; });
await page.keyboard.press('KeyQ');
await drive(8);
await page.evaluate(() => { const g = window.__game; g.lastImpact = -9; g.impact(1); });
const ctr = await drive(14, true);
const imp = ctr.find((f) => f.impact > 0) || ctr[6];
save('impact.jpg', imp.img);
save('counter.jpg', ctr[Math.min(ctr.length - 1, ctr.indexOf(imp) + 5)].img);
}

if (lite) {
  console.log(style, errors.length ? 'ERRORS: ' + errors.join(' | ') : 'ok (lite)');
  await browser.close();
  server.kill();
  process.exit(errors.length ? 1 : 0);
}

// ---- scene 2: exploring the Drowned Abyss (chest, obelisk, gazers)
if (want('world')) {
await page.evaluate(() => {
  window.__seed(777);
  const g = window.__game;
  g.enterDimension(1, 'open');
  g.spawner.enabled = false;
  const p = g.player, W = g.world;
  const c = W.chests.slice().sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
  const ang = Math.atan2(c.x, c.z);
  p.placeAt(c.x - Math.sin(ang) * 5, c.z - Math.cos(ang) * 5);
  p.yaw = ang; g.camYaw = ang + 0.5; g.camPitch = 0.26;
  g.enemies = [];
  for (let i = 0; i < 3; i++) g.spawnEnemy('gazer', c.x + (i - 1) * 4, c.z + 7 + i, { instant: true }).atkCd = 9;
  for (let i = 0; i < 4; i++) g.spawnEnemy('crawler', c.x + 3 + i * 0.8, c.z + 2, { instant: true }).atkCd = 9;
});
await drive(30);
save('world.jpg', (await drive(1, true))[0].img);
}

// ---- scene 3: Oculus Primordial sweeping its beam (Starless Veil)
if (want('oculus')) {
await page.evaluate(() => {
  window.__seed(99);
  const g = window.__game;
  g.enterDimension(2, 'arena');
  g.bossSpawnT = 0.01;
  g.player.stats.maxHp = g.player.hp = 1e5;
});
await drive(60);
await page.evaluate(() => { const b = window.__game.boss; if (b) { b.pattern = 0; b.atkCd = 0; b.state = 'chase'; } });
await drive(44);
save('boss-oculus.jpg', (await drive(1, true))[0].img);
}

// ---- scene 4: the Flayed Shepherd (Flesh Cathedral)
if (want('shepherd')) {
await page.evaluate(() => {
  window.__seed(31337);
  const g = window.__game;
  g.enterDimension(3, 'arena');
  g.bossSpawnT = 0.01;
  g.player.stats.maxHp = g.player.hp = 1e5;
  g.player.loadout.equip('scythe', 5);
});
await drive(60);
await page.evaluate(() => { const g = window.__game; const b = g.boss; g.player.placeAt(b.x - 2, b.z - 7); g.player.yaw = 0; b.pattern = 0; b.atkCd = 0; });
for (let k = 0; k < 3; k++) { await page.keyboard.press('KeyJ'); await drive(7); }
save('boss-shepherd.jpg', (await drive(1, true))[0].img);
}

console.log(style, errors.length ? 'ERRORS: ' + errors.join(' | ') : 'ok');
await browser.close();
server.kill();
process.exit(errors.length ? 1 : 0);
