import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';


import { L, setLang, LANGS, detectLang, _DICT } from '../src/core/i18n.js';
import { collectKeys } from './support-i18n-keys.js';

const LANG_IDS = LANGS.map((l) => l.id).filter((id) => id !== 'en');

const KEYS = collectKeys();
const placeholders = (s) => new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

test('the English text is the source and resolves with variables', () => {
  setLang('en');
  assert.equal(L('+{v} damage', { v: 12 }), '+12 damage');
  assert.equal(L('Plain text'), 'Plain text');
  setLang('en');
});

test('every user-facing string has a German and a Spanish translation', () => {
  const missing = [];
  for (const id of LANG_IDS) {
    for (const k of KEYS) if (!_DICT[id][k]) missing.push(`${id}: ${k}`);
  }
  assert.deepEqual(missing, [], `${missing.length} untranslated strings`);
});

test('translations keep every {placeholder} of their English text', () => {
  const bad = [];
  for (const id of LANG_IDS) {
    for (const [k, v] of Object.entries(_DICT[id])) {
      const a = [...placeholders(k)].sort().join(','), b = [...placeholders(v)].sort().join(',');
      if (a !== b) bad.push(`${id}: "${k}" -> "${v}"`);
    }
  }
  assert.deepEqual(bad, []);
});

test('no stale translations for strings the game no longer shows', () => {
  const stale = [];
  for (const id of LANG_IDS) for (const k of Object.keys(_DICT[id])) if (!KEYS.has(k)) stale.push(`${id}: ${k}`);
  assert.deepEqual(stale, []);
});

test('language detection and fallback', () => {
  assert.equal(detectLang({ languages: ['de-DE', 'en'], language: 'de-DE' }), 'de');
  assert.equal(detectLang({ languages: ['es-MX'], language: 'es-MX' }), 'es');
  assert.equal(detectLang({ languages: ['fr-FR'], language: 'fr-FR' }), 'en');
  setLang('de');
  assert.equal(L('Begin Descent'), _DICT.de['Begin Descent']);
  setLang('xx');
  assert.equal(L('Begin Descent'), 'Begin Descent');
  setLang('en');
});
