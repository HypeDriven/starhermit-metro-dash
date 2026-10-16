// Localization access for the game modules. The tables and the runtime live
// in js/strings.js + js/i18n.js (classic scripts loaded before js/main.js,
// global MDI18N); outside the browser (Node tests) English keys come back
// unchanged.

/** Translate an English source string; {name} placeholders are filled from vars. */
export function T(key, vars) {
  const I = globalThis.MDI18N;
  if (I) return I.T(key, vars);
  return vars ? String(key).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : String(key);
}

/** Marks an English key for a later T() (content tables). */
export const N = (key) => key;

/** The game's current locale (navigator language outside the runtime). */
export function lang() {
  return globalThis.MDI18N?.lang ?? (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
}

/** Run cb whenever the player changes the language (Settings → Language). */
export function onLanguage(cb) {
  if (typeof document !== 'undefined') document.addEventListener('md-language', () => cb());
}
