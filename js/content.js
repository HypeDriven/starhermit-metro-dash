// Versioned content: themes, lessons, journey stages, challenges, dailies,
// achievements. All content is plain data with identifier, seed, initial
// config, goals, allowed mechanics, par values, tutorial flags, and theme.

import { fnv1a } from './rng.js';
import { createInitialState, step, totalScore, legalActionMap, speedAt, TICKS_PER_SECOND } from './rules.js';

export const CONTENT_VERSION = 1;

// ---------------------------------------------------------------------------
// Themes (five visual themes; colors are consumed by the render layer)
// ---------------------------------------------------------------------------

export const THEMES = {
  dawn: {
    id: 'dawn',
    label: 'Harbor Dawn',
    skyTop: 0x2e3a67, skyBottom: 0xf2a56b, fog: 0xd98f6a,
    sun: 0xffd9a0, sunIntensity: 1.6, hemi: 0.7,
    building: 0x3b3f5c, window: 0xffd38a, ground: 0x4a4550, accent: 0xffb347,
    phaseOffset: 0.0,
  },
  day: {
    id: 'day',
    label: 'Civic Noon',
    skyTop: 0x3f7fd0, skyBottom: 0xbfe3f2, fog: 0xa8c8d8,
    sun: 0xfff4d6, sunIntensity: 2.0, hemi: 0.9,
    building: 0x5a6b7d, window: 0xe8f4ff, ground: 0x5d6066, accent: 0x2f9e8f,
    phaseOffset: 0.3,
  },
  dusk: {
    id: 'dusk',
    label: 'Ember Dusk',
    skyTop: 0x35255c, skyBottom: 0xe2614d, fog: 0xb06a6a,
    sun: 0xff9a5c, sunIntensity: 1.4, hemi: 0.6,
    building: 0x413553, window: 0xffc27a, ground: 0x4a4148, accent: 0xff7a59,
    phaseOffset: 0.6,
  },
  night: {
    id: 'night',
    label: 'Neon Night',
    skyTop: 0x070b1e, skyBottom: 0x1b2440, fog: 0x141a30,
    sun: 0x9db4ff, sunIntensity: 0.7, hemi: 0.35,
    building: 0x1c2238, window: 0x7fe7ff, ground: 0x232636, accent: 0x7fe7ff,
    phaseOffset: 0.85,
  },
  mono: {
    id: 'mono',
    label: 'Monorail Mist',
    skyTop: 0x46555e, skyBottom: 0x9db4b8, fog: 0x8aa0a4,
    sun: 0xf2f2e8, sunIntensity: 1.5, hemi: 0.8,
    building: 0x55666c, window: 0xfff2c8, ground: 0x525a58, accent: 0xd9f26b,
    phaseOffset: 0.45,
  },
};
export const THEME_IDS = Object.keys(THEMES);

// ---------------------------------------------------------------------------
// Learn mode — interactive lessons; each requires the player to perform the
// rule being taught. Scripted content keeps lessons identical for everyone.
// ---------------------------------------------------------------------------

function lessonScript(builders) {
  const script = [];
  for (const b of builders) script.push(...b);
  return script;
}
const barrierAt = (z, lane) => [{ z, lane, kind: 'barrier' }];
const signAt = (z, lane) => [{ z, lane, kind: 'sign' }];
const blockAt = (z, lane) => [{ z, lane, kind: 'block' }];
const coinLine = (z, lane, n = 4) => Array.from({ length: n }, (_, i) => ({ z: z + i * 10, lane, coin: true }));

