// Metro Dash on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The rules (js/rules.js), content (js/content.js)
// and the session with its command queue, replay log, snapshots and
// checkpoints (js/session.js) are the browser build's, unchanged in what they
// decide; this module is what js/main.js did around them — the game flow
// (title → mode screens → briefing → 3-2-1 countdown → run ⇄ pause → results),
// input (the lane, jump, slide and pause actions from keys and pads, swipes on
// the street, the touch tray), the rules events' presentation (a sound per
// event, sparks and shake, live announcements, the crash vibration),
// progression, achievements, the local runs board and posting a finished run
// to the high-score board, Practice's rewind checkpoints, the interrupted-run
// resume ("Welcome back"), the attract run behind the menus, and the
// lifecycle (a hidden window pauses the run, as visibilitychange did).
// Screens are drawn by screens.ts (starhermit:ui), the city by render.ts
// (starhermit:scene).
//
// Time is the runtime's fixed steps at the rules' 30 Hz: one rules step per
// fixed step while the run is active (and one for the attract run), so pauses,
// a hidden window and slow frames never cost time and play scripts replay
// exactly; the countdown counts the same steps (21 a number, as its 700 ms).
// The street is drawn between steps by the frame's interpolation.
import "./shim.ts";
import "./i18n.ts";
import { clipboard, frame, onFixedUpdate, onPreferencesChange, onRender, onResume, onStart, onSuspend, onUpdate, preferences, setFixedRate } from "starhermit:engine";
import { isDown, onAction, onPointerButton, onTouch, primaryPointer, vibrate } from "starhermit:input";
import * as ui from "starhermit:ui";
import { onSessionEnded, requestSignIn } from "starhermit:platform";
import { Content, RunSession, Rules, Store, type Checkpoint, type Content as Item, type RulesEvent, type RunResult, type Session, type State } from "./game.ts";
import * as audio from "./audio.ts";
import { N, S, T, fmt } from "./i18n.ts";
import * as platform from "./platform.ts";
import { lookFor } from "./quality.ts";
import * as render from "./render.ts";
import { drawScreens, topbarHeight } from "./screens.ts";
import { applyContrast, initStyles } from "./style.ts";

export type Screen = "title" | "journey" | "learn" | "challenge" | "practice" | "setup" | "results" | "scores" | "help" | "settings";
export type GameState = "title" | "countdown" | "active" | "paused" | "results";
export interface Results {
  result: RunResult; content: Item; isBest: boolean; bestScore: number | null; newAchievements: string[]; nextContent: Item | null;
}

export const app = {
  /** The menu screen shown (null: the run's HUD). */
  screen: "title" as Screen | null,
  game: "title" as GameState,
  /** Over the run: the pause panel or the "Welcome back" notice. */
  overlay: null as "pause" | "interrupt" | null,
  /** "Welcome back" text (a thunk so it follows a language change). */
  interrupt: null as (() => string) | null,
  /** Frame the screen or overlay opened on (the press that opened it must not also act on it). */
  openedFrame: 0,
  focusNext: null as string | null,
  session: null as Session | null,
  content: null as Item | null,
  pending: null as Item | null,
  countdown: null as { n: number; ticks: number; text: string } | null,
  results: null as Results | null,
  lb: null as platform.Posted | "posting" | null,
  toasts: [] as { text: string; until: number }[],
  difficulty: "standard",
  scoreFilter: "all" as "all" | "daily" | "mine",
  confirmReset: false,
};
const now = (): number => frame().time;
export const MODE_NAMES: Record<string, string> = { daily: N("Daily"), journey: N("Journey"), learn: N("Lesson"), practice: N("Practice"), challenge: N("Challenge") };
export const PRACTICE_LEVELS: Record<string, string> = { relaxed: N("Relaxed"), standard: N("Standard"), intense: N("Intense") };

