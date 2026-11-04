// DOM HUD + 2D overlay (damage numbers, markers, prompts) + menus (title, level-up, pause, game over, skill tree).
import { project, clamp } from '../core/math.js';
import { RARITY } from '../game/config.js';
import { SKILLS, SKILL_BY_ID } from '../game/meta.js';
import { UPGRADE_BY_ID } from '../game/upgrades.js';
import { CHEST_TIERS } from '../game/world.js';

const $ = (sel) => document.querySelector(sel);
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class UI {
  constructor(meta, audio) {
    this.meta = meta;
    this.audio = audio;
    this.overlay = $('#overlay');
    this.ctx = this.overlay.getContext('2d');
    this.hudEl = $('#hud');
    this.el = {
      hpFill: $('#hp-fill'), hpText: $('#hp-text'), ultFill: $('#ult-fill'), ultLabel: $('#ult-label'),
      xpFill: $('#xp-fill'), level: $('#level'), shards: $('#shards'), timer: $('#timer'), depth: $('#depth'),
      kills: $('#kills'), objective: $('#objective'), combo: $('#combo'), comboN: $('#combo-n'), comboR: $('#combo-r'),
      boss: $('#bossbar'), bossName: $('#boss-name'), bossFill: $('#boss-fill'), weapon: $('#weapon'), abilities: $('#abilities'),
      announce: $('#announce'), titleCard: $('#titlecard'), offers: $('#offers'), pause: $('#pause'), gameover: $('#gameover'),
      menu: $('#menu'), tree: $('#tree'), settings: $('#settings'), dodge: $('#dodge-fill'),
    };
    this.tmp = [0, 0, 0];
    this.offerState = null;
    this._lastAb = '';
    this._lastWeapon = '';
  }

  bind(game) {
    this.game = game;
    $('#btn-start').onclick = () => { this.audio.init(); this.audio.play('select'); this.showMenu(false); game.input.requestLock(); game.transitionTo(() => game.startRun()); };
    $('#btn-tree').onclick = () => { this.audio.init(); this.audio.play('ui'); this.showTree(true); };
    $('#btn-settings').onclick = () => { this.audio.init(); this.audio.play('ui'); this.showSettings(true); };
    $('#btn-resume').onclick = () => game.resume();
    $('#btn-pause-settings').onclick = () => this.showSettings(true);
    $('#btn-abandon').onclick = () => { this.showPause(false); game.abandonRun(); };
    $('#btn-again').onclick = () => { this.el.gameover.classList.add('hidden'); game.input.requestLock(); game.transitionTo(() => game.startRun()); };
    $('#btn-go-tree').onclick = () => { this.el.gameover.classList.add('hidden'); this.showTree(true, true); };
    $('#btn-go-menu').onclick = () => { this.el.gameover.classList.add('hidden'); this.toTitle(); };
    $('#tree-close').onclick = () => { this.showTree(false); if (this._treeFromGameOver) this.toTitle(); else this.showMenu(true); };
    $('#tree-reset').onclick = () => {
      const spent = this.meta.totalSpent();
      if (spent <= 0) return;
      if (!confirm(`Reset the Ossuary and refund ${spent} echoes?`)) return;
      this.meta.reset();
      this.audio.play('levelup');
      this.renderTree();
    };
    $('#settings-close').onclick = () => this.showSettings(false);
    const q = $('#set-quality'), v = $('#set-volume'), s = $('#set-sens'), sh = $('#set-shake');
    const st = this.meta.data.settings;
    q.value = String(st.quality); v.value = String(st.volume); s.value = String(st.sensitivity); sh.value = String(st.shake);
    q.onchange = () => { st.quality = Number(q.value); if (!game.style || !game.style.toon) game.R.setQuality(st.quality); this.meta.save(); };
    const sty = $('#set-style');
    sty.value = game.style ? game.style.id : 'retro';
    sty.onchange = () => { st.style = sty.value; game.setStyle(st.style); this.meta.save(); };
    v.oninput = () => { st.volume = Number(v.value); this.audio.setVolume(st.volume); this.meta.save(); };
    s.oninput = () => { st.sensitivity = Number(s.value); this.meta.save(); };
    sh.oninput = () => { st.shake = Number(sh.value); this.meta.save(); };
    this.updateMenuStats();
  }

  toTitle() {
    this.game.transitionTo(() => {
      this.game._buildTitleWorld();
      this.game.state = 'title';
      this.showMenu(true);
    });
  }

  updateMenuStats() {
    const d = this.meta.data;
    $('#menu-echoes').textContent = d.echoes;
    $('#menu-stats').textContent = d.stats.runs
      ? `Runs ${d.stats.runs} · Deepest ${d.stats.bestDepth} · Bosses slain ${d.stats.bosses} · Kills ${d.stats.kills}`
      : 'No descents yet.';
  }

  showMenu(on) {
    this.el.menu.classList.toggle('hidden', !on);
    if (on) this.updateMenuStats();
  }

  showHud(on) { this.hudEl.classList.toggle('hidden', !on); }
  showPause(on) { this.el.pause.classList.toggle('hidden', !on); }
  showSettings(on) { this.el.settings.classList.toggle('hidden', !on); }
  get settingsOpen() { return !this.el.settings.classList.contains('hidden'); }

  title(name, sub, tag) {
    const t = this.el.titleCard;
    t.innerHTML = `<div class="tc-tag">${esc(tag)}</div><div class="tc-name">${esc(name)}</div><div class="tc-sub">${esc(sub)}</div>`;
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
  }

  announce(text, kind = 'info') {
    const a = document.createElement('div');
    a.className = `ann ann-${kind}`;
    a.textContent = text;
    this.el.announce.appendChild(a);
    setTimeout(() => a.remove(), 3600);
    while (this.el.announce.children.length > 4) this.el.announce.firstChild.remove();
  }

  // ------------------------------------------------------------ offers
  showOffers(o) {
    this.offerState = o;
    this._renderOffers(o.offers);
  }

  _renderOffers(offers) {
    const o = this.offerState;
    o.offers = offers;
    const el = this.el.offers;
    el.classList.remove('hidden');
    const cards = offers.map((of, i) => {
      const r = RARITY[of.rarity];
      const kindLabel = of.kind === 'weapon' ? 'Weapon' : of.kind === 'ability' ? (of.level ? `Ability · Lv ${Math.floor(of.level) + 1}` : 'New Ability') : 'Attribute';
      const pips = Array.from({ length: RARITY.length }, (_, k) => `<i class="${k <= of.rarity ? 'on' : ''}"></i>`).join('');
      return `<button class="card r-${r.id}" data-i="${i}" style="--rc:${r.hex}">
        <div class="card-glow"></div>
        <div class="card-rarity">${r.name}<span class="pips">${pips}</span></div>
        <div class="card-icon">${esc(of.icon)}</div>
        <div class="card-name">${esc(of.name)}</div>
        <div class="card-kind">${kindLabel}</div>
        <div class="card-desc">${esc(of.desc)}</div>
        <div class="card-key">${i + 1}</div>
      </button>`;
    }).join('');
    el.innerHTML = `<div class="offers-head"><h2>${esc(o.title)}</h2><p>${esc(o.subtitle || '')}</p></div>
      <div class="offers-row">${cards}</div>
      <div class="offers-foot">${o.rerolls > 0 ? `<button id="btn-reroll" class="btn ghost">Reroll (${o.rerolls}) <kbd>X</kbd></button>` : '<span class="muted">No rerolls</span>'}</div>`;
    el.querySelectorAll('.card').forEach((c) => {
      c.onclick = () => this.pickIndex(Number(c.dataset.i));
      c.onmouseenter = () => this.audio.play('ui');
    });
    const rb = el.querySelector('#btn-reroll');
    if (rb) rb.onclick = () => this.reroll();
  }

  pickIndex(i) {
    const o = this.offerState;
    if (!o || !o.offers[i]) return;
    const of = o.offers[i];
    this.offerState = null;
    o.onPick(of);
  }

  reroll() {
    const o = this.offerState;
    if (!o) return;
    const next = o.onReroll();
    if (next) { o.rerolls--; this._renderOffers(next); }
  }

  hideOffers() { this.el.offers.classList.add('hidden'); }

  // ------------------------------------------------------------ game over
  showGameOver(r) {
    this.hideOffers();
    this.offerState = null;
    const el = this.el.gameover;
    el.classList.remove('hidden');
    $('#go-stats').innerHTML = [
      ['Depth reached', r.depth + 1], ['Time survived', fmtTime(r.time)], ['Level', r.level], ['Foes unmade', r.kills],
      ['Bosses slain', r.bosses], ['Containers opened', r.chests], ['Longest combo', r.maxCombo], ['Damage dealt', Math.round(r.dmgDealt)],
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    $('#go-echoes').textContent = `+${r.echoes}`;
    $('#go-total').textContent = r.total;
    this.updateMenuStats();
  }

  // ------------------------------------------------------------ skill tree
  showTree(on, fromGameOver = false) {
    this._treeFromGameOver = fromGameOver;
    this.el.tree.classList.toggle('hidden', !on);
    if (on) { this.showMenu(false); this.renderTree(); }
  }

  renderTree() {
    const m = this.meta;
    $('#tree-echoes').textContent = m.data.echoes;
    const canvas = $('#tree-canvas');
    const W = canvas.clientWidth || 900, H = canvas.clientHeight || 600;
    const scale = Math.min(W, H) / 8.2;
    const cx = W / 2, cy = H / 2;
    const pos = (s) => [cx + s.pos[0] * scale, cy + s.pos[1] * scale];
    let lines = '';
    for (const s of SKILLS) {
      for (const q of s.req) {
        const a = pos(SKILL_BY_ID[q]), b = pos(s);
        const lit = m.rank(q) > 0 && m.rank(s.id) > 0;
        const avail = m.rank(q) > 0;
        lines += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="${lit ? 'lit' : avail ? 'avail' : ''}"/>`;
      }
    }
    const nodes = SKILLS.map((s) => {
      const [x, y] = pos(s);
      const r = m.rank(s.id);
      const unlocked = m.isUnlocked(s.id);
      const can = m.canBuy(s.id);
      const cost = m.nextCost(s.id);
      const cls = [`node`, `b-${s.branch}`, r > 0 ? 'owned' : '', r >= s.max ? 'maxed' : '', unlocked ? '' : 'locked', can ? 'can' : ''].join(' ');
      const tip = `${s.name}\n${s.desc(Math.max(1, r))}${r < s.max ? `\nNext: ${s.desc(r + 1)} — ${cost} echoes` : '\nMastered'}`;
      return `<button class="${cls}" style="left:${x}px;top:${y}px" data-id="${s.id}" title="${esc(tip)}">
        <span class="node-rank">${s.max > 1 ? `${r}/${s.max}` : r ? '✓' : ''}</span>
        <span class="node-name">${esc(s.name)}</span>
      </button>`;
    }).join('');
    canvas.innerHTML = `<svg width="${W}" height="${H}">${lines}</svg>${nodes}
      <div class="branch-label" style="left:${cx}px;top:${cy - scale * 3.95}px">BODY</div>
      <div class="branch-label" style="left:${cx + scale * 3.95}px;top:${cy}px">BLADE</div>
      <div class="branch-label" style="left:${cx}px;top:${cy + scale * 3.95}px">MIND</div>
      <div class="branch-label" style="left:${cx - scale * 3.95}px;top:${cy}px">RIFT</div>`;
    canvas.querySelectorAll('.node').forEach((n) => {
      n.onclick = () => {
        const id = n.dataset.id;
        if (m.buy(id)) { this.audio.play('levelup'); this.renderTree(); this._detail(id); } else { this.audio.play('ui'); this._detail(id); }
      };
      n.onmouseenter = () => this._detail(n.dataset.id);
    });
    $('#tree-spent').textContent = m.totalSpent();
  }

  _detail(id) {
    const s = SKILL_BY_ID[id];
    const m = this.meta;
    const r = m.rank(id);
    const next = r < s.max ? `<p>Next rank: <b>${esc(s.desc(r + 1))}</b></p><p class="cost ${m.canBuy(id) ? 'ok' : ''}">${m.nextCost(id)} echoes${m.isUnlocked(id) ? '' : ' · locked'}</p>` : '<p class="cost ok">Mastered</p>';
    $('#tree-detail').innerHTML = `<h3>${esc(s.name)}</h3><p class="muted">${s.branch.toUpperCase()} · Rank ${r}/${s.max}</p>${r ? `<p>Current: ${esc(s.desc(r))}</p>` : ''}${next}`;
  }

  // ------------------------------------------------------------ per-frame HUD
  updateHud(g) {
    if (g.state === 'title' || !g.run) return;
    const p = g.player, e = this.el;
    e.hpFill.style.width = `${clamp(p.hp / p.stats.maxHp, 0, 1) * 100}%`;
    e.hpText.textContent = `${Math.max(0, Math.ceil(p.hp))} / ${Math.round(p.stats.maxHp)}`;
    e.ultFill.style.width = `${p.ult * 100}%`;
    e.ultLabel.classList.toggle('ready', p.ult >= 1);
    e.dodge.style.width = `${(1 - clamp(p.dodgeCd / p.stats.dodgeCd, 0, 1)) * 100}%`;
    e.xpFill.style.width = `${(p.xp / p.xpNext) * 100}%`;
    e.level.textContent = p.level;
    e.shards.textContent = p.shards;
    e.timer.textContent = fmtTime(g.run.time);
    e.kills.textContent = g.run.kills;
    e.depth.textContent = `${g.mode === 'arena' ? 'Rift Sanctum' : g.dim.name} · Depth ${g.depth + 1}`;
    // objective
    let obj = '';
    if (g.mode === 'open') {
      const done = g.world.obelisks.filter((o) => o.done).length;
      if (g.world.portal) obj = `<b class="warn">Rift closes in ${fmtTime(Math.max(0, g.world.portal.timer))}</b> — reach it to face the guardian`;
      else obj = `Rift opens in <b>${fmtTime(Math.max(0, g.portalTimer))}</b> · Obelisks <b>${done}/3</b>`;
      if (g.activeObelisk) obj += ` · <span class="good">Awakening ${Math.floor(g.activeObelisk.charge * 100)}%</span>`;
    } else if (g.boss) obj = 'Destroy the guardian';
    else if (g.world.exitPortal) obj = g.world.exitPortal.armed ? '<span class="good">Step through the rift to descend deeper</span>' : '<span class="good">Gather the spoils — the rift is stabilising</span>';
    else obj = 'The sanctum trembles...';
    if (obj !== this._lastObj) { e.objective.innerHTML = obj; this._lastObj = obj; }
    // combo
    if (g.combo >= 3) {
      e.combo.classList.add('on');
      e.comboN.textContent = `${g.combo}`;
      e.comboR.textContent = g.comboRank();
      e.combo.style.setProperty('--heat', Math.min(1, g.combo / 40));
    } else e.combo.classList.remove('on');
    // boss
    if (g.boss && g.boss.alive && g.boss.state !== 'spawn') {
      e.boss.classList.remove('hidden');
      e.bossName.textContent = g.boss.name;
      e.bossFill.style.width = `${clamp(g.boss.hp / g.boss.maxHp, 0, 1) * 100}%`;
    } else e.boss.classList.add('hidden');
    // weapon + abilities (only re-render on change)
    const wkey = `${p.weapon.type}-${p.weapon.tier}`;
    if (wkey !== this._lastWeapon) {
      this._lastWeapon = wkey;
      const r = RARITY[p.weapon.tier];
      e.weapon.innerHTML = `<span class="w-icon">${p.weapon.def.icon}</span><span><b style="color:${r.hex}">${esc(p.weapon.def.name)}</b><br><small>${r.name}</small></span>`;
    }
    const abKey = JSON.stringify(p.ab);
    if (abKey !== this._lastAb) {
      this._lastAb = abKey;
      e.abilities.innerHTML = Object.entries(p.ab).map(([id, v]) => {
        const u = UPGRADE_BY_ID[id];
        return `<div class="ab" title="${esc(u.name)}"><span>${u.icon}</span><i>${v.toFixed(1)}</i></div>`;
      }).join('');
    }
  }

  // ------------------------------------------------------------ 2D overlay
  drawOverlay(g) {
    const c = this.overlay;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = c.clientWidth, H = c.clientHeight;
    if (c.width !== Math.floor(W * dpr) || c.height !== Math.floor(H * dpr)) {
      c.width = Math.floor(W * dpr);
      c.height = Math.floor(H * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // Chromium may skip presenting a canvas that was cleared to fully transparent; keep one invisible pixel drawn.
    ctx.fillStyle = 'rgba(0,0,0,0.004)';
    ctx.fillRect(0, 0, 1, 1);
    this.updateHud(g);
    if (g.state === 'title') return;
    const vp = g.R.vp;
    const t = this.tmp;
    // damage numbers
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const n of g.numbers) {
      if (!project(vp, n.x + n.ox, n.y, n.z, W, H, t)) continue;
      const a = clamp(n.t / 0.4, 0, 1);
      const size = (n.crit ? 26 : 17) * clamp(14 / t[2], 0.55, 1.4) * (1 + (0.9 - n.t) * (n.crit ? 0.6 : 0.2));
      ctx.font = `${n.crit ? 900 : 700} ${size}px "Palatino Linotype", Palatino, Georgia, serif`;
      ctx.globalAlpha = a;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(n.v, t[0], t[1]);
      const col = n.crit ? '#ffe680' : `rgb(${n.color.map((v) => Math.round(150 + v * 105)).join(',')})`;
      ctx.fillStyle = col;
      ctx.fillText(n.v, t[0], t[1]);
    }
    ctx.globalAlpha = 1;
    // elite health bars
    for (const e of g.enemies) {
      if (!e.alive || e.boss || (!e.elite && e.hp >= e.maxHp) || e.state === 'spawn') continue;
      if (!project(vp, e.x, e.y + 2.3 * e.size + (e.hover || 0), e.z, W, H, t) || t[2] > 40) continue;
      const w = e.elite ? 60 : 34;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(t[0] - w / 2 - 1, t[1] - 1, w + 2, 6);
      ctx.fillStyle = e.elite ? '#d58bff' : '#c33';
      ctx.fillRect(t[0] - w / 2, t[1], w * clamp(e.hp / e.maxHp, 0, 1), 4);
      if (e.elite) {
        ctx.font = '600 11px "Palatino Linotype", Palatino, Georgia, serif';
        ctx.fillStyle = '#e9c9ff';
        ctx.fillText(`Eldritch ${e.name}`, t[0], t[1] - 10);
      }
    }
    // markers: portal, obelisks, nearby chests
    const markers = [];
    const W_ = g.world;
    if (W_.portal) markers.push({ x: W_.portal.x, y: W_.portal.y + 4, z: W_.portal.z, label: 'RIFT', color: '#ff9a4a', big: true });
    if (W_.exitPortal) markers.push({ x: W_.exitPortal.x, y: W_.exitPortal.y + 4, z: W_.exitPortal.z, label: 'DESCEND', color: '#7affd8', big: true });
    for (const o of W_.obelisks) if (!o.done) markers.push({ x: o.x, y: o.y + 7, z: o.z, label: 'OBELISK', color: '#b8a0ff' });
    for (const ch of W_.chests) {
      if (ch.opened) continue;
      const d = Math.hypot(ch.x - g.player.x, ch.z - g.player.z);
      if (d < 38) markers.push({ x: ch.x, y: ch.y + 1.6, z: ch.z, label: '', color: ch.tier === 2 ? '#33ffd9' : ch.tier === 1 ? '#8fb6ff' : '#ffcc88', small: true, dist: d });
    }
    for (const m of markers) this._marker(ctx, vp, m, W, H, g);
    // interaction prompt
    if (g.nearChest && g.state === 'play') {
      const ch = g.nearChest;
      if (project(vp, ch.x, ch.y + 2.1, ch.z, W, H, t)) {
        const cost = W_.chestCost(ch, g.player.stats.chestDiscount);
        const afford = g.player.shards >= cost;
        const label = `[E] Open ${CHEST_TIERS[ch.tier].name} — ${cost} ◆`;
        ctx.font = '600 15px "Palatino Linotype", Palatino, Georgia, serif';
        const tw = ctx.measureText(label).width + 24;
        ctx.fillStyle = 'rgba(8,4,12,0.8)';
        ctx.fillRect(t[0] - tw / 2, t[1] - 15, tw, 30);
        ctx.strokeStyle = afford ? '#ffcc66' : '#a33';
        ctx.strokeRect(t[0] - tw / 2 + 0.5, t[1] - 14.5, tw - 1, 29);
        ctx.fillStyle = afford ? '#ffe2a8' : '#ff8a8a';
        ctx.fillText(label, t[0], t[1]);
      }
    }
    // counter prompt
    if (g.state === 'play' && g.player.alive) {
      const list = g.counterableEnemies(g.player.x, g.player.z, g.player.stats.counterRange);
      if (list.length) {
        ctx.font = '700 18px "Palatino Linotype", Palatino, Georgia, serif';
        ctx.fillStyle = `rgba(150,240,255,${0.7 + Math.sin(g.time * 20) * 0.3})`;
        ctx.fillText('COUNTER  [Q]', W / 2, H * 0.68);
      }
      if (g.player.ult >= 1) {
        ctx.font = '700 15px "Palatino Linotype", Palatino, Georgia, serif';
        ctx.fillStyle = `rgba(255,200,255,${0.6 + Math.sin(g.time * 6) * 0.3})`;
        ctx.fillText('REND REALITY READY  [R]', W / 2, H * 0.73);
      }
      if (!g.input.locked && !g.input.usingPad) {
        ctx.font = '600 13px "Palatino Linotype", Palatino, Georgia, serif';
        ctx.fillStyle = 'rgba(220,210,235,0.75)';
        ctx.fillText('Click the screen to enable mouse look', W / 2, H - 34);
      }
      if (g.combo >= 10) {
        ctx.font = '600 13px "Palatino Linotype", Palatino, Georgia, serif';
        ctx.fillStyle = 'rgba(255,220,160,0.8)';
        ctx.fillText('Heavy attack: Takedown', W / 2, H * 0.77);
      }
    }
  }

  _marker(ctx, vp, m, W, H, g) {
    const t = this.tmp;
    const on = project(vp, m.x, m.y, m.z, W, H, t);
    const d = Math.hypot(m.x - g.player.x, m.z - g.player.z);
    let x = t[0], y = t[1];
    const margin = 40;
    const off = !on || x < margin || x > W - margin || y < margin || y > H - margin;
    if (m.small && off) return;
    if (off) {
      // clamp to screen edge along direction from center
      let dx = x - W / 2, dy = y - H / 2;
      if (!on) {
        // projection failed (behind the camera): derive the direction from the camera basis instead
        const R = g.R, cp = R.camPos;
        const rx = m.x - cp[0], ry = m.y - cp[1], rz = m.z - cp[2];
        dx = rx * R.camRight[0] + ry * R.camRight[1] + rz * R.camRight[2];
        dy = -(rx * R.camUp[0] + ry * R.camUp[1] + rz * R.camUp[2]);
        // behind the camera: bias toward the bottom edge so it reads as "turn around"
        dy = Math.max(dy, Math.abs(dx) * 0.25 + 1);
      }
      const s = Math.min((W / 2 - margin) / Math.abs(dx || 1e-3), (H / 2 - margin) / Math.abs(dy || 1e-3));
      x = W / 2 + dx * s; y = H / 2 + dy * s;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = m.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 2;
    if (m.small) {
      ctx.globalAlpha = clamp(1 - m.dist / 38, 0.2, 0.9);
      ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(6, 0); ctx.lineTo(0, 7); ctx.lineTo(-6, 0); ctx.closePath();
      ctx.stroke(); ctx.fill();
    } else {
      const pulse = m.big ? 1 + Math.sin(g.time * 5) * 0.12 : 1;
      ctx.scale(pulse, pulse);
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.stroke(); ctx.fill();
      ctx.fillStyle = '#100810';
      ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
      ctx.font = '700 11px "Palatino Linotype", Palatino, Georgia, serif';
      ctx.fillStyle = m.color;
      ctx.fillText(`${m.label} ${Math.round(d)}m`, 0, -18);
    }
    ctx.restore();
  }
}
