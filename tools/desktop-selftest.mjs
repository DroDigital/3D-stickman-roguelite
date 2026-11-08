// Runs the desktop launcher in self-test mode: it loads the game, waits for the title screen and the assets, saves
// tools/shots/desktop-selftest.png and exits. On Linux without a display, run it under xvfb-run.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const electron = require('electron'); // the path to the downloaded Electron binary
const shot = path.join(root, 'tools', 'shots', 'desktop-selftest.png');
fs.mkdirSync(path.dirname(shot), { recursive: true });
fs.rmSync(shot, { force: true });

// --no-sandbox is read from the command line by Chromium, so it must be passed here (not via app.commandLine)
const child = spawn(electron, ['--no-sandbox', path.join(root, 'desktop', 'main.cjs')], {
  env: { ...process.env, ABYSSAL_SELFTEST: shot },
  stdio: ['ignore', 'inherit', 'inherit'],
});
const code = await new Promise((resolve) => child.on('exit', (c) => resolve(c ?? 1)));
if (code !== 0) { console.error(`desktop self-test failed (exit ${code})`); process.exit(code); }
if (!fs.existsSync(shot) || fs.statSync(shot).size < 10000) { console.error('desktop self-test: no screenshot written'); process.exit(1); }
console.log('desktop self-test passed:', shot);
