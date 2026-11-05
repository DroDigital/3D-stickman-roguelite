// Entry point: boots renderer, input, audio, meta save, UI and the main loop.
import { Renderer } from './gfx/renderer.js';
import { Input } from './core/input.js';
import { audio } from './core/audio.js';
import { Meta, DEFAULT_STYLE } from './game/meta.js';
import { UI } from './ui/ui.js';
import { Game } from './game/game.js';
import { setLang, detectLang } from './core/i18n.js';

function fatal(msg) {
  const el = document.getElementById('fatal');
  el.classList.remove('hidden');
  el.innerHTML = `<div><h2>The abyss refused to open</h2><p>${msg}</p></div>`;
  console.error(msg);
}

function boot() {
  const canvas = document.getElementById('gl');
  let R;
  try {
    R = new Renderer(canvas);
  } catch (e) {
    fatal(e.message);
    return;
  }
  const meta = new Meta();
  R.setQuality(meta.data.settings.quality);
  audio.setVolume(meta.data.settings.volume);
  const input = new Input(canvas);
  // language: the saved choice, else the browser's language when we have it, else English
  setLang(meta.data.settings.lang || detectLang());
  const ui = new UI(meta, audio);
  const game = new Game(R, input, audio, ui, meta);
  // art style: ?style=retro|requiem|sutra|lantern|requiem+neon… overrides the saved choice (handy for previews)
  // ("+" in a query string decodes to a space, so restore it for combination ids like requiem+neon)
  const urlStyle = (new URLSearchParams(location.search).get('style') || '').replace(/ /g, '+');
  game.setStyle(urlStyle || meta.data.settings.style || DEFAULT_STYLE);
  ui.bind(game);
  window.__game = game; // handy for debugging / automated smoke tests

  // pause when pointer lock is lost mid-run (e.g. Esc in the browser)
  let hadLock = false;
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    if (!locked && hadLock && game.state === 'play') game.pause();
    hadLock = locked;
  });
  canvas.addEventListener('click', () => {
    if (game.state === 'play' && !input.locked) input.requestLock();
  });

  const perf = { update: 0, render: 0 };
  window.__perf = perf;
  let last = performance.now();
  let fpsAcc = 0, fpsN = 0;
  function frame(now) {
    const real = Math.max(0, (now - last) / 1000);
    const dt = Math.min(0.05, real);
    last = now;
    fpsAcc += real; fpsN++;
    if (fpsAcc > 1) { game.fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
    try {
      const t0 = performance.now();
      game.update(dt);
      const t1 = performance.now();
      game.render(dt);
      const t2 = performance.now();
      perf.update += (t1 - t0 - perf.update) * 0.05;
      perf.render += (t2 - t1 - perf.render) * 0.05;
    } catch (e) {
      fatal(e.stack || e.message);
      throw e;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot();