export const LESSONS = [
  {
    id: 'learn-lanes',
    label: 'Lesson 1: Switch Lanes',
    teaches: 'left/right',
    briefing: 'Trains own the rails — you own the gaps. Switch lanes to dodge the kiosks ahead.',
    seed: fnv1a('lesson:lanes'),
    config: {
      goal: { type: 'actions', action: 'laneChange', value: 2 },
      speedScale: 0.55,
      script: lessonScript([
        blockAt(160, 0), // force a lane change from center
        coinLine(260, -1),
        blockAt(380, -1), blockAt(380, 1), // both sides blocked: change back to center
        coinLine(480, 0),
      ]),
    },
    par: { ticks: 30 * TICKS_PER_SECOND },
  },
  {
    id: 'learn-jump',
    label: 'Lesson 2: Jump',
    teaches: 'jump',
    briefing: 'Track barriers are knee-high. Jump clears them — time it as you arrive.',
    seed: fnv1a('lesson:jump'),
    config: {
      goal: { type: 'actions', action: 'jump', value: 3 },
      speedScale: 0.55,
      allowedActions: ['left', 'right', 'jump', 'wait'],
      script: lessonScript([
        barrierAt(160, 0), barrierAt(320, 0), barrierAt(480, 0),
        coinLine(640, 0),
      ]),
    },
    par: { ticks: 40 * TICKS_PER_SECOND },
  },
  {
    id: 'learn-slide',
    label: 'Lesson 3: Slide',
    teaches: 'slide',
    briefing: 'Overhead signs hang low. Slide under them and pop back up running.',
    seed: fnv1a('lesson:slide'),
    config: {
      goal: { type: 'actions', action: 'slide', value: 3 },
      speedScale: 0.55,
      allowedActions: ['left', 'right', 'slide', 'wait'],
      script: lessonScript([
        signAt(160, 0), signAt(320, 0), signAt(480, 0),
        coinLine(640, 0),
      ]),
    },
    par: { ticks: 40 * TICKS_PER_SECOND },
  },
  {
    id: 'learn-coins',
    label: 'Lesson 4: Collect',
    teaches: 'coins',
    briefing: 'Metro tokens line the fastest routes. Ride the line and grab 6 of them.',
    seed: fnv1a('lesson:coins'),
    config: {
      goal: { type: 'coins', value: 6 },
      speedScale: 0.6,
      script: lessonScript([
        coinLine(140, 0, 3), coinLine(260, -1, 4), coinLine(380, 1, 4),
        barrierAt(520, 1), coinLine(520, 0, 3),
      ]),
    },
    par: { ticks: 45 * TICKS_PER_SECOND },
  },
  {
    id: 'learn-combo',
    label: 'Lesson 5: Full Run',
    teaches: 'combined',
    briefing: 'Everything at once: lanes, jumps, slides, tokens. Reach the marker.',
    seed: fnv1a('lesson:combo'),
    config: {
      goal: { type: 'distance', value: 900 },
      speedScale: 0.7,
      script: lessonScript([
        barrierAt(160, 0), signAt(300, 0), blockAt(440, 0),
        coinLine(440, 1, 3), barrierAt(580, 1), signAt(700, 1),
        coinLine(820, 0, 4),
      ]),
    },
    par: { ticks: 45 * TICKS_PER_SECOND },
  },
];

// ---------------------------------------------------------------------------
// Journey — 40 authored stages. Mechanics layer in one at a time: introduce
// in isolation, combine with known mechanics, then a mastery stage.
// ---------------------------------------------------------------------------

function buildJourney() {
  const stages = [];
  const mechanics = [
    { key: 'barrier', label: 'Barriers', at: 1 },
    { key: 'sign', label: 'Overhead signs', at: 6 },
    { key: 'block', label: 'Kiosks (lane change only)', at: 11 },
    { key: 'coins', label: 'Token routes', at: 16 },
    { key: 'speed', label: 'Express speed', at: 21 },
    { key: 'dense', label: 'Rush hour density', at: 26 },
    { key: 'mixed', label: 'Mixed traffic', at: 31 },
  ];
  for (let i = 1; i <= 40; i++) {
    const mastery = i % 5 === 0;
    const mech = mechanics.filter((m) => m.at <= i).map((m) => m.key);
    const tier = Math.floor((i - 1) / 5); // 0..7
    const speedScale = 0.6 + tier * 0.09 + (mastery ? 0.05 : 0);
    const goalDist = 700 + i * 90 + (mastery ? 300 : 0);
    const theme = THEME_IDS[tier % THEME_IDS.length];
    const newest = mechanics.filter((m) => m.at === i).map((m) => m.label);
    stages.push({
      id: `journey-${String(i).padStart(2, '0')}`,
      index: i,
      label: mastery ? `Stage ${i} — Mastery` : `Stage ${i}`,
      kind: 'journey',
      mastery,
      seed: fnv1a(`journey:v${CONTENT_VERSION}:${i}`),
      theme,
      introduces: newest,
      mechanics: mech,
      config: {
        goal: { type: 'distance', value: goalDist },
        speedScale,
      },
      par: {
        score: Math.floor(goalDist * 0.1 + goalDist / 60 * 10),
        ticks: Math.ceil(goalDist / (2.1 * speedScale)) + 120,
      },
      tutorial: i === 1,
    });
  }
  return stages;
}
export const JOURNEY_STAGES = buildJourney();

// ---------------------------------------------------------------------------
// Challenges — constrained goals
// ---------------------------------------------------------------------------