// ------------------------------------------------------------------ helpers
let lastAnnouncement = "";
/** The live region (ui.js announce); repeated text is skipped so screen readers stay usable. */
export function announce(text: string, assertive = false): void {
  if (!text || text === lastAnnouncement) return;
  lastAnnouncement = text;
  ui.announce(text.slice(0, 500), { politeness: assertive ? "assertive" : "polite" });
}
/** ui.js toast(): 2.6 s, stacked. */
export function toast(text: string): void {
  app.toasts.push({ text, until: now() + 2.6 });
  ui.announce(text, { politeness: "polite" });
}
export function click(): void { audio.event("ui"); }
export function save(): ReturnType<typeof platform.save> { return platform.save(); }
/** Pure-touch devices show the tray (a phone reports no pointer before its first touch). */
export function touchOnly(): boolean {
  const pp = primaryPointer();
  if (pp !== "none") return pp === "coarse";
  const f = frame(), sc = ui.preferences().scale;
  const w = f.width / sc, h = f.height / sc;
  return (w <= 700 && h >= w) || (w > h && h <= 500);
}
/** The Daily for the platform's day (content.js dailyInfo). */
export function daily(): Item & { day: string } { return { ...Content.dailyInfo(new Date(platform.nowMs())), kind: "daily" }; }
/** ui.js contentLabel: a content item's display title. */
export function contentLabel(c: Item | null): string {
  if (!c) return "";
  if (c.kind === "journey") return c.mastery ? T("Stage {n} — Mastery", { n: c.index! }) : T("Stage {n}", { n: c.index! });
  if (c.kind === "daily") return T("Daily Run — {day}", { day: c.day! });
  if (c.kind === "practice") {
    const level = String(c.id || "").replace(/^practice-/, "");
    return T("Practice — {level}", { level: T(PRACTICE_LEVELS[level] ?? PRACTICE_LEVELS.standard!) });
  }
  return T(c.label ?? "");
}

// ------------------------------------------------------------------ navigation
export function show(screen: Screen | null, focus: string | null = null): void {
  app.screen = screen;
  app.openedFrame = frame().frame;
  app.focusNext = focus;
  app.confirmReset = false;
  ui.setFocus(null);
}
/** A mode screen from the title (or Settings / How to Play from the pause panel). */
export function open(screen: Screen): void {
  click();
  if (app.game === "paused" && app.overlay === "pause") app.overlay = null;
  const first: Partial<Record<Screen, string>> = { journey: "stage-1", learn: "lesson-0", challenge: "challenge-0", practice: "diff-standard", scores: "filter-all", settings: "btn-options", help: "btn-back" };
  show(screen, first[screen] ?? "btn-back");
}
/** [data-back]: to the pause panel when a run is paused, else the title. */
export function back(): void {
  click();
  if (app.game === "paused" && app.session) { show(null); openPause(); return; }
  goTitle();
}
export function goTitle(): void {
  if (app.game !== "paused") { app.session = null; app.game = "title"; }
  app.overlay = null;
  show("title", "btn-play");
}
export function selectContent(c: Item): void {
  click();
  app.pending = c;
  show("setup", "btn-setup-start");
}
export function startPractice(): void {
  const base = Content.practiceConfig(app.difficulty);
  selectContent({ ...base, seed: (Math.random() * 0xffffffff) >>> 0 } as Item);
}

// ------------------------------------------------------------------ the run
const hooks = { onEvents: handleEvents, onEnd: handleRunEnd };
let checkpoints: Checkpoint[] = [];
let checkpointTick = 0;
let lastAnnouncedScore = 0;

export function startRun(content: Item, restored: Session | null = null): void {
  audio.setSuspended(false);
  app.pending = null;
  app.content = content;
  app.results = null;
  app.lb = null;
  app.overlay = null;
  show(null);
  app.session = restored ?? new RunSession(content, hooks);
  app.session.keepCheckpoints = content.kind === "practice";
  checkpoints = [];
  checkpointTick = 0;
  lastAnnouncedScore = 0;
  render.setTheme(content.theme || "day", content.seed);
  if (restored) { app.game = "active"; return; }
  app.game = "countdown";
  app.countdown = { n: 3, ticks: 0, text: "3" };
  audio.event("countdown");
  announce("3", true);
}
export function startPending(): void { if (app.pending) { click(); startRun(app.pending); } }

/** main.js beginCountdown on the fixed steps: a number every 21 steps (700 ms), then GO (shown 15 steps) and the run. */
function countdownStep(): void {
  const c = app.countdown;
  if (!c) return;
  c.ticks++;
  if (app.game === "countdown" && c.ticks >= 21) {
    c.ticks = 0;
    c.n--;
    if (c.n > 0) { c.text = String(c.n); audio.event("countdown"); announce(c.text, true); }
    else {
      c.text = T("GO");
      audio.event("go");
      audio.startMusic();
      announce(c.text, true);
      app.game = "active";
    }
  } else if (app.game === "active" && c.ticks >= 15) app.countdown = null;
}

