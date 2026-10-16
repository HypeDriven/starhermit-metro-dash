// Bootstrap: host handshake, capability detection, module wiring, input,
// and the top-level game flow (title → mode → countdown → run → results).

import { totalScore, speedAt } from './rules.js';
import {
  LESSONS, JOURNEY_STAGES, dailyInfo, practiceConfig, THEMES,
} from './content.js';
import { RunSession } from './session.js';
import {
  loadSettings, saveSettings, loadProgression, saveProgression,
  loadAchievements, saveAchievements, loadLeaderboard, saveLeaderboard,
  unlockAchievement, addLeaderboardEntry, onDocSaved,
} from './storage.js';
import { createUI, DEFAULT_BINDINGS } from './ui.js';
import { T, N, lang, onLanguage } from './lang.js';
import { createRenderer } from './render.js';
import { AudioEngine } from './audio.js';
import { Platform } from './platform.js';
import { shStrings } from './sh-strings.js';

const settings = loadSettings();
const progression = loadProgression();
const achievements = loadAchievements();
const leaderboard = loadLeaderboard();
const platform = new Platform();
platform.consent = !!settings.consent;
// StarHermit account strings in the game's current language.
const shT = () => shStrings([lang()]);

// --- cloud mirror (hosted only; localStorage stays the offline cache) ------------

function cloudDoc() {
  return {
    v: 1,
    settings: structuredClone(settings),
    progression: structuredClone(progression),
    achievements: structuredClone(achievements),
    leaderboard: structuredClone(leaderboard),
  };
}
platform.getCloudDoc = cloudDoc;

let applyingRemoteDoc = false;
onDocSaved((key) => {
  if (applyingRemoteDoc) return;
  platform.scheduleCloudSave();
  if (key === 'settings') platform.pushSettings(settings); // per-player settings KV (changed keys only)
});

/**
 * Merge the cloud mirror into the local docs — at boot and after a save
 * conflict (another device saved first). Neither side is dropped: completed
 * stages/lessons/challenges and daily days are united keeping the better
 * score, totals take the larger value, achievements keep the earliest unlock,
 * and leaderboard runs are united (deduplicated by session). Settings stay
 * this device's (the per-player settings KV syncs them).
 */
function applyCloudDoc(doc) {
  if (!doc || typeof doc !== 'object') return false;
  let applied = false;
  if (doc.progression && typeof doc.progression === 'object') {
    mergeProgression(progression, doc.progression);
    applied = true;
  }
  if (doc.achievements && typeof doc.achievements === 'object') {
    const mine = achievements.unlocked || (achievements.unlocked = {});
    for (const [k, v] of Object.entries(doc.achievements.unlocked || {})) {
      if (mine[k] == null || (typeof v === 'number' && typeof mine[k] === 'number' && v < mine[k])) mine[k] = v;
    }
    applied = true;
  }
  if (doc.leaderboard && Array.isArray(doc.leaderboard.entries)) {
    const key = (e) => e.sessionId || `${e.mode}|${e.day}|${e.score}|${e.when}`;
    const seen = new Set(leaderboard.entries.map(key));
    for (const e of doc.leaderboard.entries) {
      if (!seen.has(key(e))) { seen.add(key(e)); addLeaderboardEntry(leaderboard, structuredClone(e)); }
    }
    applied = true;
  }
  if (!applied) return false;
  applyingRemoteDoc = true;
  try {
    saveProgression(progression);
    saveAchievements(achievements);
    saveLeaderboard(leaderboard);
  } finally {
    applyingRemoteDoc = false;
  }
  return true;
}

function mergeProgression(local, remote) {
  const better = (a, b) => (!a ? b : !b ? a : (b.score || 0) > (a.score || 0) ? b : a);
  for (const field of ['journeyCompleted', 'challengesCompleted']) {
    local[field] = local[field] || {};
    for (const [id, v] of Object.entries(remote[field] || {})) local[field][id] = better(local[field][id], v);
  }
  local.lessonsCompleted = { ...(remote.lessonsCompleted || {}), ...(local.lessonsCompleted || {}) };
  local.totalDistance = Math.max(Number(local.totalDistance) || 0, Number(remote.totalDistance) || 0);
  local.totalRuns = Math.max(Number(local.totalRuns) || 0, Number(remote.totalRuns) || 0);
  local.dailyDays = [...new Set([...(local.dailyDays || []), ...(remote.dailyDays || [])])].sort();
  local.bestDaily = local.bestDaily || {};
  for (const [day, sc] of Object.entries(remote.bestDaily || {})) local.bestDaily[day] = Math.max(Number(local.bestDaily[day]) || 0, Number(sc) || 0);
}

