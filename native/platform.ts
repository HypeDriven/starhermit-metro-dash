// The game's data and the StarHermit platform, on the runtime's modules:
// - the save (js/save.js: the progression, the achievements and the local
//   runs board — the browser build's cloud mirror without its settings) is
//   the game's save (starhermit:storage `saves`), on the device and in the
//   player's cloud slot; two devices' copies merge on a conflict as the
//   browser build's saveconflict merge did (js/save.js merge). The slot the
//   browser build wrote (the JS SDK's saveJSON of { v, settings, progression,
//   achievements, leaderboard } under game:<slug>) shows as foreign: it is
//   merged in and replaced once;
// - the game's own options (colour palette, left-handed touch tray, hints)
//   are engine `settings` (same keys, synced with the account); the browser
//   build's values in the account's settings KV are adopted (unless set here
//   since), then all its KV keys are removed (volumes, graphics, reduced
//   motion, high contrast, larger text and language are the runtime's
//   Options; key bindings are the runtime's controls);
// - the player, the invite link, the platform's clock for the Daily and the
//   top bar's UTC clock, and posting a finished run's total through
//   score-script.js (a practice session whose socket carries { type:
//   'result', scores }, as the JS SDK's submitScores did) with the rank on
//   the high-score board.
import type { JsonValue } from "starhermit:engine";
import {
  connectGame, inviteLink as fetchInviteLink, leaderboards, onPlayerChange, player, serverNow, serverTime, sessions, type Leaderboard,
} from "starhermit:platform";
import { saves, settings as store } from "starhermit:storage";
import { Save, type Options, type SaveDoc } from "./game.ts";

type Key = keyof Options;

// --- the game's options --------------------------------------------------------------------
export const options: Options = { ...Save.DEFAULT_OPTIONS };
const optionListeners = new Set<() => void>();
export function onOptionsChange(fn: () => void): void { optionListeners.add(fn); }
function optionsChanged(): void { for (const fn of optionListeners) fn(); }
function readOption(key: Key): void {
  let v: JsonValue | undefined;
  try { v = store.get(key); } catch { return; }
  const ok = Save.pickOptions({ [key]: v })[key];
  if (ok !== undefined) (options as unknown as Record<string, unknown>)[key] = ok;
}
/** Changes one of the game's options (device and account). */
export function setOption<K extends Key>(key: K, value: Options[K]): void {
  if (options[key] === value) return;
  options[key] = value;
  try { store.set(key, value as unknown as JsonValue); } catch (e) { console.warn(`option ${key}: ${String(e)}`); }
  optionsChanged();
}
/** A migrated value, kept unless this game set the key since. */
function adoptOption(key: Key, value: unknown): void {
  const v = Save.pickOptions({ [key]: value })[key];
  if (v === undefined) return;
  try {
    if (store.get(key) !== undefined) return;
    store.set(key, v as unknown as JsonValue);
    (options as unknown as Record<string, unknown>)[key] = v;
    optionsChanged();
  } catch { /* keep the device's */ }
}
function importLegacy(): void {
  const keys = store.legacyKeys();
  if (!keys) return;
  for (const k of keys) if ((Save.OPTION_KEYS as string[]).includes(k)) adoptOption(k as Key, store.legacy(k));
  for (const k of keys) if (Save.BROWSER_KEYS.includes(k)) store.removeLegacy(k);
}

// --- the save ------------------------------------------------------------------------------
let doc: SaveDoc = Save.normalize(null);
let lastSavedAt = 0;
const mergedListeners = new Set<() => void>();
/** fn() after progress from the account (another device, the browser build) was merged in. */
export function onProgressMerged(fn: () => void): void { mergedListeners.add(fn); }
function merged(): void { for (const fn of mergedListeners) fn(); }

/** The live save document (runs update it in place, then saveNow()). */
export function save(): SaveDoc { return doc; }
/** Saves the document (device at once, the account debounced by the runtime). */
export function saveNow(opts: { replaceForeign?: boolean } = {}): void {
  try {
    saves.save(doc as unknown as JsonValue, { schema: Save.SCHEMA, ...opts });
    lastSavedAt = saves.load()?.savedAt ?? lastSavedAt;
  } catch (e) { console.warn(`save: ${String(e)}`); }
}
/** Merges another copy into the live document (and saves); whether anything changed. */
function adopt(other: unknown): boolean {
  const next = Save.merge(doc, other);
  if (Save.same(next, doc)) return false;
  replaceWith(next);
  saveNow();
  return true;
}
/** Keeps the live objects (screens hold them) and fills them from `next`. */
function replaceWith(next: SaveDoc): void {
  Object.assign(doc.progression, next.progression);
  doc.achievements.unlocked = next.achievements.unlocked;
  doc.leaderboard.entries = next.leaderboard.entries;
}
/** Settings › Reset local progress: everything back to a new player's (main.js btn-reset-data). */
export function resetProgress(): void {
  replaceWith(Save.normalize(null));
  saveNow();
}
saves.onConflict((mine, remote) => ({ merged: Save.merge(mine?.data ?? null, remote.data) as unknown as JsonValue }));
saves.onStatus((_status, state) => {
  if (state === "foreign") { migrateForeign(); return; }
  // The account's save replaced the device's (another device saved last): merge it in.
  const cur = saves.load();
  if (cur && cur.savedAt !== lastSavedAt) {
    lastSavedAt = cur.savedAt;
    if (adopt(cur.data)) merged();
  }
});
/** The browser build's cloud mirror: merged with this device's progress, saved over it once. */
function migrateForeign(): void {
  const old = saves.foreign();
  if (!old) return;
  const prev = Save.normalize(doc);
  const foreign = Save.readForeign(old.text);
  if (foreign) replaceWith(Save.merge(doc, foreign));
  saveNow({ replaceForeign: true });
  if (!Save.same(prev, doc)) merged();
}

