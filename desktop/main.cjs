// Desktop launcher for Abyssal Stride (Windows, macOS, Linux). The game runs in its own window from the same files as
// the web build. It is served from a private app:// origin, so saves and settings (localStorage) persist per install
// and ES modules load without a web server.
//
//   npm run desktop              run the launcher from the source tree
//   npm run dist                 build installers for this platform (see README)
//   npm run desktop:selftest     load the game headlessly, save a screenshot, exit (used by CI)
'use strict';
const { app, BrowserWindow, Menu, protocol, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'app://game';
const SELFTEST = process.env.ABYSSAL_SELFTEST || '';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg',
  '.bin': 'application/octet-stream', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};

// the window and the userData folder (saves, settings) share one name on every platform, dev or installed
app.setName('Abyssal Stride');

// a self-test or an AppImage runs without the Chromium sandbox: Ubuntu's AppArmor restrictions block its setup, and the
// content is only this app's own files
if (SELFTEST || (process.platform === 'linux' && process.env.APPIMAGE)) app.commandLine.appendSwitch('no-sandbox');
if (SELFTEST) {
  // software WebGL keeps the self-test working on machines without a GPU
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
}
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });
}

/** Serves the game's own files. Anything outside the project folder is refused. */
function serve(request) {
  let rel;
  try {
    rel = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return new Response('bad request', { status: 400 });
  }
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return new Response('forbidden', { status: 403 });
  let body;
  try {
    body = fs.readFileSync(file);
  } catch {
    return new Response('not found', { status: 404 });
  }
  return new Response(body, {
    headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' },
  });
}

function iconPath() {
  const name = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  return path.join(__dirname, 'icons', name);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'Game',
      submenu: [
        { role: 'togglefullscreen' },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit', label: 'Quit Abyssal Stride' }]),
      ],
    },
    ...(app.isPackaged ? [] : [{ label: 'Developer', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }] }]),
  ];
  return Menu.buildFromTemplate(template);
}

function createWindow() {
  const win = new BrowserWindow({
    width: SELFTEST ? 960 : 1600,
    height: SELFTEST ? 540 : 900,
    minWidth: 960,
    minHeight: 540,
    title: 'Abyssal Stride',
    backgroundColor: '#030204',
    show: false,
    icon: iconPath(),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.once('ready-to-show', () => win.show());
  // links leave in the browser, and the window never navigates away from the game
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ORIGIN + '/')) event.preventDefault();
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('renderer went away:', details.reason);
  });
  win.loadURL(`${ORIGIN}/index.html${SELFTEST ? '?gfx=low&adaptive=0' : ''}`);
  if (SELFTEST) selfTest(win);
  return win;
}

/** Waits for the game to be on its title screen with the assets loaded, saves a screenshot, and exits. */
function selfTest(win) {
  const errors = [];
  win.webContents.on('console-message', (...args) => {
    // Electron passes either (event, level, message, …) or (event, details); accept both shapes
    const details = typeof args[1] === 'object' && args[1] !== null ? args[1] : { level: args[1], message: args[2] };
    if (details.level === 3 || details.level === 'error') errors.push(String(details.message).slice(0, 300));
  });
  const deadline = Date.now() + 300000;
  const poll = async () => {
    if (Date.now() > deadline) {
      console.error('SELFTEST_FAIL timed out', errors.slice(0, 5));
      app.exit(1);
      return;
    }
    let ready = false;
    try {
      ready = await win.webContents.executeJavaScript(
        "!!(window.__game && window.__game.state === 'title' && window.__assets && window.__game.time > 1)", true);
    } catch { ready = false; }
    if (!ready) { setTimeout(poll, 500); return; }
    setTimeout(async () => {
      try {
        const info = await win.webContents.executeJavaScript(
          "(async () => { const assets = await window.__assets; return { cine: !!(window.__game.R.cine && window.__game.R.cine.ok), " +
          "style: window.__game.style && window.__game.style.id, assets: assets && assets.errors.length === 0 ? 'loaded' : 'partial' }; })()", true);
        const shot = await win.webContents.capturePage();
        fs.writeFileSync(SELFTEST, shot.toPNG());
        console.log('SELFTEST_OK', JSON.stringify({ ...info, errors: errors.length, png: SELFTEST }));
        app.exit(errors.length ? 2 : 0);
      } catch (e) {
        console.error('SELFTEST_FAIL', e.message);
        app.exit(1);
      }
    }, 4000);
  };
  win.webContents.once('did-finish-load', poll);
}

app.whenReady().then(() => {
  protocol.handle('app', serve);
  Menu.setApplicationMenu(buildMenu());
  if (process.platform === 'darwin' && app.dock) app.dock.setIcon(path.join(__dirname, 'icons', 'icon-1024.png'));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