/** One rules step of a session (js/session.js update with exactly one step due: the runtime's fixed step is the clock). */
function stepSession(s: Session): void {
  s.lastTime = 0;
  s.accumulator = s.stepMs;
  s.update(0);
}

function handleEvents(events: RulesEvent[], state: State): void {
  if (app.session?.state !== state) return; // the attract run
  render.handleEvents(events, state);
  for (const e of events) {
    audio.event(e.type);
    if (e.type === "invalid") announce(T("Can’t do that: {reason}", { reason: e.reason ?? "" }));
    else if (e.type === "crash") {
      announce(T("Crash!"), true);
      if (!preferences().reducedMotion) { try { vibrate(80); } catch { /* no motor */ } }
    } else if (e.type === "goal") announce(T("Objective complete!"));
  }
}

/** A command from the player (main.js doAction): queued for the next rules step. */
export function doAction(action: string): void {
  const s = app.session;
  if (app.game !== "active" || !s) return;
  const res = s.command(action);
  if (!res.accepted && res.reason && res.reason !== "run-over") announce(T("Not now: {reason}", { reason: res.reason }));
}

/** main.js checkAchievements: idempotent unlocks after a run. */
function checkAchievements(content: Item): string[] {
  const doc = save();
  const p = doc.progression;
  const newly: string[] = [];
  const unlock = (key: string): void => { if (Store.unlockAchievement(doc.achievements, key)) newly.push(key); };
  unlock("first_finish");
  if (content.kind === "learn" && Content.LESSONS.every((l) => p.lessonsCompleted[l.id] || l.id === content.id)) unlock("lesson_graduate");
  if (content.kind === "journey") {
    if (content.index! >= 20) unlock("journey_20");
    if (content.index! >= 40) unlock("journey_40");
  }
  if (p.dailyDays.length >= 3) unlock("streak_3");
  if (p.totalDistance >= 100000) unlock("distance_100k");
  if (newly.length) audio.event("achievement");
  return newly;
}

/** main.js handleRunEnd: progression, the local board, achievements, the results and the leaderboard post. */
function handleRunEnd(result: RunResult): void {
  if (!app.session || app.session.result !== result) return;
  app.game = "results";
  app.countdown = null;
  audio.stopMusic();
  const content = app.content!;
  const isGoal = result.reason === "goal";
  const doc = save();
  const p = doc.progression;
  p.totalRuns += 1;
  p.totalDistance += result.distance;
  if (content.kind === "journey" && isGoal) p.journeyCompleted[content.id] = { score: result.score, ticks: result.tick };
  if (content.kind === "learn" && isGoal) p.lessonsCompleted[content.id] = true;
  if (content.kind === "challenge" && isGoal) {
    const prev = p.challengesCompleted[content.id];
    if (!prev || result.score > prev.score) p.challengesCompleted[content.id] = { score: result.score };
  }
  let day: string | null = null;
  if (content.kind === "daily") {
    day = content.day!;
    if (!p.dailyDays.includes(day)) p.dailyDays.push(day);
    if (!p.bestDaily[day] || result.score > p.bestDaily[day]!) p.bestDaily[day] = result.score;
  }
  // the local board (not for practice or a run ended from the pause panel)
  let isBest = false;
  let bestScore: number | null = null;
  if (content.kind !== "practice" && result.reason !== "quit") {
    const scope = doc.leaderboard.entries.filter((e) => e.mode === content.kind && (content.kind !== "daily" || e.day === day));
    bestScore = scope.length ? Math.max(...scope.map((e) => e.score)) : null;
    isBest = bestScore === null || result.score > bestScore;
    Store.addLeaderboardEntry(doc.leaderboard, {
      name: platform.displayName() || T("You"), mine: true, score: result.score, distance: result.distance, ticks: result.tick,
      invalid: result.stats.invalidActions, mode: content.kind, day, seed: content.seed, ruleset: "v1",
      assists: platform.options.hints ? "hints" : "none", sessionId: result.sessionId, when: Date.now(),
    });
  }
  if (isBest && bestScore !== null) audio.event("best");
  const newAchievements = checkAchievements(content);
  platform.saveNow();
  let nextContent: Item | null = null;
  if (content.kind === "journey" && isGoal && content.index! < Content.JOURNEY_STAGES.length) nextContent = Content.JOURNEY_STAGES[content.index!]!;
  app.results = { result, content, isBest, bestScore, newAchievements, nextContent };
  app.overlay = null;
  show("results", "btn-retry");
  announce(`${resultsTitle()}. ${resultsHeadline()}`);
  // signed in only: post a finished run (not practice, lessons or quits) and show the board rank
  const eligible = content.kind !== "practice" && content.kind !== "learn" && result.reason !== "quit";
  if (eligible && platform.signedIn()) {
    app.lb = "posting";
    const s = app.session;
    void platform.postScore(result.score).then((r) => { if (app.session === s) app.lb = r; });
  } else app.lb = null;
}
export function resultsTitle(): string {
  const r = app.results?.result;
  if (!r) return "";
  return r.reason === "goal" ? T("Stage Complete") : r.reason === "moves" ? T("Out of Moves") : r.reason === "quit" ? T("Run Ended") : T("Run Over");
}
const CRASH_NAMES: Record<string, string> = { barrier: N("barrier"), sign: N("sign"), block: N("kiosk") };
export function resultsHeadline(): string {
  const r = app.results?.result;
  if (!r) return "";
  if (r.reason === "goal") return T("Objective complete — {n} points", { n: fmt(r.score) });
  if (r.reason === "crash") return T("Crushed it until the {obstacle} fought back — {n} points", { obstacle: T(CRASH_NAMES[r.crashedKind ?? ""] ?? N("track")), n: fmt(r.score) });
  return T("{n} points", { n: fmt(r.score) });
}
export function leaderboardLine(): string | null {
  const r = app.lb;
  if (!r) return null;
  if (r === "posting") return S("lbPosting");
  return !r.posted ? S("lbNotPosted") : r.rank ? S("lbRank", { rank: r.rank }) : S("lbPosted");
}
export function retry(): void { click(); if (app.results) startRun(app.results.content); }
export function nextStage(): void { const n = app.results?.nextContent; if (n) selectContent(n); }
export function resultsMenu(): void { click(); app.game = "title"; app.session = null; goTitle(); }