export const CHALLENGES = [
  {
    id: 'ch-grounded',
    label: 'Grounded',
    kind: 'challenge',
    briefing: 'No jumping allowed. Slide and weave 1600 units through the city.',
    seed: fnv1a('challenge:grounded'),
    theme: 'dusk',
    config: {
      goal: { type: 'distance', value: 1600 },
      speedScale: 0.8,
      allowedActions: ['left', 'right', 'slide', 'wait'],
      noFullBlocks: false,
    },
    par: { score: 400 },
  },
  {
    id: 'ch-upright',
    label: 'Stay Upright',
    kind: 'challenge',
    briefing: 'No sliding. Jump and dodge your way to 1600 units.',
    seed: fnv1a('challenge:upright'),
    theme: 'day',
    config: {
      goal: { type: 'distance', value: 1600 },
      speedScale: 0.8,
      allowedActions: ['left', 'right', 'jump', 'wait'],
    },
    par: { score: 400 },
  },
  {
    id: 'ch-center-lock',
    label: 'Center Lock',
    kind: 'challenge',
    briefing: 'Locked to the center lane — only jumps and slides. Kiosks are rerouted. Survive 1200 units.',
    seed: fnv1a('challenge:center-lock'),
    theme: 'night',
    config: {
      goal: { type: 'distance', value: 1200 },
      speedScale: 0.75,
      allowedActions: ['jump', 'slide', 'wait'],
      noFullBlocks: true,
    },
    par: { score: 300 },
  },
  {
    id: 'ch-move-budget',
    label: 'Minimalist',
    kind: 'challenge',
    briefing: 'Only 30 moves. Plan every one and reach 1400 units.',
    seed: fnv1a('challenge:minimalist'),
    theme: 'mono',
    config: {
      goal: { type: 'distance', value: 1400 },
      speedScale: 0.7,
      movesLimit: 30,
      noFullBlocks: true,
    },
    par: { score: 320 },
  },
  {
    id: 'ch-express',
    label: 'Express Service',
    kind: 'challenge',
    briefing: 'Double speed. Reach 2000 units without a scratch.',
    seed: fnv1a('challenge:express'),
    theme: 'night',
    config: {
      goal: { type: 'distance', value: 2000 },
      speedScale: 1.5,
    },
    par: { score: 500 },
  },
  {
    id: 'ch-token-rush',
    label: 'Token Rush',
    kind: 'challenge',
    briefing: 'Collect 25 tokens before the line runs out.',
    seed: fnv1a('challenge:token-rush'),
    theme: 'dawn',
    config: {
      goal: { type: 'coins', value: 25 },
      speedScale: 0.9,
    },
    par: { score: 800 },
  },
];

// ---------------------------------------------------------------------------
// Daily — one shared seed per UTC day, immutable once derived
// ---------------------------------------------------------------------------

export function dailyInfo(date = new Date()) {
  const day = date.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const seed = fnv1a(`metro-dash:daily:v${CONTENT_VERSION}:${day}`);
  const theme = THEME_IDS[seed % THEME_IDS.length];
  return {
    id: `daily-${day}`,
    day,
    kind: 'daily',
    label: `Daily Run — ${day}`,
    seed,
    theme,
    config: { goal: null, speedScale: 1 }, // endless; score is the competition
    ruleset: `v${CONTENT_VERSION}`,
  };
}

export function practiceConfig(difficulty) {
  const table = {
    relaxed: { speedScale: 0.7, label: 'Relaxed' },
    standard: { speedScale: 1.0, label: 'Standard' },
    intense: { speedScale: 1.3, label: 'Intense' },
  };
  const d = table[difficulty] || table.standard;
  return { id: `practice-${difficulty}`, kind: 'practice', label: `Practice — ${d.label}`, config: { goal: null, speedScale: d.speedScale }, theme: 'day' };
}

// ---------------------------------------------------------------------------
// Achievements — stable lowercase keys, idempotent unlocks
// ---------------------------------------------------------------------------

export const ACHIEVEMENTS = [
  { key: 'first_finish', label: 'First Arrival', desc: 'Finish any run.' },
  { key: 'lesson_graduate', label: 'Graduate', desc: 'Complete all five lessons.' },
  { key: 'journey_20', label: 'Mid-Line', desc: 'Complete journey stage 20.' },
  { key: 'journey_40', label: 'End of the Line', desc: 'Complete journey stage 40.' },
  { key: 'streak_3', label: 'Regular Commuter', desc: 'Play the daily run on 3 different days.' },
  { key: 'distance_100k', label: 'Long Haul', desc: 'Travel 100,000 units in total.' },
];

