// Headless smoke test: boots the game in Chromium (SwiftShader WebGL2), plays a scripted run and captures screenshots.
// Usage: node tools/smoke.mjs [outDir] [query]   (query defaults to gfx=low so SwiftShader keeps up)
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.resolve(process.argv[2] || path.join(root, 'tools', 'shots'));
fs.mkdirSync(outDir, { recursive: true });

let chromium;
try {
  chromium = createRequire(import.meta.url)('playwright').chromium;
} catch {
  const globalRoot = execSync('npm root -g').toString().trim();
  chromium = createRequire(path.join(globalRoot, 'noop.js'))('playwright').chromium;
}

const port = 8000 + Math.floor(Math.random() * 900);
const server = spawn(process.execPath, [path.join(root, 'server.js'), String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(180000);
const query = process.argv[3] ?? 'gfx=low';
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); else if (m.type() === 'warning' && !/AudioContext/.test(m.text())) console.log('warn:', m.text().slice(0, 300)); });

const shot = async (name) => { await page.screenshot({ path: path.join(outDir, name + '.png'), timeout: 180000 }); console.log('shot', name); };
const wait = (ms) => page.waitForTimeout(ms);
const until = (fn, arg, timeout = 180000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });
const settled = () => until(() => !window.__game.transition && window.__game.state === 'play');
const gameTime = (s) => page.evaluate((s) => new Promise((res) => {
  const g = window.__game, t0 = g.time;
  const tick = () => (g.time - t0 >= s ? res() : requestAnimationFrame(tick));
  tick();
}), s);

try {
  await page.goto(`http://localhost:${port}/?${query}`);
  await until(() => window.__game && window.__game.time > 1.5);
  await page.evaluate(() => window.__assets);
  await shot('01-title');

  await page.click('#btn-tree');
  await wait(400);
  await shot('02-skilltree');
  await page.click('#tree-close');

  await page.click('#btn-start');
  await settled();
  await gameTime(1.5);
  await shot('03-run-start');

  // scripted play: move and attack
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 10; i++) { await page.keyboard.press('KeyJ'); await gameTime(0.2); }
  await page.keyboard.up('KeyW');
  await page.evaluate(() => {
    const g = window.__game;
    const p = g.player;
    const types = ['husk', 'hound', 'crawler', 'brute', 'gazer', 'choir', 'maw'];
    types.forEach((t, i) => {
      const a = (i / types.length) * Math.PI * 2;
      g.spawnEnemy(t, p.x + Math.cos(a) * 6, p.z + Math.sin(a) * 6, { instant: true, elite: i === 3 });
    });
  });
  // lock on, then cut with the blade
  await page.keyboard.press('Tab');
  for (let i = 0; i < 16; i++) { await page.keyboard.press('KeyJ'); await gameTime(0.15); }
  await shot('04-combat');
  await page.evaluate(() => { window.__game.gainXp(200); });
  await until(() => window.__game.state === 'levelup');
  await wait(500);
  await shot('05-levelup');
  await page.keyboard.press('Digit1');
  // a full four-slot build with an evolved blade, then use every slot
  await page.evaluate(() => {
    const g = window.__game;
    const L = g.player.loadout;
    L.equip('katana', 5); L.equip('bow', 3); L.equip('thunder', 2); L.equip('berserk', 2);
    L.evolve(L.readyEvolutions()[0]);
    g.pendingLevels = 0; g.offerQueue = [];
    if (g.state === 'levelup') { g.ui.hideOffers(); g.state = 'play'; }
    g.player.stats.maxHp = g.player.hp = 99999;
  });
  await page.keyboard.press('KeyF');
  await page.keyboard.press('KeyQ');
  await page.keyboard.down('KeyK');
  for (let i = 0; i < 10; i++) { await page.keyboard.press('KeyJ'); await gameTime(0.15); }
  await page.keyboard.up('KeyK');
  await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW');
  await gameTime(0.6);
  await shot('06-arsenal');
  await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');

  for (const d of [0, 1, 2, 3]) {
    await page.evaluate((d) => { const g = window.__game; g.enterDimension(d, 'open'); g.player.hp = g.player.stats.maxHp; }, d);
    await gameTime(1.5);
    await shot(`07-dim${d}`);
    await page.evaluate((d) => { const g = window.__game; g.enterDimension(d, 'arena'); g.player.stats.maxHp = g.player.hp = 99999; }, d);
    await until(() => window.__game.boss && window.__game.boss.state !== 'spawn');
    await gameTime(2.5);
    await shot(`08-boss${d}`);
    for (let i = 0; i < 12; i++) { await page.keyboard.press('KeyJ'); await gameTime(0.18); }
    await shot(`09-boss${d}-fight`);
  }
  // kill the boss to see the death sequence and the exit portal
  await page.evaluate(() => { const g = window.__game; g.damageEnemy(g.boss, { dmg: 1e9, dirX: 0, dirZ: 1, kb: 5, source: 'melee', crit: true }); });
  await gameTime(1.5);
  await shot('10-boss-dead');
  await until(() => window.__game.state === 'levelup', 15000).catch(() => {});
  await page.keyboard.press('Digit2');

  // death / game over
  await page.evaluate(() => { const g = window.__game; g.state = 'play'; g.revives = 0; g.player.invulnT = 0; g.player.state = 'free'; g.damagePlayer(1e9, null); });
  await until(() => window.__game.state === 'dead');
  await wait(400);
  await shot('11-gameover');
  const stats = await page.evaluate(() => ({ fps: window.__game.fps, perf: window.__perf }));
  console.log('fps (swiftshader):', stats.fps, 'js ms/frame update:', stats.perf.update.toFixed(2), 'render:', stats.perf.render.toFixed(2));
} catch (e) {
  errors.push('script: ' + e.message);
}

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No page errors.');
await browser.close();
server.kill();
process.exit(errors.length ? 1 : 0);
