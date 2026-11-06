// Localization: the engine's string tables (assets/strings.json, generated from
// the browser build's tables: the nine StarHermit locales, English text as the
// key) in the interface language the runtime reports (preferences().language:
// the player's choice in Options › Language, else the account's preferred
// language or the device's). The runtime's Options replaced the game's Language
// setting (sh-language.js) and the DOM re-labelling: every string is drawn
// through T() each frame, so a change shows on the next frame without touching
// the run. The account lines are the engine's `starhermit.*` keys. js/lang.js
// (the content's T, used by the game modules) reads the MDI18N global below.
import { strings } from "starhermit:engine";
import * as ui from "starhermit:ui";

strings.load("assets/strings.json");
strings.defaultLocale = "en-US";
ui.setLanguage(strings.locale);
strings.onChange((locale) => ui.setLanguage(locale));
export function currentLocale(): string { return strings.locale; }

export type Vars = Record<string, string | number>;
/** A game string by its English key in the player's language; `{name}` placeholders from vars. */
export function T(key: string, vars?: Vars | null): string { return strings.t(String(key), vars ?? undefined); }
/** Marks an English key; translated with T() where it is shown. */
export const N = (key: string): string => key;
(globalThis as unknown as { MDI18N: unknown }).MDI18N = { T, get lang() { return strings.locale; } };
/** A whole number with the language's digit grouping (ui.js fmtScore). */
export function fmt(n: number): string {
  const v = Math.floor(n);
  try { return v.toLocaleString(strings.locale); } catch { return String(v); }
}
