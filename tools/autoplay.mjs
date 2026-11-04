// Autopilot soak test: an in-page bot plays the game (locks on, uses all four slots, dodges, loots, takes portals)
// and reports progression stats. Usage: node tools/autoplay.mjs [gameSeconds] [outDir]
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seconds = Number(process.argv[2] || 120);
const outDir = path.resolve(process.argv[3] || path.join(root, 'tools', 'shots'));
fs.mkdirSync(outDir, { recursive: true });

let chromium;
try {
  chromium = createRequire(import.meta.url)('playwright').chromium;
} catch {
  chromium = createRequire(path.join(execSync('npm root -g').toString().trim(), 'noop.js'))('playwright').chromium;
}

const port = 8000 + Math.floor(Math.random() * 900);
const server = spawn(process.execPath, [path.join(root, 'server.js'), String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(`http://localhost:${port}/`);
await page.waitForFunction(() => window.__game && window.__game.time > 1, null, { timeout: 30000 });
await page.click('#btn-start');
await page.waitForFunction(() => !window.__game.transition && window.__game.state === 'play', null, { timeout: 30000 });

// install the bot
await page.evaluate(() => {
  const g = window.__game;
  const inp = g.input;
  const bot = { t: 0, log: { casts: 0, dodges: 0, chests: 0, portals: 0, levelups: 0, maxDepth: 0, waves: 0 } };
  window.__bot = bot;
  const press = (code) => { inp._press(code); inp.down.delete(code); };
  let moveX = 0, moveZ = 0;
  // steer via the world-space input direction hook
  g.inputWorldDir = function () { this._dirOut[0] = moveX; this._dirOut[1] = moveZ; return this._dirOut; };
  const origUpdate = g.update.bind(g);
  g.update = (dt) => {
    bot.t += dt;
    if (g.state === 'levelup') {
      bot.log.levelups++;
      const offers = g.ui.offerState?.offers || [];
      // prefer higher rarity
      let best = 0;
      offers.forEach((o, i) => { if (o.rarity > offers[best].rarity) best = i; });
      g.ui.pickIndex(best);
    } else if (g.state === 'play' && g.player.alive) {
      const p = g.player;
      bot.log.maxDepth = Math.max(bot.log.maxDepth, g.depth);
      bot.log.waves = g.wavesTotal || 0;
      // threats
      const danger = g.hazards.find((h) => h.owner === 'enemy' && Math.hypot(h.x - p.x, h.z - p.z) < h.r + 0.8);
      let goal = null;
      if (g.world.exitPortal) goal = g.world.exitPortal;
      else if (g.world.portal) goal = g.world.portal;
      const target = g.nearestEnemy(p.x, p.z, 30);
      if (!goal && !target) {
        // wander toward an obelisk or a chest we can afford
        const chest = g.world.chests.find((c) => !c.opened && g.world.chestCost(c, p.stats.chestDiscount) <= p.shards);
        goal = chest || g.world.obelisks.find((o) => !o.done) || null;
      }
      let dx = 0, dz = 0;
      if (danger) { dx = p.x - danger.x; dz = p.z - danger.z; }
      else if (goal) { dx = goal.x - p.x; dz = goal.z - p.z; }
      else if (target) { const d = Math.hypot(target.x - p.x, target.z - p.z); if (d > 3) { dx = target.x - p.x; dz = target.z - p.z; } }
      const l = Math.hypot(dx, dz) || 1;
      moveX = dx / l * (dx || dz ? 1 : 0); moveZ = dz / l * (dx || dz ? 1 : 0);
      if (danger && p.dodgeCd <= 0) { press('Space'); bot.log.dodges++; }
      else if (target && Math.hypot(target.x - p.x, target.z - p.z) < 10) {
        if (!g.lock) press('Tab');
        press('KeyJ');
        if (Math.random() < 0.05) { press('KeyQ'); press('KeyF'); bot.log.casts++; }
      }
      // hold Arms fire whenever something is in range
      if (target && Math.hypot(target.x - p.x, target.z - p.z) < 22) inp.down.add('Mouse2'); else inp.down.delete('Mouse2');
      if (p.ult >= 1) press('KeyR');
      const chest = g.nearChest;
      if (chest && g.world.chestCost(chest, p.stats.chestDiscount) <= p.shards) { press('KeyE'); bot.log.chests++; }
      if (goal && goal.kind && Math.hypot(goal.x - p.x, goal.z - p.z) < 3) bot.log.portals++;
    }
    origUpdate(dt);
  };
});

const t0 = Date.now();
let shots = 0;
while (true) {
  await page.waitForTimeout(4000);
  const s = await page.evaluate(() => {
    const g = window.__game;
    return { state: g.state, time: g.run ? g.run.time : 0, hp: g.player.hp, lvl: g.player.level, kills: g.run?.kills, depth: g.depth, mode: g.mode, enemies: g.enemies.length, fps: g.fps, perf: window.__perf, bot: window.__bot.log, slots: ['blade', 'arms', 'magic', 'power'].map((k) => { const s = g.player.loadout.get(k); return s ? `${s.id}:${s.level}` : '-'; }).join(' ') };
  });
  console.log(JSON.stringify({ ...s, perf: { u: s.perf.update.toFixed(2), r: s.perf.render.toFixed(2) } }));
  if (shots < 6) { await page.screenshot({ path: path.join(outDir, `auto-${shots++}.png`) }); }
  // keep the run going for the soak: grant the bot a big health pool so it can reach portals and bosses
  await page.evaluate(() => { const g = window.__game; if (g.player.stats.maxHp < 5000) { g.player.stats.maxHp = 5000; g.player.hp = 5000; } g.portalTimer = Math.min(g.portalTimer, 40); });
  if (s.state === 'dead' || s.time > seconds || Date.now() - t0 > 420000) break;
}
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No page errors.');
await browser.close();
server.kill();
process.exit(errors.length ? 1 : 0);