// ------------------------------------------------------------------ pause, rewind, interrupt
export function openPause(): void {
  app.overlay = "pause";
  app.openedFrame = frame().frame;
  app.focusNext = "btn-resume";
  ui.setFocus(null);
}
export function pauseGame(): void {
  if (app.game !== "active" || !app.session) return;
  app.session.pause();
  app.game = "paused";
  audio.event("ui");
  audio.setSuspended(true);
  openPause();
  announce(T("Paused"));
}
export function resumeGame(): void {
  if (!app.session) return;
  app.overlay = null;
  app.interrupt = null;
  show(null);
  app.session.resume();
  audio.setSuspended(false);
  app.game = "active";
}
export function restartRun(): void {
  click();
  const c = app.content;
  if (!c) return;
  app.session?.clearSnapshot();
  startRun(c);
}
/** End Run (main.js quitRun) and the interrupt's Abandon run: the run ends as "quit" and its results show. */
export function quitRun(): void {
  click();
  const s = app.session;
  if (!s) return;
  app.overlay = null;
  app.interrupt = null;
  s.resume();
  audio.setSuspended(false);
  s.quit();
}
export function canRewind(): boolean { return app.content?.kind === "practice" && checkpoints.length > 0; }
export function rewindRun(): void {
  const s = app.session;
  if (!s || !checkpoints.length) return;
  s.restoreCheckpoint(checkpoints[checkpoints.length - 1]!);
  app.overlay = null;
  show(null);
  app.game = "active";
  s.resume();
  audio.setSuspended(false);
  audio.event("rewind");
  toast(T("Rewound 5 seconds"));
}
function showInterrupt(text: () => string): void {
  app.overlay = "interrupt";
  app.interrupt = text;
  app.openedFrame = frame().frame;
  app.focusNext = "btn-interrupt-resume";
  ui.setFocus(null);
}
/** main.js boot: offer an interrupted run back ("while you were away"). */
function offerResume(): void {
  const list: Item[] = [daily(), ...Content.JOURNEY_STAGES, ...Content.LESSONS];
  for (const c of list) {
    const restored = RunSession.restore(`${c.kind}:${c.id}`, c, hooks);
    if (restored && restored.state.status === "active") {
      startRun(c, restored);
      restored.pause();
      app.game = "paused";
      audio.setSuspended(true);
      const dist = Math.floor(restored.state.distance);
      showInterrupt(() => T("You have an interrupted run at {n} units. Pick up exactly where you left off.", { n: dist }));
      return;
    }
  }
}