// Another device saved first: merge its cloud mirror into ours, keep any run
// in progress, and save the merge (platform.js reloads and re-saves).
platform.onConflict = (doc) => {
  if (applyCloudDoc(doc) && ui) {
    ui.refreshTitle(progression);
    if (ui.currentScreen === 'journey') ui.buildJourneyGrid(progression);
    if (ui.currentScreen === 'scores') ui.renderScores(leaderboard);
  }
};

const audio = new AudioEngine(settings);
const $ = (id) => document.getElementById(id);

// --- game flow state ----------------------------------------------------------

let renderer = null;
let session = null;
let pendingContent = null;
let lastContent = null;
let gameState = 'boot'; // boot → title → mode-select → preparing → countdown → active ↔ paused → results
let frameHandle = null;
let lastFrameTime = null;
let checkpointTick = 0;
let checkpoints = [];
let autoPaused = false;

function track(event, props) {
  platform.track(event, props);
}

function applySettingsEffects() {
  platform.consent = !!settings.consent;
  ui.applyA11yClasses();
  renderer && renderer.applyQuality && renderer.applyQuality();
  renderer && renderer.applyPalette && renderer.applyPalette();
  for (const bus of ['music', 'effects', 'ambience', 'voice']) audio.setVolume(bus, settings[bus]);
}

// --- sync status chip (hosted only) -------------------------------------------------

function renderSyncChip() {
  const chip = $('sync-chip');
  if (!platform.hosted) { chip.hidden = true; return; }
  chip.hidden = false;
  const text = { saving: N('Syncing…'), synced: N('Cloud synced'), offline: N('Cloud offline') }[platform.syncState];
  chip.textContent = text ? T(text) : platform.syncState;
  chip.title = T('Cloud save status');
}

// --- achievements ---------------------------------------------------------------

function checkAchievements(result, content) {
  const newly = [];
  const unlock = (key) => {
    if (unlockAchievement(achievements, key)) newly.push(key);
  };
  unlock('first_finish');
  if (content.kind === 'learn') {
    if (LESSONS.every((l) => progression.lessonsCompleted[l.id] || l.id === content.id)) unlock('lesson_graduate');
  }
  if (content.kind === 'journey') {
    const idx = content.index;
    if (idx >= 20) unlock('journey_20');
    if (idx >= 40) unlock('journey_40');
  }
  if (progression.dailyDays.length >= 3) unlock('streak_3');
  if (progression.totalDistance >= 100000) unlock('distance_100k');
  if (newly.length) {
    saveAchievements(achievements);
    // no toast: unlocks happen as the run ends and the results screen lists
    // them (#results-achievements); a toast there only pushed the results down
    audio.event('achievement');
  }
  return newly;
}

// --- run lifecycle -----------------------------------------------------------------

function startRun(content, restoredSession = null) {
  pendingContent = null;
  lastContent = content;
  gameState = 'preparing';
  ui.hideScreens();
  ui.showHUD(true);

  session = restoredSession || new RunSession(content, {
    onEvents: handleEvents,
    onEnd: handleRunEnd,
  });
  session.keepCheckpoints = content.kind === 'practice';
  checkpoints = [];
  checkpointTick = 0;
  audio.setSeed(content.seed);
  renderer.setTheme(content.theme || 'day', content.seed);
  if (!restoredSession) {
    beginCountdown();
  } else {
    gameState = 'active';
  }
  platform.startPresence();
  track('run_start', { mode: content.kind, id: content.id });
}

function beginCountdown() {
  gameState = 'countdown';
  let n = 3;
  ui.countdown(String(n));
  audio.event('countdown');
  const timer = setInterval(() => {
    n--;
    if (n > 0) {
      ui.countdown(String(n));
      audio.event('countdown');
    } else {
      clearInterval(timer);
      ui.countdown(T('GO'));
      audio.event('go');
      audio.startMusic();
      setTimeout(() => ui.countdown(null), 500);
      gameState = 'active';
    }
  }, 700);
}

