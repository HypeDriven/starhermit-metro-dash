// Localization access for the game modules (content.js): the tables and the
// lookup are the engine's strings (native/i18n.ts sets the global MDI18N, in the
// player's interface language); outside
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
