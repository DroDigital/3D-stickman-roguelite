// Localisation. The English text is the key: L("+{v} damage", { v: 10 }) returns the active language's
// translation, or the English text when a translation is missing. Placeholders are written {name}.
import de from './locales/de.js';
import es from './locales/es.js';

export const LANGS = [
  { id: 'en', name: 'English' },
  { id: 'de', name: 'Deutsch' },
  { id: 'es', name: 'Español' },
];

const DICT = { de, es };
let lang = 'en';

/** Pick a supported language from the browser, falling back to English. */
export function detectLang(nav = typeof navigator !== 'undefined' ? navigator : null) {
  const langs = nav ? [...(nav.languages || []), nav.language || ''] : [];
  for (const l of langs) {
    const id = String(l).slice(0, 2).toLowerCase();
    if (DICT[id]) return id;
  }
  return 'en';
}

export function setLang(id) { lang = DICT[id] ? id : 'en'; }
export function getLang() { return lang; }

export function L(src, vars) {
  let s = (lang !== 'en' && DICT[lang][src]) || src;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

/** Translate every static element marked data-i18n (its English text is remembered on first use). */
export function applyStaticI18n(root = typeof document !== 'undefined' ? document : null) {
  if (!root) return;
  for (const el of root.querySelectorAll('[data-i18n]')) {
    if (!el.dataset.en) el.dataset.en = el.textContent.trim();
    el.textContent = L(el.dataset.en);
  }
  // option groups carry their English name in the label attribute
  for (const el of root.querySelectorAll('[data-i18n-label]')) {
    if (!el.dataset.en) el.dataset.en = el.label;
    el.label = L(el.dataset.en);
  }
}

export const _DICT = DICT; // exposed for the coverage test