function handleEvents(events, state) {
  renderer.handleEvents(events, state);
  for (const e of events) {
    audio.event(e.type);
    if (e.type === 'invalid') {
      ui.announce(T('Can’t do that: {reason}', { reason: e.reason }));
    } else if (e.type === 'crash') {
      ui.announce(T('Crash!'));
      if (navigator.vibrate && !settings.reducedMotion) navigator.vibrate(80);
    } else if (e.type === 'goal') {
      ui.announce(T('Objective complete!'));
    }
  }
  void state;
}

function handleRunEnd(result, envelope, state) {
  gameState = 'results';
  audio.stopMusic();
  platform.stopPresence();
  ui.showHUD(false);

  const content = lastContent;
  const isGoal = result.reason === 'goal';

  // progression
  progression.totalRuns += 1;
  progression.totalDistance += result.distance;
  if (content.kind === 'journey' && isGoal) {
    progression.journeyCompleted[content.id] = { score: result.score, ticks: result.tick };
  }
  if (content.kind === 'learn' && isGoal) {
    progression.lessonsCompleted[content.id] = true;
    settings.tutorialDone = true;
    saveSettings(settings);
  }
  if (content.kind === 'challenge' && isGoal) {
    const prev = progression.challengesCompleted[content.id];
    if (!prev || result.score > prev.score) {
      progression.challengesCompleted[content.id] = { score: result.score };
    }
  }
  let dailyDay = null;
  if (content.kind === 'daily') {
    dailyDay = content.day;
    if (!progression.dailyDays.includes(dailyDay)) progression.dailyDays.push(dailyDay);
    if (!progression.bestDaily[dailyDay] || result.score > progression.bestDaily[dailyDay]) {
      progression.bestDaily[dailyDay] = result.score;
    }
  }
  saveProgression(progression);

  // leaderboard (not for practice)
  let isBest = false;
  let bestScore = null;
  if (content.kind !== 'practice' && result.reason !== 'quit') {
    const scopeEntries = leaderboard.entries.filter(
      (e) => e.mode === content.kind && (content.kind !== 'daily' || e.day === dailyDay)
    );
    bestScore = scopeEntries.length ? Math.max(...scopeEntries.map((e) => e.score)) : null;
    isBest = bestScore === null || result.score > bestScore;
    addLeaderboardEntry(leaderboard, {
      name: platform.nickname || T('You'), mine: true,
      score: result.score, distance: result.distance, ticks: result.tick,
      invalid: result.stats.invalidActions, mode: content.kind, day: dailyDay,
      seed: content.seed, ruleset: 'v1', assists: settings.hints ? 'hints' : 'none',
      sessionId: result.sessionId, when: Date.now(),
    });
    saveLeaderboard(leaderboard);
  }

  if (isBest && bestScore !== null) audio.event('best');

  const newAchievements = checkAchievements(result, content);

  // daily: submit replay for validation when hosted
  if (content.kind === 'daily') {
    platform.submitDaily(envelope, content.day).then((verdict) => {
      if (verdict && verdict.ok === false) ui.toast(T('Daily submission rejected: {error}', { error: verdict.error || 'invalid' }));
    });
  }

  // next recommended action
  let nextContent = null;
  if (content.kind === 'journey' && isGoal && content.index < JOURNEY_STAGES.length) {
    nextContent = JOURNEY_STAGES[content.index]; // index is 1-based
  }
  $('btn-next').onclick = () => nextContent && selectContent(nextContent);

  track('run_end', { mode: content.kind, reason: result.reason, score: result.score });
  ui.showResults(result, { isBest, bestScore, newAchievements, nextContent, content });
  postToLeaderboard(content.kind !== 'practice' && content.kind !== 'learn' && result.reason !== 'quit', result.score);
  ui.refreshTitle(progression);
}

// Signed in only: post a finished run (not practice, lessons or quits) and show the board rank.
let lbSeq = 0;
function postToLeaderboard(eligible, score) {
  const line = $('results-lb');
  const seq = ++lbSeq;
  if (!eligible || !platform.hosted) { line.hidden = true; return; }
  line.hidden = false;
  lbResult = null;
  renderLeaderboardLine();
  platform.submitScore(score).then((r) => {
    if (seq !== lbSeq) return;
    lbResult = r;
    renderLeaderboardLine();
  });
}
let lbResult = null;
function renderLeaderboardLine() {
  const line = $('results-lb');
  if (line.hidden) return;
  const r = lbResult;
  line.textContent = !r ? shT().lbPosting : !r.posted ? shT().lbNotPosted
    : r.rank ? shT().lbRank.replace('{rank}', r.rank) : shT().lbPosted;
}

