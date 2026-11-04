// DOM HUD + 2D overlay (damage numbers, markers, prompts) + menus (title, level-up, pause, game over, skill tree).
import { project, clamp } from '../core/math.js';
import { RARITY } from '../game/config.js';
import { SKILLS, SKILL_BY_ID } from '../game/meta.js';
import { ITEMS, SLOTS, SLOT_INFO, MAX_LEVEL, recipesFor } from '../game/arsenal.js';
import { CHEST_TIERS } from '../game/world.js';

const $ = (sel) => document.querySelector(sel);
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DISPLAY = 'Impact, Haettenschweiler, "Franklin Gothic Heavy", "Arial Narrow Bold", "Arial Black", sans-serif';
const BODY = '"Avenir Next", "Segoe UI", "Helvetica Neue", Arial, sans-serif';
const POP = { duration: 220, easing: 'cubic-bezier(.2, 1.8, .4, 1)' };
const reducedMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** One-shot "pop" (Web Animations API, so it never fights the CSS animations already on the element). */
function pop(el, from, base = '') {
  if (!el || reducedMotion || !el.animate) return;
  el.animate([{ transform: `${base} ${from}` }, { transform: base || 'none' }], POP);
}

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
      kills: $('#kills'), objective: $('#objective'), slots: $('#slots'), buffs: $('#buffs'),
      wave: $('#wave'), waveLabel: $('#wave-label'), waveFill: $('#wave-fill'),
      boss: $('#bossbar'), bossName: $('#boss-name'), bossFill: $('#boss-fill'),
      announce: $('#announce'), titleCard: $('#titlecard'), offers: $('#offers'), pause: $('#pause'), gameover: $('#gameover'),
      menu: $('#menu'), tree: $('#tree'), settings: $('#settings'), dodge: $('#dodge-fill'),
      hpGhost: $('#hp-ghost'), bossGhost: $('#boss-ghost'), portrait: $('#portrait'), vignette: $('#vignette'),
      ultBar: $('#ult-fill').parentElement, chipShards: $('#chip-shards'), lvlBadge: $('#lvl-badge'),
    };
    // animated HUD state: trailing "ghost" damage bars, hurt face timer, last values for pop animations
    this.fx = { ghost: 1, ghostHold: 0, bossGhost: 1, bossHold: 0, hp: -1, hurtT: 0, shards: -1, level: -1, last: 0, bossId: null, slotKey: '', wave: '' };
    this.pal = { ink: '#140c18', paper: '#f3ead8', accent: '#e8253f', gold: '#ffcf4a', cyan: '#7fe6ff', hi: '#a98bff' };
    this.tmp = [0, 0, 0];
    this.offerState = null;

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
    sty.value = game.style ? game.style.id : 'requiem';
    sty.onchange = () => { st.style = sty.value; st.styleChosen = true; game.setStyle(st.style); this.meta.save(); };
    v.oninput = () => { st.volume = Number(v.value); this.audio.setVolume(st.volume); this.meta.save(); };
    s.oninput = () => { st.sensitivity = Number(s.value); this.meta.save(); };
    sh.oninput = () => { st.shake = Number(sh.value); this.meta.save(); };
    const lk = $('#set-lock'), fl = $('#set-flick');
    lk.value = String(st.lockAssist ?? 1); fl.value = String(st.lockFlick ?? 1);
    lk.oninput = () => { st.lockAssist = Number(lk.value); this.meta.save(); };
    fl.oninput = () => { st.lockFlick = Number(fl.value); this.meta.save(); };
    this.updateMenuStats();
  }

  /** Re-theme the UI for an art pack (CSS variables keyed off body[data-pack]); the overlay canvas reads them back. */
  setPack(style) {
    if (typeof document === 'undefined') return;
    document.body.dataset.pack = (style && style.cast) || 'requiem';
    const cs = getComputedStyle(document.body);
    for (const k of Object.keys(this.pal)) {
      const v = cs.getPropertyValue(`--${k}`).trim();
      if (v) this.pal[k] = v;
    }
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
    const boss = tag === 'BOSS';
    // letters slam in one by one, like an anime episode title
    const letters = [...String(name)].map((ch, i) => (ch === ' ' ? ' ' : `<i style="--i:${i}">${esc(ch)}</i>`)).join('');
    const tape = boss ? '<div class="tc-tape top"></div><div class="tc-tape bottom"></div>' : '';
    t.innerHTML = `${tape}<div class="tc-band"><div class="tc-tag">${esc(boss ? 'WARNING · BOSS' : tag)}</div><div class="tc-name">${letters}</div><div class="tc-sub">${esc(sub)}</div></div>`;
    t.classList.toggle('boss', boss);
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
    clearTimeout(this._titleTimer);
    this._titleTimer = setTimeout(() => t.classList.remove('show'), 4400);
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
    const L = this.game && this.game.player ? this.game.player.loadout : null;
    const cards = offers.map((of, i) => this._card(of, i, L)).join('');
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

  _card(of, i, L) {
    const r = RARITY[of.rarity];
    const pips = Array.from({ length: RARITY.length }, (_, k) => `<i class="${k <= of.rarity ? 'on' : ''}"></i>`).join('');
    if (of.kind === 'evolve') {
      return `<button class="card evolve" data-i="${i}" style="--ec:${of.color}">
        <div class="card-glow"></div>
        <div class="card-rarity">Evolution<span class="pips">${pips}</span></div>
        <div class="card-icon">${esc(of.icon)}</div>
        <div class="card-name">${esc(of.name)}</div>
        <div class="card-recipe">${esc(of.from)} <b>${esc(of.mark)}</b> ${esc(of.with)}</div>
        <div class="card-desc">${esc(of.desc)}</div>
        <div class="card-key">${i + 1}</div>
      </button>`;
    }
    if (of.kind === 'item') {
      const tag = of.mode === 'new' ? 'New' : of.mode === 'level' ? `Lv ${of.level} → ${of.next}` : `Replaces ${of.replaces}`;
      const marks = (of.marks || []).map((m) => `<div class="card-mark${m.owned ? ' owned' : ''}" style="--mc:${m.color}"><b>${esc(m.mark)}</b><span>${m.asBase ? '' : 'Feeds '}${esc(m.into)} · with ${esc(m.partner)}${m.owned ? ' ✓' : ''}</span></div>`).join('');
      return `<button class="card r-${r.id}" data-i="${i}" style="--rc:${r.hex}">
        <div class="card-glow"></div>
        <div class="card-rarity">${r.name}<span class="pips">${pips}</span></div>
        <div class="card-slot">${SLOT_INFO[of.slot].name} · ${SLOT_INFO[of.slot].key}</div>
        <div class="card-icon">${esc(of.icon)}</div>
        <div class="card-name">${esc(of.name)}</div>
        <div class="card-lv">${esc(tag)}</div>
        <div class="card-desc">${esc(of.desc)}</div>
        <div class="card-marks">${marks}</div>
        <div class="card-key">${i + 1}</div>
      </button>`;
    }
    return `<button class="card r-${r.id}" data-i="${i}" style="--rc:${r.hex}">
      <div class="card-glow"></div>
      <div class="card-rarity">${r.name}<span class="pips">${pips}</span></div>
      <div class="card-icon">${esc(of.icon)}</div>
      <div class="card-name">${esc(of.name)}</div>
      <div class="card-kind">Attribute</div>
      <div class="card-desc">${esc(of.desc)}</div>
      <div class="card-key">${i + 1}</div>
    </button>`;
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
      ['Bosses slain', r.bosses], ['Containers opened', r.chests], ['Waves survived', r.waves || 0], ['Evolutions', r.evolutions || 0],
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
    const p = g.player, e = this.el, fx = this.fx;
    const now = performance.now();
    const dt = Math.min(0.1, (now - (fx.last || now)) / 1000);
    fx.last = now;
    const hpFrac = clamp(p.hp / p.stats.maxHp, 0, 1);
    e.hpFill.style.width = `${hpFrac * 100}%`;
    e.hpText.textContent = `HP ${Math.max(0, Math.ceil(p.hp))} / ${Math.round(p.stats.maxHp)}`;
    // the white "ghost" bar holds where the health was, then drains down to it
    if (fx.hp >= 0 && p.hp < fx.hp - 0.5) {
      fx.ghostHold = 0.4;
      fx.hurtT = 0.45;
      e.portrait.classList.remove('hurt'); void e.portrait.offsetWidth; e.portrait.classList.add('hurt');
      if (!reducedMotion && e.vignette.animate) e.vignette.animate([{ opacity: 0.9 }, { opacity: 0 }], { duration: 260, easing: 'steps(3)' });
    }
    fx.hp = p.hp;
    fx.ghostHold -= dt;
    if (hpFrac >= fx.ghost) fx.ghost = hpFrac;
    else if (fx.ghostHold <= 0) fx.ghost = Math.max(hpFrac, fx.ghost - dt * 0.7);
    e.hpGhost.style.width = `${fx.ghost * 100}%`;
    fx.hurtT -= dt;
    if (fx.hurtT <= 0) e.portrait.classList.remove('hurt');
    const low = hpFrac < 0.3 && p.alive;
    e.portrait.classList.toggle('low', low);
    e.vignette.classList.toggle('low', low);
    e.portrait.classList.toggle('hype', p.ult >= 1 || p.buffs.berserkT > 0);
    e.ultFill.style.width = `${p.ult * 100}%`;
    e.ultLabel.classList.toggle('ready', p.ult >= 1);
    e.ultBar.classList.toggle('ready', p.ult >= 1);
    e.dodge.style.width = `${(1 - clamp(p.dodgeCd / p.stats.dodgeCd, 0, 1)) * 100}%`;
    e.xpFill.style.width = `${(p.xp / p.xpNext) * 100}%`;
    if (p.level !== fx.level) { if (fx.level >= 0) pop(e.lvlBadge, 'scale(1.8) rotate(-30deg)'); fx.level = p.level; e.level.textContent = p.level; }
    if (p.shards !== fx.shards) { if (fx.shards >= 0 && p.shards > fx.shards) pop(e.chipShards, 'scale(1.35) translateY(-4px)', 'skewX(-12deg)'); fx.shards = p.shards; e.shards.textContent = p.shards; }
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
    if (obj !== this._lastObj) {
      // only pop when the objective itself changes, not on every timer tick
      const kind = obj.replace(/<[^>]+>|[\d:%/]+/g, '');
      if (this._lastObj !== undefined && kind !== this._lastObjKind) pop(e.objective, 'scale(1.25)', 'translateX(-50%) skewX(-10deg)');
      e.objective.innerHTML = obj; this._lastObj = obj; this._lastObjKind = kind;
    }
    // wave tracker
    const sp = g.spawner;
    if (g.mode === 'open' && sp) {
      const label = sp.active ? `${sp.kind === 'elite' ? 'Elite wave' : sp.kind === 'tide' ? 'Tide wave' : 'Wave'} ${g.wavesTotal}` : `Next wave ${Math.ceil(Math.max(0, sp.breathT))}s`;
      if (label !== fx.wave) { e.waveLabel.textContent = label; fx.wave = label; e.wave.className = sp.active ? sp.kind : 'rest'; pop(e.waveLabel, 'scale(1.3)'); }
      e.waveFill.style.width = `${(sp.active ? 1 - sp.progress : 0) * 100}%`;
      e.wave.style.display = '';
    } else e.wave.style.display = 'none';
    // boss
    if (g.boss && g.boss.alive && g.boss.state !== 'spawn') {
      e.boss.classList.remove('hidden');
      e.bossName.textContent = g.boss.name;
      const bf = clamp(g.boss.hp / g.boss.maxHp, 0, 1);
      if (fx.bossId !== g.boss) { fx.bossId = g.boss; fx.bossGhost = bf; }
      if (bf < fx.bossGhost - 0.001) fx.bossHold = fx.bossHold > 0 ? fx.bossHold : 0.35;
      fx.bossHold -= dt;
      if (fx.bossHold <= 0) fx.bossGhost = Math.max(bf, fx.bossGhost - dt * 0.5);
      e.bossFill.style.width = `${bf * 100}%`;
      e.bossGhost.style.width = `${fx.bossGhost * 100}%`;
    } else e.boss.classList.add('hidden');
    this._updateSlots(g, p);
    const bk = p.buffs.berserkT > 0 ? `<span class="buff">Berserk ${p.buffs.berserkT.toFixed(1)}s</span>` : '';
    if (bk !== this._lastBuff) { e.buffs.innerHTML = bk; this._lastBuff = bk; }
  }

  /** The four-slot bar: rebuilt when the loadout changes, cooldowns and ammo updated every frame. */
  _updateSlots(g, p) {
    const L = p.loadout, fx = this.fx;
    const ready = new Set(L.readyEvolutions(p.stats.evoDiscount || 0).map((r) => r.base));
    const key = SLOTS.map((k) => { const s = L.get(k); return s ? `${s.id}:${s.level}` : '-'; }).join('|') + [...ready].join(',');
    if (key !== fx.slotKey) {
      fx.slotKey = key;
      this.el.slots.innerHTML = SLOTS.map((k) => {
        const s = L.get(k), info = SLOT_INFO[k];
        if (!s) return `<div class="slot empty" data-slot="${k}"><div class="slot-key">${info.key} · ${info.name}</div></div>`;
        const def = ITEMS[s.id];
        const lv = def.evolved ? '<div class="slot-lv evo">EVOLVED</div>' : `<div class="slot-lv">${Array.from({ length: MAX_LEVEL }, (_, i) => `<i class="${i < s.level ? 'on' : ''}"></i>`).join('')}</div>`;
        const marks = def.evolved ? '' : recipesFor(s.id).map((r) => {
          const partner = r.base === s.id ? r.with : r.base;
          return `<b class="${L.has(partner) ? 'lit' : ''}" style="--mc:${r.color}" title="${esc(ITEMS[r.into].name)}">${esc(r.mark)}</b>`;
        }).join('');
        return `<div class="slot${ready.has(s.id) ? ' ready-evo' : ''}" data-slot="${k}"><div class="slot-key">${info.key}</div><div class="slot-icon">${esc(def.icon)}</div><div class="slot-cd"></div>${lv}<div class="slot-marks">${marks}</div><span class="slot-ammo"></span><div class="slot-name">${esc(def.name)}</div></div>`;
      }).join('');
      this._slotEls = {};
      for (const el of this.el.slots.children) this._slotEls[el.dataset.slot] = el;
    }
    for (const k of SLOTS) {
      const s = L.get(k), el = this._slotEls && this._slotEls[k];
      if (!s || !el) continue;
      const cd = s.max > 0 ? Math.max(0, s.cd) / s.max : 0;
      const shown = k === 'arms' && cd < 0.99 ? 0 : cd;
      el.style.setProperty('--cd', (s.state.reloadT > 0 ? 1 : shown).toFixed(3));
      if (s.state.ammo !== undefined) {
        const t = s.state.reloadT > 0 ? 'RELOAD' : `${s.state.ammo}`;
        const a = el.querySelector('.slot-ammo');
        if (a && a.textContent !== t) a.textContent = t;
      }
      // a pop the moment an ability comes off cooldown
      if (s._wasCd && cd <= 0 && k !== 'arms') pop(el, 'scale(1.25)', 'skewX(-8deg)');
      s._wasCd = cd > 0;
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
    this.hudEl.classList.toggle('wiping', !!g.transition);
    if (g.state !== 'title') this._drawWorldUi(ctx, g, W, H);
    if (g.transition) this._wipe(ctx, g, W, H);
  }

  _drawWorldUi(ctx, g, W, H) {
    const P = this.pal;
    const vp = g.R.vp;
    const t = this.tmp;
    // held on twos, like the animation: prompts jitter between two drawings
    const two = Math.floor(g.time * 12) % 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    // damage numbers: inked italic numerals that overshoot in; crits get a starburst
    for (const n of g.numbers) {
      if (!project(vp, n.x + n.ox, n.y, n.z, W, H, t)) continue;
      const life = 0.9 - n.t;
      const popS = life < 0.06 ? 0.4 + (life / 0.06) * 1.2 : life < 0.14 ? 1.6 - ((life - 0.06) / 0.08) * 0.6 : 1;
      const size = (n.crit ? 30 : 19) * clamp(14 / t[2], 0.55, 1.4) * popS;
      ctx.globalAlpha = clamp(n.t / 0.25, 0, 1);
      ctx.save();
      ctx.translate(t[0], t[1]);
      ctx.rotate(n.crit ? -0.14 : -0.05);
      if (n.crit) {
        this._burst(ctx, 0, 0, size * 1.25, size * 0.85, 12, life * 3);
        ctx.fillStyle = P.accent; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = P.ink; ctx.stroke();
      }
      const col = n.crit ? P.gold : `rgb(${n.color.map((v) => Math.round(170 + v * 85)).join(',')})`;
      this._inkText(ctx, n.crit ? `${n.v}!` : `${n.v}`, 0, 0, `italic ${size}px ${DISPLAY}`, col, Math.max(3, size * 0.2), Math.max(2, size * 0.1));
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    // enemy health: slanted inked bars, elites get a name tag
    for (const e of g.enemies) {
      if (!e.alive || e.boss || (!e.elite && e.hp >= e.maxHp) || e.state === 'spawn') continue;
      if (!project(vp, e.x, e.y + 2.3 * e.size + (e.hover || 0), e.z, W, H, t) || t[2] > 40) continue;
      const w = e.elite ? 64 : 36, h = e.elite ? 7 : 5;
      ctx.save();
      ctx.translate(t[0] - w / 2, t[1]);
      ctx.transform(1, 0, -0.4, 1, 0, 0);
      ctx.fillStyle = P.ink; ctx.fillRect(-2, -2, w + 4, h + 4);
      ctx.fillStyle = e.elite ? P.hi : P.accent; ctx.fillRect(0, 0, w * clamp(e.hp / e.maxHp, 0, 1), h);
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(0, 0, w * clamp(e.hp / e.maxHp, 0, 1), 2);
      ctx.restore();
      if (e.elite) this._inkText(ctx, `ELDRITCH ${e.name.toUpperCase()}`, t[0], t[1] - 11, `italic 12px ${DISPLAY}`, P.hi, 3, 0);
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
    // interaction prompt: a speech bubble over the container
    if (g.nearChest && g.state === 'play') {
      const ch = g.nearChest;
      if (project(vp, ch.x, ch.y + 2.3, ch.z, W, H, t)) {
        const cost = W_.chestCost(ch, g.player.stats.chestDiscount);
        const afford = g.player.shards >= cost;
        this._bubble(ctx, t[0], t[1] - 6, `Open ${CHEST_TIERS[ch.tier].name}`, `${cost} ◆`, 'E', afford);
      }
    }
    if (g.state === 'play' && g.player.alive) {
      if (g.player.ult >= 1) this._banner(ctx, W / 2, H * 0.7, 'REND REALITY READY', 'R', two ? P.gold : P.hi, 17, 0.04);
      if (g.timeStopT > 0) this._banner(ctx, W / 2 + (two ? 2 : -2), H * 0.2, 'TIME STOP', '', P.cyan, 30, -0.05);
      if (g.lock && g.lock.alive) this._reticle(ctx, g, g.lock, W, H);
      if (!g.input.locked && !g.input.usingPad) this._banner(ctx, W / 2, H - 52, 'Click the screen to enable mouse look', '', P.paper, 13, 0, true);
    }
  }

  /** Lock-on reticle: four inked brackets that close in and step round on twos, plus the target's health. */
  _reticle(ctx, g, e, W, H) {
    const P = this.pal, t = this.tmp;
    const hy = e.y + (e.boss ? (e.cy ? e.cy - e.y : 2.4 * e.size) : 1.1 * e.size);
    if (!project(g.R.vp, e.x, hy, e.z, W, H, t)) return;
    const r = clamp((e.boss ? 140 : 46) * e.size / Math.max(4, t[2]) * 6, 22, 120);
    const step = Math.floor(g.time * 8) / 8;
    ctx.save();
    ctx.translate(t[0], t[1]);
    ctx.rotate(step * 0.6);
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath(); ctx.moveTo(r, -r * 0.35); ctx.lineTo(r, -r); ctx.lineTo(r * 0.65, -r);
      ctx.lineWidth = 7; ctx.strokeStyle = P.ink; ctx.stroke();
      ctx.lineWidth = 3; ctx.strokeStyle = P.accent; ctx.stroke();
    }
    ctx.restore();
    // health under the reticle
    const w = 70, f = clamp(e.hp / e.maxHp, 0, 1);
    ctx.save();
    ctx.translate(t[0] - w / 2, t[1] + r + 14);
    ctx.transform(1, 0, -0.35, 1, 0, 0);
    ctx.fillStyle = P.ink; ctx.fillRect(-2, -2, w + 4, 9);
    ctx.fillStyle = P.accent; ctx.fillRect(0, 0, w * f, 5);
    ctx.restore();
    this._inkText(ctx, e.name.toUpperCase(), t[0], t[1] + r + 30, `italic 13px ${DISPLAY}`, P.paper, 3, 2);
  }

  /** Display text with a hard ink outline and offset drop shadow. */
  _inkText(ctx, text, x, y, font, fill, outline, drop) {
    ctx.font = font;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = this.pal.ink;
    ctx.fillStyle = this.pal.ink;
    if (drop) {
      ctx.lineWidth = outline;
      ctx.strokeText(text, x + drop, y + drop);
      ctx.fillText(text, x + drop, y + drop);
    }
    ctx.lineWidth = outline;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
  }

  _burst(ctx, x, y, r1, r2, n, rot) {
    ctx.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const a = rot + (i / (n * 2)) * Math.PI * 2;
      const r = i % 2 ? r2 : r1;
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
  }

  _keycap(ctx, x, y, key, size) {
    const P = this.pal;
    ctx.font = `${size}px ${DISPLAY}`;
    const w = Math.max(size * 1.3, ctx.measureText(key).width + size * 0.7), h = size * 1.35;
    ctx.fillStyle = P.ink; ctx.fillRect(x - w / 2 + 2, y - h / 2 + 2, w, h);
    ctx.fillStyle = P.paper; ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.lineWidth = 2; ctx.strokeStyle = P.ink; ctx.strokeRect(x - w / 2, y - h / 2, w, h);
    ctx.fillStyle = P.ink; ctx.fillText(key, x, y + 1);
    return w;
  }

  /** Slanted manga banner with optional keycap, used for combat prompts. */
  _banner(ctx, x, y, text, key, color, size, rot, quiet = false) {
    const P = this.pal;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.font = quiet ? `600 ${size}px ${BODY}` : `italic ${size}px ${DISPLAY}`;
    const tw = ctx.measureText(text).width;
    const kw = key ? size * 1.6 + (key.length - 1) * size * 0.5 : 0;
    const w = tw + kw + size * 1.6, h = size * 1.7, sk = h * 0.35;
    const path = () => { ctx.beginPath(); ctx.moveTo(-w / 2 + sk, -h / 2); ctx.lineTo(w / 2 + sk, -h / 2); ctx.lineTo(w / 2 - sk, h / 2); ctx.lineTo(-w / 2 - sk, h / 2); ctx.closePath(); };
    ctx.translate(4, 4); path(); ctx.fillStyle = P.ink; ctx.globalAlpha = quiet ? 0.6 : 1; ctx.fill(); ctx.translate(-4, -4);
    path(); ctx.fillStyle = quiet ? 'rgba(20,12,24,0.75)' : color; ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = quiet ? 1.5 : 3; ctx.strokeStyle = quiet ? color : P.ink; ctx.stroke();
    ctx.fillStyle = quiet ? color : P.ink;
    ctx.fillText(text, -kw / 2, 1);
    if (key) this._keycap(ctx, w / 2 - kw / 2 - size * 0.5, 0, key, size * 0.62);
    ctx.restore();
  }

  /** Speech bubble with a tail, for interaction prompts. */
  _bubble(ctx, x, y, text, price, key, ok) {
    const P = this.pal;
    ctx.font = `700 14px ${BODY}`;
    const tw = ctx.measureText(text).width;
    ctx.font = `16px ${DISPLAY}`;
    const pw = ctx.measureText(price).width;
    const w = tw + pw + 64, h = 32, bx = x - w / 2, by = y - h - 12;
    const path = () => {
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(bx, by, w, h, 14) : ctx.rect(bx, by, w, h);
      ctx.moveTo(x - 8, by + h - 1); ctx.lineTo(x + 2, y); ctx.lineTo(x + 10, by + h - 1);
    };
    ctx.save();
    ctx.translate(3, 3); path(); ctx.fillStyle = P.ink; ctx.fill(); ctx.translate(-3, -3);
    path(); ctx.fillStyle = P.paper; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = P.ink; ctx.stroke();
    // cover the seam between the bubble and its tail
    ctx.fillStyle = P.paper; ctx.fillRect(x - 7, by + h - 4, 16, 5);
    this._keycap(ctx, bx + 18, by + h / 2, key, 11);
    ctx.font = `700 14px ${BODY}`; ctx.fillStyle = P.ink; ctx.textAlign = 'left';
    ctx.fillText(text, bx + 34, by + h / 2 + 1);
    ctx.font = `16px ${DISPLAY}`; ctx.fillStyle = ok ? P.accent : '#8a8090';
    ctx.fillText(price, bx + 42 + tw, by + h / 2 + 1);
    ctx.textAlign = 'center';
    ctx.restore();
  }

  /** Scene transition: a slanted ink wipe with a coloured leading stripe, synced to the renderer's fade. */
  _wipe(ctx, g, W, H) {
    const P = this.pal;
    const tr = g.transition;
    const c = clamp(1 - g.R.post_.fade, 0, 1);
    const ease = c * c * (3 - 2 * c);
    const sk = H * 0.4, span = W + sk * 2 + 60;
    let x0, x1;
    if (!tr.done) { x0 = -sk - 60; x1 = -sk + ease * span; } else { x0 = -sk + (1 - ease) * span; x1 = W + sk + 60; }
    const quad = (a, b) => { ctx.beginPath(); ctx.moveTo(a + sk, 0); ctx.lineTo(b + sk, 0); ctx.lineTo(b, H); ctx.lineTo(a, H); ctx.closePath(); };
    ctx.save();
    quad(x0, x1); ctx.fillStyle = P.ink; ctx.fill();
    // coloured stripes ride the moving edge
    const edge = tr.done ? x0 : x1, dir = tr.done ? -1 : 1;
    quad(edge, edge + dir * 26); ctx.fillStyle = P.accent; ctx.fill();
    quad(edge + dir * 34, edge + dir * 42); ctx.fillStyle = P.paper; ctx.fill();
    ctx.restore();
  }

  _marker(ctx, vp, m, W, H, g) {
    const P = this.pal;
    const t = this.tmp;
    const on = project(vp, m.x, m.y, m.z, W, H, t);
    const d = Math.hypot(m.x - g.player.x, m.z - g.player.z);
    let x = t[0], y = t[1];
    const margin = 46;
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
    ctx.lineJoin = 'round';
    const diamond = (r) => { ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.8, 0); ctx.lineTo(0, r); ctx.lineTo(-r * 0.8, 0); ctx.closePath(); };
    if (m.small) {
      ctx.globalAlpha = clamp(1 - m.dist / 38, 0.25, 1);
      diamond(8); ctx.fillStyle = m.color; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = P.ink; ctx.stroke();
    } else {
      // on twos: the ring steps round rather than spinning smoothly
      const step = Math.floor(g.time * 8) / 8;
      if (m.big) {
        ctx.save();
        ctx.rotate(step * 1.5);
        ctx.setLineDash([6, 5]); ctx.lineWidth = 3; ctx.strokeStyle = m.color;
        ctx.beginPath(); ctx.arc(0, 0, 18 + (Math.floor(g.time * 6) % 2) * 2, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      ctx.translate(2, 2); diamond(13); ctx.fillStyle = P.ink; ctx.fill(); ctx.translate(-2, -2);
      diamond(13); ctx.fillStyle = P.paper; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = P.ink; ctx.stroke();
      diamond(6); ctx.fillStyle = m.color; ctx.fill();
      this._inkText(ctx, m.label, 0, -26, `italic 14px ${DISPLAY}`, m.color, 4, 2);
      ctx.font = `700 11px ${BODY}`;
      const dl = `${Math.round(d)}m`;
      const dw = ctx.measureText(dl).width + 10;
      ctx.fillStyle = P.ink; ctx.fillRect(-dw / 2, 17, dw, 15);
      ctx.fillStyle = P.paper; ctx.fillText(dl, 0, 25);
    }
    ctx.restore();
  }
}
