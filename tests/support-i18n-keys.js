// Collects every user-facing string the game can show, for the localisation tests.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

/** Every user-facing string the game can show: literal L("...") calls plus the data strings it displays. */
function collectKeys() {
  const keys = new Set();
  const srcFiles = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) { if (!p.includes('locales')) walk(p); } else if (f.name.endsWith('.js')) srcFiles.push(p);
    }
  };
  walk('src');
  for (const f of srcFiles) {
    if (f.endsWith('i18n.js')) continue;
    const s = read(f);
    for (const m of s.matchAll(/\bL\(\s*(['"])((?:(?!\1)[^\\\n]|\\.)*?)\1/g)) keys.add(m[2].replace(/\\(.)/g, '$1'));
  }
  // data strings shown directly (names, descriptions, titles and subtitles of items, skills, bosses and so on)
  const dataFiles = ['src/game/meta.js', 'src/game/upgrades.js', 'src/game/arsenal.js', 'src/game/dimensions.js',
    'src/game/enemies.js', 'src/game/bosses.js', 'src/game/world.js', 'src/game/config.js'];
  for (const f of dataFiles) {
    for (const m of read(f).matchAll(/\b(name|sub|title|desc|hint):\s*(['"])((?:(?!\2)[^\\\n]|\\.)*?)\2/g)) keys.add(m[3].replace(/\\(.)/g, '$1'));
  }
  for (const m of read('src/game/bosses.js').matchAll(/e\.name = '([^']+)'/g)) keys.add(m[1]);
  // static HTML: plain-text data-i18n elements and option-group labels
  const html = read('index.html');
  for (const m of html.matchAll(/data-i18n[^>]*>([^<]+)</g)) { const t = m[1].trim(); if (t) keys.add(t); }
  for (const m of html.matchAll(/label="([^"]+)" data-i18n-label/g)) keys.add(m[1]);
  // a few strings are assembled by the game and displayed directly
  for (const k of ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Eldritch', 'Reliquary', 'Ossuary Casket', 'Eldritch Coffer']) keys.add(k);
  return keys;
}

export { collectKeys };