function pauseGame() {
  if (gameState !== 'active' || !session) return;
  session.pause();
  gameState = 'paused';
  audio.event('ui');
  audio.suspend();
  ui.showPause(true, { practice: lastContent?.kind === 'practice' });
}

function resumeGame() {
  if (!session) return;
  ui.showPause(false);
  ui.hideInterrupt();
  ui.hideScreens();
  ui.showHUD(true);
  session.resume();
  audio.resume();
  gameState = 'active';
}

function quitRun() {
  if (!session) return;
  ui.showPause(false);
  session.resume();
  session.quit();
}

function rewindRun() {
  if (!session || !checkpoints.length) return;
  const cp = checkpoints[checkpoints.length - 1];
  session.restoreCheckpoint(cp);
  ui.showPause(false);
  gameState = 'active';
  session.resume();
  audio.event('rewind');
  ui.toast(T('Rewound 5 seconds'));
}

// --- content selection -------------------------------------------------------------------

function selectContent(content) {
  pendingContent = content;
  ui.showSetup(content);
}

// --- input ----------------------------------------------------------------------------------

function bindings() {
  return { ...DEFAULT_BINDINGS, ...(settings.bindings || {}) };
}

function actionForKey(code) {
  const b = bindings();
  for (const [action, codes] of Object.entries(b)) {
    if (codes.includes(code)) return action;
  }
  return null;
}

function doAction(action) {
  if (gameState !== 'active' || !session) return;
  const res = session.command(action);
  if (!res.accepted && res.reason && res.reason !== 'run-over') {
    ui.announce(T('Not now: {reason}', { reason: res.reason }));
  }
}

function setupInput() {
  // keyboard
  window.addEventListener('keydown', (e) => {
    if (ui.handleRebind(e)) return;
    if (e.repeat) return;
    const action = actionForKey(e.code);
    if (action === 'pause') {
      e.preventDefault();
      if (gameState === 'active') pauseGame();
      else if (gameState === 'paused') resumeGame();
      return;
    }
    if (action && (gameState === 'active')) {
      e.preventDefault();
      doAction(action);
    }
  });

  // touch: swipe gestures with tap/drag thresholds; tray buttons as DOM equivalent
  const host = $('canvas-host');
  let touchStart = null;
  host.addEventListener('pointerdown', (e) => {
    audio.unlock();
    touchStart = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    host.setPointerCapture(e.pointerId);
  });
  host.addEventListener('pointerup', (e) => {
    if (!touchStart || touchStart.id !== e.pointerId) return;
    const dx = e.clientX - touchStart.x;
    const dy = e.clientY - touchStart.y;
    const dt = performance.now() - touchStart.t;
    touchStart = null;
    if (dt > 600) return; // slow drags are camera-ish gestures; ignore
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (Math.max(adx, ady) < 24) return; // tap: no accidental commits
    if (adx > ady) doAction(dx > 0 ? 'right' : 'left');
    else doAction(dy > 0 ? 'slide' : 'jump');
  });
  host.addEventListener('pointercancel', () => { touchStart = null; });
  host.addEventListener('lostpointercapture', () => { touchStart = null; });

  document.querySelectorAll('.tray-btn').forEach((btn) => {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      audio.unlock();
      doAction(btn.dataset.action);
    });
  });

  // gamepad: polled in the frame loop
}

let gamepadPrev = {};
function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const pad = pads && pads[0];
  if (!pad) return;
  const pressed = {
    left: pad.buttons[14]?.pressed || pad.axes[0] < -0.5,
    right: pad.buttons[15]?.pressed || pad.axes[0] > 0.5,
    jump: pad.buttons[0]?.pressed || pad.buttons[12]?.pressed || pad.axes[1] < -0.5,
    slide: pad.buttons[1]?.pressed || pad.buttons[13]?.pressed || pad.axes[1] > 0.5,
    pause: pad.buttons[9]?.pressed,
  };
  for (const [action, isDown] of Object.entries(pressed)) {
    if (isDown && !gamepadPrev[action]) {
      if (action === 'pause') {
        if (gameState === 'active') pauseGame();
        else if (gameState === 'paused') resumeGame();
      } else {
        doAction(action);
      }
    }
  }
  gamepadPrev = pressed;
}