// ---------------------------------------------------------------------------
// Offline validators — legality, reachable goals, bounded duration, no soft
// locks. A deterministic "reference bot" plays each stage with a simple
// policy; if the bot can finish, the goal is reachable by construction.
// ---------------------------------------------------------------------------

export function referenceBotAction(state) {
  // Greedy survival policy: hold when current motion already clears the
  // nearest threat, otherwise jump/slide with speed-scaled timing, otherwise
  // escape to the adjacent lane with the most clearance. Proves reachability.
  const legal = legalActionMap(state);
  const speed = speedAt(state.distance, state.config);
  const ahead = state.obstacles
    .filter((o) => !o.passed && o.z >= state.distance - 3.5)
    .sort((a, b) => a.z - b.z);
  const threat = ahead.find((o) => o.lane === state.lane);
  if (!threat) return 'wait';
  const dist = threat.z - state.distance;
  const eta = dist / speed;

  const clearance = (lane) => {
    const o = ahead.find((x) => x.lane === lane);
    return o ? o.z - state.distance : Infinity;
  };
  // Best lane globally (max clearance); move one step toward it. A margin
  // over the current threat prevents jitter without blocking two-step escapes.
  const bestLane = () => {
    let target = state.lane;
    let best = clearance(state.lane);
    for (const l of [-1, 0, 1]) {
      const c = clearance(l);
      if (c > best + 20) {
        best = c;
        target = l;
      }
    }
    if (target === state.lane) return null;
    const dir = Math.sign(target - state.lane);
    return legal[dir < 0 ? 'left' : 'right'].ok ? (dir < 0 ? 'left' : 'right') : null;
  };

  // 1. Current motion already covers this threat: hold course.
  const backEta = (threat.z + 3 - state.distance) / speed; // ticks until fully past
  if (threat.kind === 'barrier' && state.jumpTicksLeft > 0 && state.jumpTicksLeft - backEta >= 2) return 'wait';
  if (threat.kind === 'sign' && state.slideTicksLeft > 0 && state.slideTicksLeft - backEta >= 1) return 'wait';

  const canJump = state.config.allowedActions.includes('jump');
  const canSlide = state.config.allowedActions.includes('slide');
  const grounded = state.jumpTicksLeft === 0 && state.slideTicksLeft === 0;

  if (threat.kind === 'barrier') {
    if (grounded && canJump) return dist <= speed * 8 + 3 ? 'jump' : 'wait';
  } else if (threat.kind === 'sign') {
    if (grounded && canSlide) return dist <= speed * 12 + 3 ? 'slide' : 'wait';
  } else if (threat.kind === 'block' && eta <= 24) {
    const move = bestLane();
    if (move) return move;
  }

  // 2. Escape by lane: preferred action restricted, or still recovering from
  // a motion that will not cover this threat.
  if (dist <= speed * 12 + 3) {
    const move = bestLane();
    if (move) return move;
  }
  return 'wait';
}

export function simulateToEnd(seed, config, maxTicks = 30 * TICKS_PER_SECOND * 5) {
  const state = createInitialState(seed, config);
  let ticks = 0;
  while (state.status === 'active' && ticks < maxTicks) {
    step(state, referenceBotAction(state));
    ticks++;
  }
  return { state, ticks, timedOut: state.status === 'active' };
}

export function validateContent() {
  const problems = [];
  const ids = new Set();
  const all = [...JOURNEY_STAGES, ...CHALLENGES, ...LESSONS];
  for (const item of all) {
    if (ids.has(item.id)) problems.push(`duplicate id ${item.id}`);
    ids.add(item.id);
    if (typeof item.seed !== 'number') problems.push(`${item.id}: missing seed`);
    const { state, timedOut } = simulateToEnd(item.seed, item.config);
    if (timedOut) problems.push(`${item.id}: bot run exceeded time bound (possible soft lock)`);
    else if (item.config.goal && state.reason !== 'goal')
      problems.push(`${item.id}: goal not reached (reason=${state.reason})`);
  }
  // daily: generator must not soft-lock an endless run
  const daily = dailyInfo(new Date(Date.UTC(2026, 0, 1)));
  const endless = simulateToEnd(daily.seed, daily.config, 30 * TICKS_PER_SECOND * 3);
  if (endless.timedOut && endless.state.distance < 3000) {
    problems.push('daily: generator stalled at low distance');
  }
  return problems;
}

export { totalScore };