/** For the top bar's sync chip: local (a guest) | saving | synced | offline (main.js renderSyncChip). */
export function syncState(): "local" | "saving" | "synced" | "offline" {
  if (!player()) return "local";
  const st = saves.state();
  if (st === "error" || st === "read-blocked") return "offline";
  if (st === "loading" || st === "foreign" || st === "uploading" || saves.status() === "pending") return "saving";
  return "synced";
}
export function flush(): void { void saves.flush().catch(() => undefined); }

/** Reads the device's save and the game's options (from onStart). */
export function initPlatform(): void {
  const cur = saves.load();
  lastSavedAt = cur?.savedAt ?? 0;
  doc = Save.normalize(cur?.data ?? null);
  for (const k of Save.OPTION_KEYS) readOption(k);
  store.onChange((k) => {
    if (!(Save.OPTION_KEYS as string[]).includes(k)) return;
    readOption(k as Key);
    optionsChanged();
  });
  store.onLegacy(importLegacy);
  importLegacy();
  if (saves.state() === "foreign") migrateForeign();
  optionsChanged();
  refreshPlayer();
  void serverTime().catch(() => undefined);
}

// --- the player and the clock ------------------------------------------------------------
export function signedIn(): boolean { return !!player(); }
export function displayName(): string { return player()?.displayName ?? ""; }
let invite: string | null = null;
/** The invite link, fetched ahead so a button press can copy it at once. */
export function inviteLink(): string | null { return player() ? invite : null; }
function refreshPlayer(): void {
  invite = null;
  board = undefined;
  if (!player()) return;
  fetchInviteLink().then((u) => { invite = u; }, () => { invite = null; });
}
const playerListeners = new Set<(signedIn: boolean) => void>();
export function onPlayer(fn: (signedIn: boolean) => void): void { playerListeners.add(fn); }
onPlayerChange(() => { refreshPlayer(); for (const fn of playerListeners) fn(!!player()); });

/** Now in ms by the platform's clock when it has answered, else the device's (the Daily's day, the UTC clock). */
export function nowMs(): number {
  try { return serverNow() ?? Date.now(); } catch { return Date.now(); }
}

// --- the high-score board ------------------------------------------------------------------
let board: Leaderboard | null | undefined;
async function highScoreBoard(): Promise<Leaderboard | null> {
  if (board !== undefined) return board;
  const list = await leaderboards.list();
  board = list.find((b) => b.key === "high-score") ?? null;
  return board;
}
export interface Posted { posted: boolean; rank: number | null }

/** Signed in only: post a finished run's total through score-script.js; { posted, rank }. Never rejects. */
export async function postScore(total: number): Promise<Posted> {
  const me = player();
  if (!me) return { posted: false, rank: null };
  const score = Math.max(0, Math.round(total));
  let accepted: string[] = [];
  try {
    const sessionId = await sessions.practice();
    accepted = await new Promise<string[]>((resolve) => {
      const socket = connectGame(sessionId);
      let done = false;
      const finish = (list: string[]): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.close();
        resolve(list);
      };
      const timer = setTimeout(() => finish([]), 15000);
      socket.on("open", () => { socket.sendCommand({ type: "result", scores: { "high-score": score } }); });
      socket.on("game", (data) => {
        const d = data as { type?: string; accepted?: string[] } | null;
        if (d && d.type === "result-ack") finish(Array.isArray(d.accepted) ? d.accepted : []);
      });
      socket.on("error", () => finish([]));
      socket.on("stopped", () => finish([]));
      socket.on("abandoned", () => finish([]));
    });
  } catch { return { posted: false, rank: null }; }
  if (!accepted.includes("high-score")) return { posted: false, rank: null };
  try {
    const b = await highScoreBoard();
    if (!b) return { posted: true, rank: null };
    const r = await leaderboards.entries(b.id, { pageSize: 100 });
    const mine = r.items.find((e) => e.userId === me.userId);
    return { posted: true, rank: mine ? mine.rank : null };
  } catch { return { posted: true, rank: null }; }
}
