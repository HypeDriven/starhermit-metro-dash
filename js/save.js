// The save document and the game's own options, pure (no engine, no DOM) so
// the engine client (native/platform.ts) and the Node tests agree.
//
// The save is what the browser build mirrored to the account's cloud slot
// (main.js cloudDoc, written by the JS SDK's saveJSON under game:<slug>)
// without its settings: { v, progression, achievements, leaderboard }. Two
// copies merge as main.js applyCloudDoc did after a save conflict — completed
// stages / challenges keep the better score, lessons and Daily days are
// united, totals take the larger value, the best Daily score per day the
// larger, achievements keep the earliest unlock, the local runs board is
// united (deduplicated by session) and kept to 200 a scope.
//
// The browser build's options in its settings document (localStorage and the
// account's settings KV): volumes, graphics, reduced motion, high contrast and
// larger text are the runtime's Options now; the colour palette, the
// left-handed touch tray and the hints switch stay the game's own.

import { addLeaderboardEntry } from './storage.js';

export const SCHEMA = 1;

const DEFAULT_PROGRESSION = {
  journeyCompleted: {}, // stageId -> {score, ticks}
  lessonsCompleted: {}, // lessonId -> true
  challengesCompleted: {}, // challengeId -> {score}
  totalDistance: 0,
  totalRuns: 0,
  dailyDays: [], // UTC day strings played
  bestDaily: {}, // day -> score
};

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const clone = (x) => JSON.parse(JSON.stringify(x));

/** A clean progression record from anything (missing or broken fields take defaults). */
export function normalizeProgression(raw) {
  const r = isObj(raw) ? raw : {};
  const p = clone(DEFAULT_PROGRESSION);
  for (const f of ['journeyCompleted', 'challengesCompleted']) {
    if (!isObj(r[f])) continue;
    for (const [id, v] of Object.entries(r[f])) if (isObj(v)) p[f][id] = { ...v, score: num(v.score) };
  }
  if (isObj(r.lessonsCompleted)) for (const [id, v] of Object.entries(r.lessonsCompleted)) if (v) p.lessonsCompleted[id] = true;
  p.totalDistance = Math.max(0, num(r.totalDistance));
  p.totalRuns = Math.max(0, num(r.totalRuns));
  if (Array.isArray(r.dailyDays)) p.dailyDays = [...new Set(r.dailyDays.filter((d) => typeof d === 'string'))].sort();
  if (isObj(r.bestDaily)) for (const [d, s] of Object.entries(r.bestDaily)) p.bestDaily[d] = num(s);
  return p;
}

/** The whole save document, normalized. */
export function normalize(raw) {
  const r = isObj(raw) ? raw : {};
  const unlocked = {};
  if (isObj(r.achievements) && isObj(r.achievements.unlocked)) {
    for (const [k, v] of Object.entries(r.achievements.unlocked)) if (v) unlocked[k] = v;
  }
  const entries = isObj(r.leaderboard) && Array.isArray(r.leaderboard.entries)
    ? r.leaderboard.entries.filter((e) => isObj(e) && Number.isFinite(e.score)) : [];
  return {
    v: SCHEMA,
    progression: normalizeProgression(r.progression),
    achievements: { unlocked },
    leaderboard: { entries: clone(entries) },
  };
}

const better = (a, b) => (!a ? b : !b ? a : (b.score || 0) > (a.score || 0) ? b : a);
const earlier = (a, b) => {
  if (a == null) return b;
  if (b == null) return a;
  return (typeof a === typeof b && b < a) ? b : a;
};

/** main.js applyCloudDoc + mergeProgression: neither copy loses anything. */
export function merge(localRaw, remoteRaw) {
  const local = normalize(localRaw);
  const remote = normalize(remoteRaw);
  const p = local.progression, q = remote.progression;
  for (const f of ['journeyCompleted', 'challengesCompleted']) {
    for (const [id, v] of Object.entries(q[f])) p[f][id] = better(p[f][id], v);
  }
  p.lessonsCompleted = { ...q.lessonsCompleted, ...p.lessonsCompleted };
  p.totalDistance = Math.max(p.totalDistance, q.totalDistance);
  p.totalRuns = Math.max(p.totalRuns, q.totalRuns);
  p.dailyDays = [...new Set([...p.dailyDays, ...q.dailyDays])].sort();
  for (const [day, sc] of Object.entries(q.bestDaily)) p.bestDaily[day] = Math.max(num(p.bestDaily[day]), num(sc));
  const mine = local.achievements.unlocked;
  for (const [k, v] of Object.entries(remote.achievements.unlocked)) mine[k] = earlier(mine[k], v);
  const key = (e) => e.sessionId || `${e.mode}|${e.day}|${e.score}|${e.when}`;
  const seen = new Set(local.leaderboard.entries.map(key));
  for (const e of remote.leaderboard.entries) {
    if (seen.has(key(e))) continue;
    seen.add(key(e));
    addLeaderboardEntry(local.leaderboard, e);
  }
  return local;
}

/** Whether two documents hold the same data. */
export function same(a, b) {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

/** The browser build's cloud mirror (the slot's save.json text) as a save document; null when unreadable. */
export function readForeign(text) {
  if (typeof text !== 'string' || !text) return null;
  let doc;
  try { doc = JSON.parse(text); } catch { return null; }
  if (!isObj(doc)) return null;
  if (!isObj(doc.progression) && !isObj(doc.achievements) && !isObj(doc.leaderboard)) return null;
  return normalize(doc);
}

// -- the game's own options ---------------------------------------------------------
export const PALETTES = ['standard', 'deuteranopia', 'protanopia', 'tritanopia'];
export const DEFAULT_OPTIONS = { colorPalette: 'standard', leftHanded: false, hints: true };
export const OPTION_KEYS = Object.keys(DEFAULT_OPTIONS);

/** The valid option values in `raw` (others left out). */
export function pickOptions(raw) {
  const r = isObj(raw) ? raw : {};
  const out = {};
  if (PALETTES.includes(r.colorPalette)) out.colorPalette = r.colorPalette;
  if (typeof r.leftHanded === 'boolean') out.leftHanded = r.leftHanded;
  if (typeof r.hints === 'boolean') out.hints = r.hints;
  return out;
}

/** Every key the browser build wrote to the account's settings KV (main.js pushSettings: its settings without
 * bindings; sh-language.js's ui.language; game-options.js's audio.options). */
export const BROWSER_KEYS = ['music', 'effects', 'ambience', 'voice', 'quality', 'graphics', 'reducedMotion', 'highContrast',
  'largeText', 'leftHanded', 'holdToSlide', 'colorPalette', 'hints', 'tutorialDone', 'consent', 'ui.language', 'audio.options'];
