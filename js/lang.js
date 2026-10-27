// Localization access for the game modules (content.js): the tables and the
// lookup live in js/strings.js + js/i18n.js (global MDI18N, which the engine
// client loads and switches with the player's interface language); outside
// the engine (Node tests) English keys come back unchanged.

/** Translate an English source string; {name} placeholders are filled from vars. */
export function T(key, vars) {
  const I = globalThis.MDI18N;
  if (I) return I.T(key, vars);
  return vars ? String(key).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : String(key);
}

/** Marks an English key for a later T() (content tables). */
export const N = (key) => key;

/** The game's current locale. */
export function lang() {
  return globalThis.MDI18N?.lang ?? 'en-US';
}