// --- frame loop ----------------------------------------------------------------------

function frameLoop(now) {
  frameHandle = requestAnimationFrame(frameLoop);
  const dt = lastFrameTime === null ? 0.016 : Math.min(0.1, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  pollGamepad();

  if (session && (gameState === 'active' || gameState === 'countdown')) {
    if (gameState === 'active') {
      session.update(now);
      // practice checkpoints every 5s
      if (session.keepCheckpoints && session.state.tick - checkpointTick >= 150) {
        checkpointTick = session.state.tick;
        checkpoints.push(session.snapshot());
        if (checkpoints.length > 4) checkpoints.shift();
      }
      const speed = speedAt(session.state.distance, session.state.config);
      audio.setIntensity((speed - 2) / 5);
      ui.updateHUD(lastContent, session.state, totalScore(session.state));
    }
    renderer.frame(session.state, session.alpha, dt);
  } else if (renderer && idleState) {
    // attract mode: gentle idle drift behind menus
    renderer.frame(idleState.state, 1, dt);
  }
}

// idle backdrop state: a slowly advancing decorative snapshot
let idleState = null;
let idleTick = 0;
function makeIdleState() {
  const daily = dailyInfo();
  idleState = new RunSession({ ...daily, id: 'attract', kind: 'attract' }, {});
}
function advanceIdle() {
  if (!idleState) return;
  if (idleState.state.status !== 'active') {
    makeIdleState(); // attract run crashed or finished — restart the drift
    return;
  }
  idleTick++;
  if (idleTick % 2 === 0) {
    idleState.update(performance.now());
  }
}

// --- wiring ------------------------------------------------------------------------------

let ui;

function wire() {
  ui = createUI({
    onNavigate: (name) => track('nav', { screen: name }),
    onSelectContent: selectContent,
    onSettingsChanged: () => {
      saveSettings(settings);
      applySettingsEffects();
    },
    // rebinding UI: persist to the player's StarHermit controls when signed in
    onRebind: () => { platform.saveBindings({ ...DEFAULT_BINDINGS, ...(settings.bindings || {}) }); },
    onResetBindings: () => { platform.resetBindings(); },
    resetKeysLabel: () => shT().resetKeys,
    getRenderer: () => renderer,
  }, { settings });

  // StarHermit account: sign-in (platform host, no token) / invite (signed in)
  $('btn-signin').textContent = shT().signIn;
  $('btn-invite').textContent = shT().invite;
  $('btn-signin').addEventListener('click', () => platform.signIn());
  $('btn-invite').addEventListener('click', () => {
    const link = platform.inviteLink();
    if (!link) return;
    // navigator.clipboard is undefined outside secure contexts: report it instead of throwing
    const clip = navigator.clipboard?.writeText ? navigator.clipboard.writeText(link) : Promise.reject(new Error('clipboard unavailable'));
    clip.then(() => ui.toast(shT().copied), () => ui.toast(shT().copyFailed));
  });

  // title
  $('btn-play').addEventListener('click', () => selectContent({ ...dailyInfo(platform.now()), kind: 'daily' }));
  $('btn-journey').addEventListener('click', () => { ui.buildJourneyGrid(progression); ui.showScreen('journey'); });
  $('btn-learn').addEventListener('click', () => { ui.buildLessonList(progression); ui.showScreen('learn'); });
  $('btn-practice').addEventListener('click', () => ui.showScreen('practice'));
  $('btn-challenge').addEventListener('click', () => { ui.buildChallengeList(progression); ui.showScreen('challenge'); });
  $('btn-scores').addEventListener('click', () => { ui.renderScores(leaderboard); ui.showScreen('scores'); });
  $('btn-settings').addEventListener('click', () => { ui.fillSettings(); ui.showScreen('settings'); });
  $('btn-help').addEventListener('click', () => { ui.buildHelp(); ui.showScreen('help'); });

  document.querySelectorAll('[data-back]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (gameState === 'paused') {
        ui.showScreen('title');
        ui.showPause(true, { practice: lastContent?.kind === 'practice' });
        return;
      }
      ui.refreshTitle(progression);
      ui.showScreen('title');
    });
  });

  $('btn-practice-start').addEventListener('click', () => {
    const diff = document.querySelector('input[name="difficulty"]:checked').value;
    selectContent({ ...practiceConfig(diff), seed: (Math.random() * 0xffffffff) >>> 0 });
  });

  $('btn-setup-start').addEventListener('click', () => {
    audio.unlock();
    if (pendingContent) startRun(pendingContent);
  });

  // HUD + pause
  $('btn-pause').addEventListener('click', pauseGame);
  $('btn-resume').addEventListener('click', resumeGame);
  $('btn-rewind').addEventListener('click', rewindRun);
  $('btn-pause-restart').addEventListener('click', () => {
    ui.showPause(false);
    const content = lastContent;
    session && session.clearSnapshot();
    startRun(content);
  });
  $('btn-pause-quit').addEventListener('click', quitRun);
  $('btn-pause-settings').addEventListener('click', () => { ui.showPause(false); ui.fillSettings(); ui.showScreen('settings'); });
  $('btn-pause-help').addEventListener('click', () => { ui.showPause(false); ui.buildHelp(); ui.showScreen('help'); });

  // results
  $('btn-retry').addEventListener('click', () => startRun(lastContent));
  $('btn-results-menu').addEventListener('click', () => {
    ui.refreshTitle(progression);
    ui.showScreen('title');
  });

  // scores filters
  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      ui.setScoreFilter(btn.dataset.filter);
      ui.renderScores(leaderboard);
    });
  });

  // audio toggle
  $('btn-audio-toggle').addEventListener('click', (e) => {
    audio.unlock();
    const muted = !audio.muted;
    audio.setMuted(muted);
    e.currentTarget.setAttribute('aria-pressed', String(muted));
    e.currentTarget.textContent = muted ? '∅' : '♪';
  });

  // interrupt overlay
  $('btn-interrupt-resume').addEventListener('click', () => {
    ui.hideInterrupt();
    resumeGame();
  });
  $('btn-interrupt-abandon').addEventListener('click', () => {
    ui.hideInterrupt();
    if (session) {
      session.resume();
      session.quit();
    }
  });

  // reset data
  $('btn-reset-data').addEventListener('click', () => {
    if (!confirm(T('Reset all local progress, scores, and achievements?'))) return;
    for (const key of Object.keys(progression)) delete progression[key];
    Object.assign(progression, { journeyCompleted: {}, lessonsCompleted: {}, challengesCompleted: {}, totalDistance: 0, totalRuns: 0, dailyDays: [], bestDaily: {} });
    achievements.unlocked = {};
    leaderboard.entries = [];
    saveProgression(progression);
    saveAchievements(achievements);
    saveLeaderboard(leaderboard);
    ui.refreshTitle(progression);
    ui.toast(T('Local progress reset'));
  });

  // unlock audio on first gesture anywhere
  window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
  window.addEventListener('keydown', () => audio.unlock(), { once: true });

  // lifecycle: backgrounding pauses solo simulation
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      platform.flushCloudSave();
      if (gameState === 'active') {
        autoPaused = true;
        pauseGame();
      }
      audio.suspend();
    } else {
      audio.resume();
      if (gameState === 'paused' && session && autoPaused) {
        autoPaused = false;
        ui.showInterrupt(() => T('Your run was paused while you were away. State is restored exactly as you left it.'));
      }
    }
  });

  window.addEventListener('resize', () => renderer && renderer.resize());
  window.addEventListener('orientationchange', () => setTimeout(() => renderer && renderer.resize(), 60));
  ui.bindSettingsInputs();

  // Settings → Language: js/i18n.js re-translates the markup and fires md-language;
  // everything built in code follows without touching the run.
  onLanguage(() => {
    $('btn-signin').textContent = shT().signIn;
    $('btn-invite').textContent = shT().invite;
    if (!platform.nickname) $('profile-chip').textContent = T('Guest');
    renderSyncChip();
    renderLeaderboardLine();
    ui.relabel(progression, leaderboard);
    if (session && lastContent && (gameState === 'active' || gameState === 'paused')) ui.updateHUD(lastContent, session.state, totalScore(session.state));
  });
  // live cost summary / pixel size while the Settings screen is open
  setInterval(() => { if (ui.currentScreen === 'settings') ui.refreshGraphics(); }, 700);
}

