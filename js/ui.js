// UI: responsive DOM shell, screen routing, focus management, live
// announcements, settings, help cards generated from current bindings.
// UI state is fully separate from simulation state.

import {
  JOURNEY_STAGES, CHALLENGES, LESSONS, ACHIEVEMENTS, dailyInfo,
} from './content.js';
import { TICKS_PER_SECOND, speedAt } from './rules.js';

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

  // --- helpers -----------------------------------------------------------------

  function announce(msg) {
    $('sr-status').textContent = msg;
  }

  function toast(msg, ms = 2600) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    $('toast-region').appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  function fmtScore(n) {
    return Math.floor(n).toLocaleString('en-US');
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
    $('btn-play').textContent = `Play Daily Run — ${daily.day}`;
    $('title-progress').textContent =
      `Journey ${done}/${JOURNEY_STAGES.length} · Lessons ${Object.keys(progression.lessonsCompleted).length}/${LESSONS.length}` +
      ` · Total distance ${fmtScore(progression.totalDistance)}`;
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
      btn.setAttribute('aria-label',
        `Stage ${i + 1}${stage.mastery ? ', mastery' : ''}${done ? ', completed' : ''}${unlocked ? '' : ', locked'}`);
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
      title.textContent = lesson.label;
      btn.appendChild(title);
      if (done) {
        const mark = document.createElement('span');
        mark.className = 'done-mark';
        mark.textContent = '✓ done';
        btn.appendChild(mark);
      }
      const small = document.createElement('small');
      small.textContent = lesson.briefing;
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
      title.textContent = ch.label;
      btn.appendChild(title);
      if (done) {
        const mark = document.createElement('span');
        mark.className = 'done-mark';
        mark.textContent = `✓ ${fmtScore(done.score)}`;
        btn.appendChild(mark);
      }
      const small = document.createElement('small');
      small.textContent = ch.briefing;
      btn.appendChild(small);
      btn.addEventListener('click', () => handlers.onSelectContent(ch));
      list.appendChild(btn);
    }
  }

  // --- setup / briefing ---------------------------------------------------------------

  function showSetup(content) {
    $('setup-h').textContent = content.label;
    const facts = $('setup-facts');
    facts.textContent = '';
    const goal = content.config.goal;
    const rows = [
      ['Mode', content.kind],
      ['Objective', goal
        ? goal.type === 'distance' ? `Reach ${fmtScore(goal.value)} units`
        : goal.type === 'coins' ? `Collect ${goal.value} tokens`
        : `Perform ${goal.value}× ${goal.action}`
        : 'Endless — survive and score'],
      ['Speed', `${Math.round((content.config.speedScale || 1) * 100)}%`],
      ['Expected', goal ? `~${Math.max(1, Math.round((content.par?.ticks || 1200) / TICKS_PER_SECOND / 60))} min` : '1–5 min'],
      ['Players', '1'],
      ['Ranked', content.kind === 'daily' ? 'Yes (daily board)' : content.kind === 'practice' ? 'No' : 'Local board'],
    ];
    if (content.config.movesLimit) rows.push(['Move budget', String(content.config.movesLimit)]);
    if (content.config.allowedActions && content.config.allowedActions.length < 5) {
      rows.push(['Allowed moves', content.config.allowedActions.filter((a) => a !== 'wait').join(', ')]);
    }
    if (content.introduces && content.introduces.length) rows.push(['New mechanic', content.introduces.join(', ')]);
    for (const [k, v] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      facts.append(dt, dd);
    }
    $('setup-briefing').textContent = content.briefing || '';
    showScreen('setup');
  }

  // --- HUD -------------------------------------------------------------------------

  let lastAnnouncedScore = 0;

  function objectiveText(content, state) {
    const goal = content.config.goal;
    if (!goal) return 'Survive. Score big.';
    if (goal.type === 'distance') return `Reach ${fmtScore(goal.value)} units — ${fmtScore(Math.min(state.distance, goal.value))} so far`;
    if (goal.type === 'coins') return `Collect ${goal.value} tokens — ${state.stats.coins} so far`;
    return `Perform ${goal.value}× ${goal.action} — ${state.stats[goal.action + 's'] || 0} so far`;
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
      moves.textContent = `Moves left: ${state.movesLeft}`;
    } else {
      moves.hidden = true;
    }
    // throttled score announcements for screen readers
    if (Math.floor(total / 250) !== Math.floor(lastAnnouncedScore / 250)) {
      announce(`Score ${fmtScore(total)}`);
    }
    lastAnnouncedScore = total;
  }

  // --- results -------------------------------------------------------------------------

  function showResults(result, context) {
    const { isBest, newAchievements, content } = context;
    $('results-h').textContent =
      result.reason === 'goal' ? 'Stage Complete' :
      result.reason === 'moves' ? 'Out of Moves' :
      result.reason === 'quit' ? 'Run Ended' : 'Run Over';
    const crashNames = { barrier: 'barrier', sign: 'sign', block: 'kiosk' };
    $('results-headline').textContent =
      result.reason === 'goal' ? `Objective complete — ${fmtScore(result.score)} points`
      : result.reason === 'crash' ? `Crushed it until the ${crashNames[result.crashedKind] || 'track'} fought back — ${fmtScore(result.score)} points`
      : `${fmtScore(result.score)} points`;
    const tbody = $('results-table').querySelector('tbody');
    tbody.textContent = '';
    const rows = [
      ['Distance', result.components.distance, `${fmtScore(result.distance)} units`],
      ['Clean dodges', result.components.dodge, ''],
      ['Tokens', result.components.collect, `${result.stats.coins} collected`],
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
      ? 'New personal best for this board!'
      : context.bestScore != null ? `Personal best: ${fmtScore(context.bestScore)}` : '';
    $('results-achievements').textContent = newAchievements.length
      ? 'Achievements: ' + newAchievements.map((k) => ACHIEVEMENTS.find((a) => a.key === k)?.label || k).join(' · ')
      : '';
    $('btn-next').hidden = !context.nextContent;
    showScreen('results');
    announce($('results-h').textContent + '. ' + $('results-headline').textContent);
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
      for (const val of [i + 1, fmtScore(e.score), e.mode + (e.day ? ' ' + e.day : ''), fmtScore(e.distance), new Date(e.when).toLocaleDateString()]) {
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
      td.textContent = 'No runs yet. Go play!';
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
      ['Move left', bindingLabel('left'), 'Also: swipe left, tap ◀, or gamepad D-pad'],
      ['Move right', bindingLabel('right'), 'Also: swipe right, tap ▶, or gamepad D-pad'],
      ['Jump', bindingLabel('jump'), 'Also: swipe up, tap ▲, or gamepad A'],
      ['Slide', bindingLabel('slide'), 'Also: swipe down, tap ▼, or gamepad B'],
      ['Pause', bindingLabel('pause'), 'Resume is always the first option'],
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
    $('set-quality').value = settings.quality;
    $('set-reduced-motion').checked = settings.reducedMotion;
    $('set-high-contrast').checked = settings.highContrast;
    $('set-large-text').checked = settings.largeText;
    $('set-left-handed').checked = settings.leftHanded;
    $('set-hints').checked = settings.hints;
    $('set-palette').value = settings.colorPalette;
    $('set-consent').checked = !!settings.consent;
    buildBindings();
  }

  function buildBindings() {
    const list = $('bindings-list');
    list.textContent = '';
    for (const action of ['left', 'right', 'jump', 'slide', 'pause']) {
      const row = document.createElement('div');
      row.className = 'binding-row';
      const label = document.createElement('span');
      label.textContent = action[0].toUpperCase() + action.slice(1);
      const btn = document.createElement('button');
      btn.className = 'btn small';
      btn.textContent = rebindingAction === action ? 'Press a key…' : bindingLabel(action);
      btn.setAttribute('aria-label', `Remap ${action}`);
      btn.addEventListener('click', () => {
        rebindingAction = action;
        buildBindings();
      });
      row.append(label, btn);
      list.appendChild(row);
    }
  }

  function handleRebind(e) {
    if (!rebindingAction) return false;
    e.preventDefault();
    const bindings = { ...DEFAULT_BINDINGS, ...(settings.bindings || {}) };
    bindings[rebindingAction] = [e.code];
    settings.bindings = bindings;
    rebindingAction = null;
    buildBindings();
    buildHelp();
    handlers.onSettingsChanged();
    return true;
  }

  function bindSettingsInputs() {
    const map = [
      ['set-music', 'music', 'value', Number],
      ['set-effects', 'effects', 'value', Number],
      ['set-ambience', 'ambience', 'value', Number],
      ['set-voice', 'voice', 'value', Number],
      ['set-quality', 'quality', 'value', String],
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

  function showInterrupt(summary) {
    $('overlay-interrupt').hidden = false;
    $('interrupt-summary').textContent = summary;
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
    applyA11yClasses,
    setScoreFilter(f) { scoreFilter = f; },
    get currentScreen() { return currentScreen; },
  };
}
