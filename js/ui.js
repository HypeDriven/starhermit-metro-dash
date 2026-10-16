// UI: responsive DOM shell, screen routing, focus management, live
// announcements, settings, help cards generated from current bindings.
// UI state is fully separate from simulation state.

import {
  JOURNEY_STAGES, CHALLENGES, LESSONS, ACHIEVEMENTS, dailyInfo,
} from './content.js';
import { TICKS_PER_SECOND, speedAt } from './rules.js';
import { createGraphicsPanel } from './gfx-panel.js';
import { T, N, lang } from './lang.js';

const MODE_NAMES = { daily: N('Daily'), journey: N('Journey'), learn: N('Lesson'), practice: N('Practice'), challenge: N('Challenge') };
const ACTION_NAMES = { left: N('Left'), right: N('Right'), jump: N('Jump'), slide: N('Slide'), pause: N('Pause') };
const ACTION_WORDS = { left: N('left'), right: N('right'), jump: N('jump'), slide: N('slide'), wait: N('wait') };
const PRACTICE_LEVELS = { relaxed: N('Relaxed'), standard: N('Standard'), intense: N('Intense') };

/** Display title of a content item (labels in content.js are English keys). */
export function contentLabel(content) {
  if (!content) return '';
  if (content.kind === 'journey') return content.mastery ? T('Stage {n} — Mastery', { n: content.index }) : T('Stage {n}', { n: content.index });
  if (content.kind === 'daily') return T('Daily Run — {day}', { day: content.day });
  if (content.kind === 'practice') {
    const level = String(content.id || '').replace(/^practice-/, '');
    return T('Practice — {level}', { level: T(PRACTICE_LEVELS[level] || PRACTICE_LEVELS.standard) });
  }
  return T(content.label);
}

export const DEFAULT_BINDINGS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  jump: ['ArrowUp', 'KeyW', 'Space'],
  slide: ['ArrowDown', 'KeyS'],
  pause: ['Escape', 'KeyP'],
};

const $ = (id) => document.getElementById(id);