// --- boot ------------------------------------------------------------------------------------

async function boot() {
  const remoteDoc = await platform.init();
  $('profile-chip').textContent = T('Guest');

  // identity + sync status (hosted only; offline stays "Guest" with no chip)
  if (platform.nickname) $('profile-chip').textContent = platform.nickname;
  platform.onSyncChange(renderSyncChip);
  renderSyncChip();
  const refreshAccountButtons = () => {
    $('btn-signin').hidden = !platform.canSignIn();
    $('btn-invite').hidden = !platform.hosted;
  };
  platform.onAuth((a) => {
    refreshAccountButtons();
    renderSyncChip();
    if (!a.signedIn) {
      $('profile-chip').textContent = T('Guest');
      ui.toast(shT().signedOut); // keep playing locally
    }
  });

  // cloud mirror flush when leaving the page
  window.addEventListener('pagehide', () => platform.flushCloudSave());

  // clock chip: server-synced UTC
  const tickClock = () => {
    $('clock-chip').textContent = platform.now().toISOString().slice(11, 16) + ' UTC';
  };
  tickClock();
  setInterval(tickClock, 30000);

  const host = $('canvas-host');
  renderer = createRenderer(host, { settings, theme: 'dawn', seed: dailyInfo().seed });
  if (!renderer.is3d) $('webgl-warning').hidden = false;

  wire();
  setupInput();
  ui.applyA11yClasses();
  ui.refreshTitle(progression);
  ui.showScreen('title');
  ui.buildHelp();

  // the cloud mirror loaded during init: merge it with local progress before
  // records render, and write the merge back (conditional on the version read)
  if (applyCloudDoc(remoteDoc)) {
    ui.refreshTitle(progression);
    ui.buildHelp();
    platform.scheduleCloudSave();
  }
  if (platform.hosted) {
    // settings KV wins over the local / cloud copy, key by key; key bindings
    // come from the player's StarHermit controls
    const [kv, keys] = await Promise.all([
      platform.loadSettings(),
      platform.loadBindings({ ...DEFAULT_BINDINGS, ...(settings.bindings || {}) }),
    ]);
    for (const k of Object.keys(settings)) {
      if (k !== 'bindings' && kv[k] !== undefined && kv[k] !== null) settings[k] = kv[k];
    }
    settings.bindings = keys;
    applyingRemoteDoc = true;
    try { saveSettings(settings); } finally { applyingRemoteDoc = false; }
    platform.primeSettings(settings);
    applySettingsEffects();
    ui.buildHelp();
  }
  refreshAccountButtons();

  // offer resume of an interrupted run ("while you were away")
  for (const content of resumeCandidates()) {
    const restored = RunSession.restore(content.kind + ':' + content.id, content, {
      onEvents: handleEvents, onEnd: handleRunEnd,
    });
    if (restored && restored.state.status === 'active') {
      session = restored;
      lastContent = content;
      session.pause();
      gameState = 'paused';
      const dist = Math.floor(restored.state.distance);
      ui.showInterrupt(() => T('You have an interrupted run at {n} units. Pick up exactly where you left off.', { n: dist }));
      break;
    }
  }

  makeIdleState();
  setInterval(advanceIdle, 50);
  gameState = session ? 'paused' : 'title';
  // debug/testing handle (read-only inspection)
  window.__md = {
    get state() { return gameState; },
    get session() { return session; },
    get settings() { return settings; },
  };
  platform.startActivity();
  window.addEventListener('beforeunload', () => platform.endActivity());
  track('boot', { dpr: window.devicePixelRatio, coarse: matchMedia('(pointer: coarse)').matches });
  frameHandle = requestAnimationFrame(frameLoop);
}

function resumeCandidates() {
  const daily = dailyInfo(platform.now());
  const list = [{ ...daily, kind: 'daily' }];
  for (const stage of JOURNEY_STAGES) list.push(stage);
  for (const lesson of LESSONS) list.push(lesson);
  return list;
}

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML = '<main style="padding:2rem"><h1>Metro Dash</h1><p></p></main>';
  document.querySelector('main p').textContent = T('Something went wrong while starting the game. Your saved progress is untouched — please reload.');
});