export function copyInvite(): void {
  click();
  const link = platform.inviteLink();
  if (!link) return;
  try { clipboard.writeText(link); toast(S("copied")); } catch { toast(S("copyFailed")); }
}
export function signIn(): void { click(); void requestSignIn().catch(() => undefined); }
export function toggleMute(): void { audio.setMuted(!audio.isMuted()); click(); }
export function resetProgress(): void {
  platform.resetProgress();
  app.confirmReset = false;
  toast(T("Local progress reset"));
}

// ------------------------------------------------------------------ HUD values
export function objectiveText(c: Item, st: State): string {
  const goal = c.config.goal;
  if (!goal) return T("Survive. Score big.");
  if (goal.type === "distance") return T("Reach {n} units — {done} so far", { n: fmt(goal.value), done: fmt(Math.min(st.distance, goal.value)) });
  if (goal.type === "coins") return T("Collect {n} tokens — {done} so far", { n: goal.value, done: st.stats.coins });
  return T("Perform {n}× {action} — {done} so far", { n: goal.value, action: T(ACTION_WORDS[goal.action!] ?? goal.action!), done: st.stats[goal.action + "s"] ?? 0 });
}
export function objectiveProgress(c: Item, st: State): number {
  const goal = c.config.goal;
  if (!goal) return 0;
  if (goal.type === "distance") return Math.min(1, st.distance / goal.value);
  if (goal.type === "coins") return Math.min(1, st.stats.coins / goal.value);
  return Math.min(1, (st.stats[goal.action + "s"] ?? 0) / goal.value);
}
export const ACTION_WORDS: Record<string, string> = { left: N("left"), right: N("right"), jump: N("jump"), slide: N("slide"), wait: N("wait"), laneChange: N("lane change") };

// ------------------------------------------------------------------ input
/** HUD rectangles (window pixels) where a press belongs to the UI, set by screens.ts each frame. */
export const hudRects: { x: number; y: number; width: number; height: number }[] = [];
const onHud = (x: number, y: number): boolean => hudRects.some((r) => x >= r.x && y >= r.y && x <= r.x + r.width && y <= r.y + r.height);
type PEvent = { down: boolean; x: number; y: number; id: number; t: number };
const pevents: PEvent[] = [];
let lastTouch = -1e9;
onTouch((e) => {
  lastTouch = now();
  if (e.control) return;
  if (e.phase === "start") pevents.push({ down: true, x: e.x, y: e.y, id: e.id, t: now() });
  else if (e.phase === "end") pevents.push({ down: false, x: e.x, y: e.y, id: e.id, t: now() });
  else if (e.phase === "cancel" && downAt && downAt.id === e.id) downAt = null;
});
onPointerButton((e) => {
  if (e.button !== 0 || now() - lastTouch < 0.6) return;
  pevents.push({ down: e.pressed, x: e.x, y: e.y, id: -1, t: now() });
});
let downAt: PEvent | null = null;
/** main.js swipe gestures on the street (decided once the frame's UI is built): a quick swipe of 24 px or more. */
function pointerInput(): void {
  const sc = ui.preferences().scale;
  for (const ev of pevents.splice(0)) {
    const live = app.game === "active" && app.screen === null && app.overlay === null;
    if (ev.down) {
      downAt = live && !onHud(ev.x, ev.y) ? ev : null;
      if (downAt) ui.setFocus(null);
      continue;
    }
    const d = downAt;
    downAt = null;
    if (!d || d.id !== ev.id || !live) continue;
    const dx = (ev.x - d.x) / sc, dy = (ev.y - d.y) / sc;
    if (ev.t - d.t > 0.6) continue; // slow drags are camera-ish gestures; ignore
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (Math.max(adx, ady) < 24) continue; // tap: no accidental commits
    if (adx > ady) doAction(dx > 0 ? "right" : "left");
    else doAction(dy > 0 ? "slide" : "jump");
  }
}

