// Local persistence: versioned, checksummed JSON documents in localStorage.
// Guest-first: everything works offline; cloud sync is a host concern.

const PREFIX = 'metro-dash:';
const DOC_VERSION = 1;

function checksum(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function available() {
  try {
    const k = PREFIX + 'probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

const memoryFallback = new Map();
const hasStorage = typeof localStorage !== 'undefined' && available();

function readRaw(key) {
  if (hasStorage) return localStorage.getItem(PREFIX + key);
  return memoryFallback.get(key) ?? null;
}
function writeRaw(key, value) {
  if (hasStorage) localStorage.setItem(PREFIX + key, value);
  else memoryFallback.set(key, value);
}

export function loadDoc(key, defaults) {
  const raw = readRaw(key);
  if (!raw) return structuredClone(defaults);
  try {
    const doc = JSON.parse(raw);
    if (doc.v !== DOC_VERSION || doc.checksum !== checksum(doc.payload)) {
      // corrupt or outdated: keep a backup, start fresh
      writeRaw(key + '.backup', raw);
      return structuredClone(defaults);
    }
    return { ...structuredClone(defaults), ...JSON.parse(doc.payload) };
  } catch {
    return structuredClone(defaults);
  }
}

export function saveDoc(key, data) {
  const payload = JSON.stringify(data);
  writeRaw(key, JSON.stringify({ v: DOC_VERSION, checksum: checksum(payload), payload }));
}

// ---------------------------------------------------------------------------
// Typed stores
// ---------------------------------------------------------------------------

export const DEFAULT_SETTINGS = {
  music: 0.7,
  effects: 0.9,
  ambience: 0.5,
  voice: 0.8,
  quality: 'auto', // 'low' | 'medium' | 'high' | 'auto'
  reducedMotion: false,
  highContrast: false,
  largeText: false,
  leftHanded: false,
  holdToSlide: false,
  colorPalette: 'standard', // 'standard' | 'deuteranopia' | 'protanopia' | 'tritanopia'
  hints: true,
  bindings: null, // player key overrides, null = defaults
  tutorialDone: false,
};

export const DEFAULT_PROGRESSION = {
  journeyCompleted: {}, // stageId -> {score, ticks}
  lessonsCompleted: {}, // lessonId -> true
  challengesCompleted: {}, // challengeId -> {score}
  totalDistance: 0,
  totalRuns: 0,
  dailyDays: [], // UTC day strings played
  bestDaily: {}, // day -> score
};

export const DEFAULT_ACHIEVEMENTS = { unlocked: {} }; // key -> iso timestamp

// Leaderboard entry: {name, score, distance, ticks, invalid, day?, seed, mode, ruleset, assists, sessionId}
export const DEFAULT_LEADERBOARD = { entries: [] };

export function loadSettings() { return loadDoc('settings', DEFAULT_SETTINGS); }
export function saveSettings(s) { saveDoc('settings', s); }
export function loadProgression() { return loadDoc('progression', DEFAULT_PROGRESSION); }
export function saveProgression(p) { saveDoc('progression', p); }
export function loadAchievements() { return loadDoc('achievements', DEFAULT_ACHIEVEMENTS); }
export function saveAchievements(a) { saveDoc('achievements', a); }
export function loadLeaderboard() { return loadDoc('leaderboard', DEFAULT_LEADERBOARD); }
export function saveLeaderboard(l) { saveDoc('leaderboard', l); }
export function saveSnapshot(modeKey, snapshotJson) { writeRaw('snapshot:' + modeKey, snapshotJson); }
export function loadSnapshot(modeKey) { return readRaw('snapshot:' + modeKey); }
export function clearSnapshot(modeKey) {
  if (hasStorage) localStorage.removeItem(PREFIX + 'snapshot:' + modeKey);
  else memoryFallback.delete('snapshot:' + modeKey);
}

// ---------------------------------------------------------------------------
// Achievements (idempotent unlocks)
// ---------------------------------------------------------------------------

export function unlockAchievement(store, key) {
  if (store.unlocked[key]) return false;
  store.unlocked[key] = new Date().toISOString();
  return true;
}

// ---------------------------------------------------------------------------
// Leaderboard helpers. Ties: primary objective (score) desc, fewer invalid
// actions, lower elapsed ticks, then stable session id.
// ---------------------------------------------------------------------------

export function compareEntries(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (a.invalid !== b.invalid) return a.invalid - b.invalid;
  if (a.ticks !== b.ticks) return a.ticks - b.ticks;
  return a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0;
}

export function addLeaderboardEntry(board, entry, scopeKey) {
  board.entries.push(entry);
  // keep the board bounded: top 200 per scope
  const scopes = {};
  for (const e of board.entries) {
    const k = e.mode + ':' + (e.day || 'all');
    (scopes[k] = scopes[k] || []).push(e);
  }
  const kept = [];
  for (const k of Object.keys(scopes)) {
    scopes[k].sort(compareEntries);
    kept.push(...scopes[k].slice(0, 200));
  }
  board.entries = kept;
  void scopeKey;
  return board;
}

export function sessionId() {
  return 's' + Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36);
}