export function createUI(handlers, stores) {
  const { settings } = stores;
  let lastFocus = null;
  let rebindingAction = null;
  const gfxPanel = createGraphicsPanel({
    root: $('gfx-section'),
    settings,
    getRenderer: () => handlers.getRenderer && handlers.getRenderer(),
    onChange: () => handlers.onSettingsChanged(),
  });

  // --- helpers -----------------------------------------------------------------

  function announce(msg) {
    $('sr-status').textContent = msg;
  }

  // The toast stack's height (layout px; the stack is zoomed like the screens)
  // is reserved at the top of screens and overlays, so a toast never covers a
  // results heading or button.
  const toastRegion = $('toast-region');
  new MutationObserver(() => {
    const h = toastRegion.offsetHeight;
    document.documentElement.style.setProperty('--toast-h', h ? `${h + 8}px` : '0px');
  }).observe(toastRegion, { childList: true });

  function toast(msg, ms = 2600) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    $('toast-region').appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  function fmtScore(n) {
    return Math.floor(n).toLocaleString(lang()); // digit grouping follows the game language
  }

  // --- screen router -------------------------------------------------------------

  const SCREENS = ['title', 'journey', 'learn', 'challenge', 'practice', 'setup', 'results', 'scores', 'help', 'settings'];
  let currentScreen = 'title';

  function showScreen(name) {
    for (const s of SCREENS) {
      $('screen-' + s).hidden = s !== name;
    }
    currentScreen = name;
    const el = $('screen-' + name);
    const first = el.querySelector('button:not([disabled]), input, select, [tabindex]');
    if (first) first.focus({ preventScroll: true });
    handlers.onNavigate && handlers.onNavigate(name);
  }

  function hideScreens() {
    for (const s of SCREENS) $('screen-' + s).hidden = true;
    currentScreen = null;
  }

  function showHUD(show) {
    $('hud').hidden = !show;
  }

  // --- title ----------------------------------------------------------------------

  function refreshTitle(progression) {
    const done = Object.keys(progression.journeyCompleted).length;
    const daily = dailyInfo();
    $('btn-play').textContent = T('Play Daily Run — {day}', { day: daily.day });
    $('title-progress').textContent = T('Journey {done}/{stages} · Lessons {lessons}/{lessonTotal} · Total distance {distance}', {
      done, stages: JOURNEY_STAGES.length, lessons: Object.keys(progression.lessonsCompleted).length, lessonTotal: LESSONS.length,
      distance: fmtScore(progression.totalDistance),
    });
  }

  // --- journey grid -----------------------------------------------------------------

  function buildJourneyGrid(progression) {
    const grid = $('journey-grid');
    grid.textContent = '';
    const doneCount = Object.keys(progression.journeyCompleted).length;
    JOURNEY_STAGES.forEach((stage, i) => {
      const unlocked = i === 0 || progression.journeyCompleted[JOURNEY_STAGES[i - 1].id];
      const done = progression.journeyCompleted[stage.id];
      const btn = document.createElement('button');
      btn.className = 'stage-card' + (stage.mastery ? ' mastery' : '') + (done ? ' done' : '') + (!unlocked ? ' locked' : '');
      btn.setAttribute('role', 'listitem');
      btn.disabled = !unlocked;
      const label = document.createElement('span');
      label.textContent = stage.mastery ? `${i + 1} ★` : `${i + 1}`;
      btn.appendChild(label);
      if (done) {
        const stars = document.createElement('span');
        stars.className = 'stars';
        stars.textContent = done.score >= stage.par.score ? '★★★' : done.score >= stage.par.score * 0.66 ? '★★' : '★';
        btn.appendChild(stars);
      }
      btn.setAttribute('aria-label', [T('Stage {n}', { n: i + 1 }), stage.mastery ? T('mastery') : '', done ? T('completed') : '', unlocked ? '' : T('locked')]
        .filter(Boolean).join(', '));
      if (unlocked) btn.addEventListener('click', () => handlers.onSelectContent(stage));
      grid.appendChild(btn);
    });
    void doneCount;
  }

  // --- lesson / challenge lists -------------------------------------------------------

  function buildLessonList(progression) {
    const list = $('lesson-list');
    list.textContent = '';
    for (const lesson of LESSONS) {
      const done = progression.lessonsCompleted[lesson.id];
      const btn = document.createElement('button');
      btn.className = 'card';
      btn.setAttribute('role', 'listitem');
      btn.innerHTML = '';
      const title = document.createElement('strong');
      title.textContent = T(lesson.label);
      btn.appendChild(title);
      if (done) {
        const mark = document.createElement('span');
        mark.className = 'done-mark';
        mark.textContent = '✓ ' + T('done');
        btn.appendChild(mark);
      }
      const small = document.createElement('small');
      small.textContent = T(lesson.briefing);
      btn.appendChild(small);
      btn.addEventListener('click', () => handlers.onSelectContent(lesson));
      list.appendChild(btn);
    }
  }

  function buildChallengeList(progression) {
    const list = $('challenge-list');
    list.textContent = '';
    for (const ch of CHALLENGES) {
      const done = progression.challengesCompleted[ch.id];
      const btn = document.createElement('button');
      btn.className = 'card';
      btn.setAttribute('role', 'listitem');
      const title = document.createElement('strong');
      title.textContent = T(ch.label);
      btn.appendChild(title);
      if (done) {
        const mark = document.createElement('span');
        mark.className = 'done-mark';
        mark.textContent = `✓ ${fmtScore(done.score)}`;
        btn.appendChild(mark);
      }
      const small = document.createElement('small');
      small.textContent = T(ch.briefing);
      btn.appendChild(small);
      btn.addEventListener('click', () => handlers.onSelectContent(ch));
      list.appendChild(btn);
    }
  }

  // --- setup / briefing ---------------------------------------------------------------

  function showSetup(content) {
    setupContent = content;
    renderSetup();
    showScreen('setup');
  }
  let setupContent = null;
  function renderSetup() {
    const content = setupContent;
    if (!content) return;
    $('setup-h').textContent = contentLabel(content);
    const facts = $('setup-facts');
    facts.textContent = '';
    const goal = content.config.goal;
    const rows = [
      [T('Mode'), T(MODE_NAMES[content.kind] || content.kind)],
      [T('Objective'), goal
        ? goal.type === 'distance' ? T('Reach {n} units', { n: fmtScore(goal.value) })
        : goal.type === 'coins' ? T('Collect {n} tokens', { n: goal.value })
        : T('Perform {n}× {action}', { n: goal.value, action: T(ACTION_WORDS[goal.action] || goal.action) })
        : T('Endless — survive and score')],
      [T('Speed'), `${Math.round((content.config.speedScale || 1) * 100)}%`],
      [T('Expected'), goal ? T('~{n} min', { n: Math.max(1, Math.round((content.par?.ticks || 1200) / TICKS_PER_SECOND / 60)) }) : T('1–5 min')],
      [T('Players'), '1'],
      [T('Ranked'), content.kind === 'daily' ? T('Yes (daily board)') : content.kind === 'practice' ? T('No') : T('Local board')],
    ];
    if (content.config.movesLimit) rows.push([T('Move budget'), String(content.config.movesLimit)]);
    if (content.config.allowedActions && content.config.allowedActions.length < 5) {
      rows.push([T('Allowed moves'), content.config.allowedActions.filter((a) => a !== 'wait').map((a) => T(ACTION_WORDS[a] || a)).join(', ')]);
    }
    if (content.introduces && content.introduces.length) rows.push([T('New mechanic'), content.introduces.map((m) => T(m)).join(', ')]);
    for (const [k, v] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      facts.append(dt, dd);
    }
    $('setup-briefing').textContent = content.briefing ? T(content.briefing) : '';
  }

  // --- HUD -------------------------------------------------------------------------

  let lastAnnouncedScore = 0;

  function objectiveText(content, state) {
    const goal = content.config.goal;
    if (!goal) return T('Survive. Score big.');
    if (goal.type === 'distance') return T('Reach {n} units — {done} so far', { n: fmtScore(goal.value), done: fmtScore(Math.min(state.distance, goal.value)) });
    if (goal.type === 'coins') return T('Collect {n} tokens — {done} so far', { n: goal.value, done: state.stats.coins });
    return T('Perform {n}× {action} — {done} so far', { n: goal.value, action: T(ACTION_WORDS[goal.action] || goal.action), done: state.stats[goal.action + 's'] || 0 });
  }

  function objectiveProgress(content, state) {
    const goal = content.config.goal;
    if (!goal) return 0;
    if (goal.type === 'distance') return Math.min(1, state.distance / goal.value);
    if (goal.type === 'coins') return Math.min(1, state.stats.coins / goal.value);
    return Math.min(1, (state.stats[goal.action + 's'] || 0) / goal.value);
  }

  function updateHUD(content, state, total) {
    $('hud-score').textContent = fmtScore(total);
    $('hud-distance').textContent = fmtScore(state.distance);
    $('hud-coins').textContent = String(state.stats.coins);
    $('hud-speed').textContent = (speedAt(state.distance, state.config) * TICKS_PER_SECOND).toFixed(0) + ' u/s';
    $('hud-objective').textContent = objectiveText(content, state);
    const pct = Math.round(objectiveProgress(content, state) * 100);
    $('hud-progress-bar').style.width = pct + '%';
    const wrap = $('hud-progress-wrap');
    wrap.setAttribute('aria-valuenow', String(pct));
    const moves = $('hud-moves');
    if (state.movesLeft !== null) {
      moves.hidden = false;
      moves.textContent = T('Moves left: {n}', { n: state.movesLeft });
    } else {
      moves.hidden = true;
    }
    // throttled score announcements for screen readers
    if (Math.floor(total / 250) !== Math.floor(lastAnnouncedScore / 250)) {
      announce(T('Score {n}', { n: fmtScore(total) }));
    }
    lastAnnouncedScore = total;
  }

  // --- results -------------------------------------------------------------------------

  let lastResults = null;
  function showResults(result, context) {
    lastResults = { result, context };
    renderResults();
    showScreen('results');
    announce($('results-h').textContent + '. ' + $('results-headline').textContent);
  }
  // Results text only; re-rendered in place on a language change.
  function renderResults() {
    if (!lastResults) return;
    const { result, context } = lastResults;
    const { isBest, newAchievements, content } = context;
    $('results-h').textContent =
      result.reason === 'goal' ? T('Stage Complete') :
      result.reason === 'moves' ? T('Out of Moves') :
      result.reason === 'quit' ? T('Run Ended') : T('Run Over');
    const crashNames = { barrier: N('barrier'), sign: N('sign'), block: N('kiosk') };
    $('results-headline').textContent =
      result.reason === 'goal' ? T('Objective complete — {n} points', { n: fmtScore(result.score) })
      : result.reason === 'crash' ? T('Crushed it until the {obstacle} fought back — {n} points', { obstacle: T(crashNames[result.crashedKind] || N('track')), n: fmtScore(result.score) })
      : T('{n} points', { n: fmtScore(result.score) });
    const tbody = $('results-table').querySelector('tbody');
    tbody.textContent = '';
    const rows = [
      [T('Distance'), result.components.distance, T('{n} units', { n: fmtScore(result.distance) })],
      [T('Clean dodges'), result.components.dodge, ''],
      [T('Tokens'), result.components.collect, T('{n} collected', { n: result.stats.coins })],
    ];
    for (const [label, pts, note] of rows) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = label + (note ? ` (${note})` : '');
      const td = document.createElement('td');
      td.textContent = fmtScore(pts);
      tr.append(th, td);
      tbody.appendChild(tr);
    }
    $('results-total').textContent = fmtScore(result.score);
    $('results-comparison').textContent = isBest
      ? T('New personal best for this board!')
      : context.bestScore != null ? T('Personal best: {n}', { n: fmtScore(context.bestScore) }) : '';
    $('results-achievements').textContent = newAchievements.length
      ? T('Achievements: {names}', { names: newAchievements.map((k) => T(ACHIEVEMENTS.find((a) => a.key === k)?.label || k)).join(' · ') })
      : '';
    $('btn-next').hidden = !context.nextContent;
    void content;
  }

  // --- scores ----------------------------------------------------------------------------

  let scoreFilter = 'all';
  function renderScores(board) {
    const tbody = $('scores-table').querySelector('tbody');
    tbody.textContent = '';
    let entries = board.entries.slice();
    if (scoreFilter === 'daily') entries = entries.filter((e) => e.mode === 'daily');
    if (scoreFilter === 'mine') entries = entries.filter((e) => e.mine);
    entries.sort((a, b) => b.score - a.score);
    entries.slice(0, 50).forEach((e, i) => {
      const tr = document.createElement('tr');
      for (const val of [i + 1, fmtScore(e.score), T(MODE_NAMES[e.mode] || e.mode) + (e.day ? ' ' + e.day : ''), fmtScore(e.distance), new Date(e.when).toLocaleDateString(lang())]) {
        const td = document.createElement('td');
        td.textContent = String(val);
        tr.appendChild(td);
      }
      if (e.mine) tr.style.color = 'var(--accent)';
      tbody.appendChild(tr);
    });
    if (!entries.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = T('No runs yet. Go play!');
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
  }

  // --- help ---------------------------------------------------------------------------------

  function bindingLabel(action) {
    const b = (settings.bindings || DEFAULT_BINDINGS)[action] || DEFAULT_BINDINGS[action];
    return b.map((k) => k.replace('Arrow', '').replace('Key', '')).join(' / ');
  }

  function buildHelp() {
    const cards = $('help-cards');
    cards.textContent = '';
    const items = [
      [T('Move left'), bindingLabel('left'), T('Also: swipe left, tap ◀, or gamepad D-pad')],
      [T('Move right'), bindingLabel('right'), T('Also: swipe right, tap ▶, or gamepad D-pad')],
      [T('Jump'), bindingLabel('jump'), T('Also: swipe up, tap ▲, or gamepad A')],
      [T('Slide'), bindingLabel('slide'), T('Also: swipe down, tap ▼, or gamepad B')],
      [T('Pause'), bindingLabel('pause'), T('Resume is always the first option')],
    ];
    for (const [name, keys, alt] of items) {
      const div = document.createElement('div');
      div.className = 'card';
      const strong = document.createElement('strong');
      strong.textContent = name + ': ';
      const kbd = document.createElement('kbd');
      kbd.textContent = keys;
      const small = document.createElement('small');
      small.textContent = alt;
      div.append(strong, kbd, small);
      cards.appendChild(div);
    }
  }

  // --- settings ---------------------------------------------------------------------------

  function fillSettings() {
    $('set-music').value = settings.music;
    $('set-effects').value = settings.effects;
    $('set-ambience').value = settings.ambience;
    $('set-voice').value = settings.voice;
    $('set-reduced-motion').checked = settings.reducedMotion;
    $('set-high-contrast').checked = settings.highContrast;
    $('set-large-text').checked = settings.largeText;
    $('set-left-handed').checked = settings.leftHanded;
    $('set-hints').checked = settings.hints;
    $('set-palette').value = settings.colorPalette;
    $('set-consent').checked = !!settings.consent;
    gfxPanel.fill();
    buildBindings();
  }

  function buildBindings() {
    const list = $('bindings-list');
    list.textContent = '';
    for (const action of ['left', 'right', 'jump', 'slide', 'pause']) {
      const row = document.createElement('div');
      row.className = 'binding-row';
      const label = document.createElement('span');
      label.textContent = T(ACTION_NAMES[action]);
      const btn = document.createElement('button');
      btn.className = 'btn small';
      btn.textContent = rebindingAction === action ? T('Press a key…') : bindingLabel(action);
      btn.setAttribute('aria-label', T('Remap {action}', { action: T(ACTION_NAMES[action]) }));
      btn.addEventListener('click', () => {
        rebindingAction = action;
        buildBindings();
      });
      row.append(label, btn);
      list.appendChild(row);
    }
    const reset = document.createElement('button');
    reset.className = 'btn small';
    reset.id = 'btn-reset-bindings';
    reset.textContent = (handlers.resetKeysLabel && handlers.resetKeysLabel()) || T('Reset keys');
    reset.addEventListener('click', () => {
      settings.bindings = null;
      rebindingAction = null;
      buildBindings();
      buildHelp();
      handlers.onSettingsChanged();
      if (handlers.onResetBindings) handlers.onResetBindings();
    });
    list.appendChild(reset);
  }

  function handleRebind(e) {
    if (!rebindingAction) return false;
    e.preventDefault();
    const bindings = { ...DEFAULT_BINDINGS, ...(settings.bindings || {}) };
    // a code belongs to one action: take it away from any other action
    for (const a of Object.keys(bindings)) {
      if (a !== rebindingAction) bindings[a] = bindings[a].filter((c) => c !== e.code);
    }
    bindings[rebindingAction] = [e.code];
    settings.bindings = bindings;
    const action = rebindingAction;
    rebindingAction = null;
    buildBindings();
    buildHelp();
    handlers.onSettingsChanged();
    if (handlers.onRebind) handlers.onRebind(action, [e.code]);
    return true;
  }

  function bindSettingsInputs() {
    const map = [
      ['set-music', 'music', 'value', Number],
      ['set-effects', 'effects', 'value', Number],
      ['set-ambience', 'ambience', 'value', Number],
      ['set-voice', 'voice', 'value', Number],
      ['set-reduced-motion', 'reducedMotion', 'checked', Boolean],
      ['set-high-contrast', 'highContrast', 'checked', Boolean],
      ['set-large-text', 'largeText', 'checked', Boolean],
      ['set-left-handed', 'leftHanded', 'checked', Boolean],
      ['set-hints', 'hints', 'checked', Boolean],
      ['set-palette', 'colorPalette', 'value', String],
      ['set-consent', 'consent', 'checked', Boolean],
    ];
    for (const [id, key, prop, coerce] of map) {
      $(id).addEventListener('input', (e) => {
        settings[key] = coerce(e.target[prop]);
        handlers.onSettingsChanged();
      });
    }
  }

  // --- overlays -----------------------------------------------------------------------------

  function showPause(show, { practice } = {}) {
    $('overlay-pause').hidden = !show;
    $('btn-rewind').hidden = !practice;
    if (show) {
      lastFocus = document.activeElement;
      $('btn-resume').focus();
    } else if (lastFocus) {
      lastFocus.focus({ preventScroll: true });
      lastFocus = null;
    }
  }

  // summary may be a thunk so it follows a language change.
  let interruptSummary = null;
  function showInterrupt(summary) {
    interruptSummary = summary;
    $('overlay-interrupt').hidden = false;
    $('interrupt-summary').textContent = typeof summary === 'function' ? summary() : summary;
    $('btn-interrupt-resume').focus();
  }

  function hideInterrupt() {
    $('overlay-interrupt').hidden = true;
  }

  function countdown(text) {
    const ov = $('overlay-countdown');
    if (text === null) {
      ov.hidden = true;
      return;
    }
    ov.hidden = false;
    $('countdown-text').textContent = text;
    announce(text);
  }

  /* Settings → Language: js/i18n.js re-translated the static markup; rebuild
     everything built here (screens re-render in place, the run keeps going). */
  function relabel(progression, leaderboard) {
    gfxPanel.relabel();
    refreshTitle(progression);
    buildHelp();
    if (currentScreen === 'journey') buildJourneyGrid(progression);
    if (currentScreen === 'learn') buildLessonList(progression);
    if (currentScreen === 'challenge') buildChallengeList(progression);
    if (currentScreen === 'setup') renderSetup();
    if (currentScreen === 'results') renderResults();
    if (currentScreen === 'scores') renderScores(leaderboard);
    if (currentScreen === 'settings') buildBindings();
    if (!$('overlay-interrupt').hidden && interruptSummary) $('interrupt-summary').textContent = typeof interruptSummary === 'function' ? interruptSummary() : interruptSummary;
  }

  function applyA11yClasses() {
    document.body.classList.toggle('reduced-motion', settings.reducedMotion);
    document.body.classList.toggle('high-contrast', settings.highContrast);
    document.body.classList.toggle('large-text', settings.largeText);
    document.body.classList.toggle('left-handed', settings.leftHanded);
    document.body.classList.toggle('coarse', matchMedia('(pointer: coarse)').matches);
  }

  return {
    showScreen, hideScreens, showHUD, updateHUD, showResults, showSetup,
    showPause, showInterrupt, hideInterrupt, countdown, toast, announce,
    refreshTitle, buildJourneyGrid, buildLessonList, buildChallengeList,
    renderScores, buildHelp, fillSettings, bindSettingsInputs, handleRebind,
    refreshGraphics: () => gfxPanel.refresh(),
    relabel,
    applyA11yClasses,
    setScoreFilter(f) { scoreFilter = f; },
    get currentScreen() { return currentScreen; },
  };
}