const GAME_ACTIONS = ["left", "right", "jump", "slide"];
onAction((e) => {
  if (!e.pressed) return;
  const fresh = frame().frame !== app.openedFrame;
  if (e.action === "pause") {
    if (!fresh || ui.capturingKeys()) return;
    if (app.game === "active" && app.screen === null) pauseGame();
    else if (app.game === "paused" && app.overlay === "pause") resumeGame();
    return;
  }
  if (GAME_ACTIONS.includes(e.action) && app.game === "active" && app.screen === null) {
    // Game keys must not also walk or activate the UI focus over the HUD.
    ui.setFocus(null);
    doAction(e.action);
  }
});

// ------------------------------------------------------------------ the attract run behind the menus
let idle: Session | null = null;
function makeIdle(): void { idle = new RunSession({ ...daily(), id: "attract", kind: "attract" }, {}); }

// ------------------------------------------------------------------ boot and lifecycle
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const k = `${f.quality}:${f.levelIndex}`;
  if (k === lookKey) return;
  lookKey = k;
  render.applyLook(lookFor(f.quality, f.levelIndex));
}

onStart(() => {
  setFixedRate(Rules.TICKS_PER_SECOND);
  initStyles();
  platform.initPlatform();
  audio.loadSfx();
  render.setReducedMotion(preferences().reducedMotion);
  render.setPalette(platform.options.colorPalette);
  applyLook();
  render.setActive(true);
  makeIdle();
  render.setTheme("dawn", daily().seed);
  goTitle();
  offerResume();
});
onPreferencesChange((p) => render.setReducedMotion(p.reducedMotion));
platform.onOptionsChange(() => render.setPalette(platform.options.colorPalette));
platform.onPlayer((on) => { if (!on) toast(S("signedOut")); });
onSessionEnded(() => toast(S("signedOut"))); // keep playing locally
let hidden = false;
let autoPaused = false;
onSuspend(() => {
  hidden = true;
  platform.flush();
  if (app.game === "active") { autoPaused = true; pauseGame(); }
  audio.setSuspended(true);
});
onResume(() => {
  hidden = false;
  if (app.game !== "paused") audio.setSuspended(false);
  if (app.game === "paused" && app.session && autoPaused) {
    autoPaused = false;
    showInterrupt(() => T("Your run was paused while you were away. State is restored exactly as you left it."));
  }
});

onFixedUpdate(() => {
  if (hidden) return;
  countdownStep();
  const s = app.session;
  if (s && app.game === "active") {
    stepSession(s);
    // practice checkpoints every 5 s
    if (s.keepCheckpoints && s.state.tick - checkpointTick >= 150) {
      checkpointTick = s.state.tick;
      checkpoints.push(s.snapshot());
      if (checkpoints.length > 4) checkpoints.shift();
    }
  }
  if (!s || app.game === "title" || app.game === "results") {
    // attract mode: gentle idle drift behind menus (restarted when it crashes or finishes)
    if (!idle || idle.state.status !== "active") makeIdle();
    else stepSession(idle);
  }
});

let frameDt = 0;
onUpdate((dt) => {
  frameDt = dt;
  const s = app.session;
  if (app.game === "active" && GAME_ACTIONS.some((a) => isDown(a))) ui.setFocus(null);
  applyLook();
  applyContrast(ui.preferences().highContrast);
  if (s && app.game === "active") {
    const st = s.state;
    audio.setIntensity((Rules.speedAt(st.distance, st.config) - 2) / 5);
    const total = Rules.totalScore(st);
    // throttled score announcements for screen readers
    if (Math.floor(total / 250) !== Math.floor(lastAnnouncedScore / 250)) announce(T("Score {n}", { n: fmt(total) }));
    lastAnnouncedScore = total;
  }
  audio.update();
  const t = now();
  app.toasts = app.toasts.filter((x) => x.until > t);
});
const pendingActs: (() => void)[] = [];
/** A widget's press, run once the frame's UI is built (state changes mid-build would break later widgets). */
export function later(fn: () => void): void { pendingActs.push(fn); }
onRender((alpha) => {
  hudRects.length = 0;
  drawScreens();
  for (const fn of pendingActs.splice(0)) fn();
  pointerInput();
  const f = frame();
  const s = app.session;
  const runShown = !!s && (app.game === "countdown" || app.game === "active" || app.game === "paused");
  const state = runShown ? s!.state : idle?.state ?? null;
  const a = (runShown ? app.game === "active" : true) ? Math.min(1, Math.max(0, alpha)) : 0;
  render.update(state, a, frameDt, f.time, { top: topbarHeight(), width: f.width, height: f.height });
});
