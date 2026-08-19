// Metro Dash — pure deterministic rules engine.
// No DOM, no rendering, no wall-clock time. Every state transition is a
// function of (state, command). Serializable state, monotonic tick counter,
// legal-action queries, terminal-state reasons.

import { Rng, fnv1a } from './rng.js';

export const RULES_VERSION = 1;
export const TICKS_PER_SECOND = 30;
export const LANES = [-1, 0, 1];
export const LANE_WIDTH = 6; // world units between lane centers

export const JUMP_TICKS = 16;
export const JUMP_HEIGHT = 5.5;
export const SLIDE_TICKS = 18;
export const SPAWN_AHEAD = 700; // units of track generated ahead of the player
export const DESPAWN_BEHIND = 40;
export const OBSTACLE_DEPTH = 4;
export const PLAYER_DEPTH = 2;

export const SCORE = {
  DISTANCE_PER_UNIT: 0.1, // accumulated as integer units, divided at presentation
  DODGE: 10,
  COIN: 25,
};

export const ACTIONS = ['left', 'right', 'jump', 'slide', 'wait'];

// Obstacle kinds:
//  barrier — ground barrier: jump over it or change lane
//  sign    — overhead sign: slide under it or change lane
//  block   — full-height obstacle (kiosk/train car): must change lane
export const OBSTACLE_KINDS = ['barrier', 'sign', 'block'];

export function speedAt(distance, config) {
  const base = 2.1 * (config.speedScale || 1);
  const growth = 0.00085 * (config.speedScale || 1);
  const cap = 6.4 * (config.speedScale || 1);
  return Math.min(cap, base + distance * growth);
}

// Parabolic jump height given ticks remaining (0 == grounded).
export function jumpHeight(jumpTicksLeft) {
  if (jumpTicksLeft <= 0) return 0;
  const t = JUMP_TICKS - jumpTicksLeft;
  return 4 * JUMP_HEIGHT * (t / JUMP_TICKS) * (1 - t / JUMP_TICKS);
}

const BARRIER_CLEAR_HEIGHT = 2.0; // must be at least this high to clear a barrier
const COIN_HIGH_HEIGHT = 2.5; // at/above this collects "high" coins

const DEFAULT_CONFIG = {
  goal: null, // {type:'distance'|'coins'|'actions', value, action?} | null (endless)
  speedScale: 1,
  allowedActions: ACTIONS.slice(),
  movesLimit: null, // number | null — non-wait actions budget
  noFullBlocks: false, // generator must not emit 'block' kind (lane-restricted play)
  script: null, // optional fixed spawn sequence for lessons: [{z, lane, kind}|{z, lane, coin, high}]
};

export function normalizeConfig(config) {
  return Object.assign({}, DEFAULT_CONFIG, config || {});
}

export function createInitialState(seed, config) {
  const cfg = normalizeConfig(config);
  const state = {
    version: RULES_VERSION,
    seed: seed >>> 0,
    tick: 0,
    distance: 0,
    lane: 0,
    jumpTicksLeft: 0,
    slideTicksLeft: 0,
    obstacles: [], // {id, z, lane, kind, passed}
    coins: [], // {id, z, lane, high, taken}
    nextSpawnZ: 120,
    nextId: 1,
    rngState: null, // generator cursor, initialized below
    score: { distance: 0, dodge: 0, collect: 0 },
    stats: { jumps: 0, slides: 0, laneChanges: 0, invalidActions: 0, coins: 0 },
    movesLeft: cfg.movesLimit,
    status: 'active', // 'active' | 'over'
    reason: null, // 'crash' | 'goal' | 'moves' | 'quit'
    crashedInto: null,
    config: cfg,
  };
  const rng = new Rng(state.seed);
  ensureSpawned(state, rng);
  state.rngState = rng.state;
  return state;
}

function generatorRng(state) {
  const r = new Rng(1);
  r.state = state.rngState;
  return r;
}

// ---------------------------------------------------------------------------
// Content generation (rules-stream; fully deterministic from seed)
// ---------------------------------------------------------------------------

// Pattern table. Every pattern guarantees at least one survivable path.
// weight(distance) shapes difficulty by how far into the run we are.
function patternTable(state) {
  const d = state.distance;
  const t = [];
  const noBlocks = state.config.noFullBlocks;
  t.push({ name: 'single-barrier', w: 10 });
  t.push({ name: 'single-sign', w: d > 300 ? 10 : 0 });
  if (!noBlocks) t.push({ name: 'single-block', w: d > 700 ? 8 : 0 });
  t.push({ name: 'double-mixed', w: d > 1200 ? 9 : 0 }); // two lanes covered, one free
  if (!noBlocks) t.push({ name: 'double-block', w: d > 2200 ? 6 : 0 });
  t.push({ name: 'barrier-plus-sign', w: d > 1800 ? 7 : 0 });
  t.push({ name: 'coin-line', w: 7 });
  t.push({ name: 'coin-arc', w: d > 400 ? 6 : 0 }); // high coins over a barrier
  t.push({ name: 'coin-snake', w: d > 900 ? 5 : 0 });
  t.push({ name: 'gap', w: 6 });
  return t.filter((p) => p.w > 0);
}

function pickPattern(state, rng) {
  const table = patternTable(state);
  let total = 0;
  for (const p of table) total += p.w;
  let roll = rng.next() * total;
  for (const p of table) {
    roll -= p.w;
    if (roll <= 0) return p.name;
  }
  return table[table.length - 1].name;
}

function addObstacle(state, z, lane, kind) {
  state.obstacles.push({ id: state.nextId++, z, lane, kind, passed: false });
}

function addCoin(state, z, lane, high) {
  state.coins.push({ id: state.nextId++, z, lane, high: !!high, taken: false });
}

function spawnPattern(state, rng, z) {
  const name = pickPattern(state, rng);
  const lanes = [-1, 0, 1];
  // Fisher-Yates with the run's stream (stable across JS engines, unlike sort comparators)
  const shuffled = lanes.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }
  switch (name) {
    case 'single-barrier':
      addObstacle(state, z, rng.pick(lanes), 'barrier');
      return 60;
    case 'single-sign':
      addObstacle(state, z, rng.pick(lanes), 'sign');
      return 60;
    case 'single-block':
      addObstacle(state, z, rng.pick(lanes), 'block');
      return 70;
    case 'double-mixed': {
      // cover two lanes, leave one entirely free
      const free = rng.pick(lanes);
      const kinds = ['barrier', 'sign'];
      for (const lane of lanes) {
        if (lane === free) continue;
        addObstacle(state, z, lane, rng.pick(kinds));
      }
      return 80;
    }
    case 'double-block': {
      const free = rng.pick(lanes);
      for (const lane of lanes) {
        if (lane === free) continue;
        addObstacle(state, z, lane, 'block');
      }
      return 90;
    }
    case 'barrier-plus-sign': {
      // barrier on one lane, sign on another; third lane free
      const a = shuffled[0];
      const b = shuffled[1];
      addObstacle(state, z, a, 'barrier');
      addObstacle(state, z, b, 'sign');
      return 80;
    }
    case 'coin-line': {
      const lane = rng.pick(lanes);
      for (let i = 0; i < 5; i++) addCoin(state, z + i * 10, lane, false);
      return 70;
    }
    case 'coin-arc': {
      const lane = rng.pick(lanes);
      addObstacle(state, z + 20, lane, 'barrier');
      for (let i = 0; i < 5; i++) addCoin(state, z + i * 10, lane, i >= 1 && i <= 3);
      return 80;
    }
    case 'coin-snake': {
      const startLane = rng.pick(lanes);
      for (let i = 0; i < 6; i++) {
        const lane = Math.max(-1, Math.min(1, startLane + (i % 3) - 1));
        addCoin(state, z + i * 10, lane, false);
      }
      return 80;
    }
    case 'gap':
    default:
      return 50;
  }
}

function ensureSpawned(state, rng) {
  if (state.config.script) {
    // Scripted lessons: emit the script exactly once, then nothing.
    if (!state.scriptEmitted) {
      for (const item of state.config.script) {
        if (item.coin) addCoin(state, item.z, item.lane, item.high);
        else addObstacle(state, item.z, item.lane, item.kind);
      }
      state.scriptEmitted = true;
    }
    return;
  }
  const horizon = state.distance + SPAWN_AHEAD;
  while (state.nextSpawnZ < horizon) {
    const used = spawnPattern(state, rng, state.nextSpawnZ);
    // spacing scales down as speed rises, but stays reaction-safe
    const speed = speedAt(state.distance, state.config);
    const minGap = Math.max(38, 90 - speed * 6);
    state.nextSpawnZ += Math.max(minGap, used + rng.int(0, 40));
  }
}

// ---------------------------------------------------------------------------
// Legal actions
// ---------------------------------------------------------------------------

export function legalActions(state) {
  const out = [];
  if (state.status !== 'active') {
    for (const a of ACTIONS) out.push({ action: a, ok: false, reason: 'run-over' });
    return out;
  }
  const allowed = state.config.allowedActions;
  const grounded = state.jumpTicksLeft === 0 && state.slideTicksLeft === 0;

  const push = (action, ok, reason) => {
    if (!allowed.includes(action)) {
      out.push({ action, ok: false, reason: 'restricted' });
    } else {
      out.push({ action, ok, reason: ok ? null : reason });
    }
  };

  push('left', state.lane > -1, 'left-edge');
  push('right', state.lane < 1, 'right-edge');
  push('jump', grounded, state.jumpTicksLeft > 0 ? 'airborne' : 'sliding');
  push('slide', grounded, state.slideTicksLeft > 0 ? 'sliding' : 'airborne');
  push('wait', true, null);
  return out;
}

export function legalActionMap(state) {
  const m = {};
  for (const e of legalActions(state)) m[e.action] = e;
  return m;
}

export function isLegal(state, action) {
  const e = legalActionMap(state)[action];
  return !!(e && e.ok);
}

// ---------------------------------------------------------------------------
// Simulation step
// ---------------------------------------------------------------------------

// Advance exactly one tick. `command` is one of ACTIONS (validated here;
// invalid commands are counted and ignored — they never throw).
// Returns an events array for render/audio (does not affect state).
export function step(state, command) {
  const events = [];
  if (state.status !== 'active') return events;
  if (!ACTIONS.includes(command)) {
    state.stats.invalidActions += 1;
    events.push({ type: 'invalid', action: String(command), reason: 'unknown-action' });
    command = 'wait';
  }

  state.tick += 1;

  // --- apply command ---
  const legality = legalActionMap(state)[command];
  if (!legality.ok) {
    state.stats.invalidActions += 1;
    events.push({ type: 'invalid', action: command, reason: legality.reason });
  } else if (command === 'left' || command === 'right') {
    state.lane += command === 'left' ? -1 : 1;
    state.stats.laneChanges += 1;
    if (state.movesLeft !== null) state.movesLeft -= 1;
    events.push({ type: 'lane', lane: state.lane });
  } else if (command === 'jump') {
    state.jumpTicksLeft = JUMP_TICKS;
    state.stats.jumps += 1;
    if (state.movesLeft !== null) state.movesLeft -= 1;
    events.push({ type: 'jump' });
  } else if (command === 'slide') {
    state.slideTicksLeft = SLIDE_TICKS;
    state.stats.slides += 1;
    if (state.movesLeft !== null) state.movesLeft -= 1;
    events.push({ type: 'slide' });
  }

  // --- advance motion ---
  const speed = speedAt(state.distance, state.config);
  const prevDistance = state.distance;
  state.distance += speed;
  if (state.jumpTicksLeft > 0) state.jumpTicksLeft -= 1;
  if (state.slideTicksLeft > 0) state.slideTicksLeft -= 1;
  const height = jumpHeight(state.jumpTicksLeft);

  // --- obstacle resolution: anything whose body we entered this tick ---
  for (const ob of state.obstacles) {
    if (ob.passed) continue;
    const frontEdge = ob.z - OBSTACLE_DEPTH / 2 - PLAYER_DEPTH / 2;
    const backEdge = ob.z + OBSTACLE_DEPTH / 2 + PLAYER_DEPTH / 2;
    if (backEdge < prevDistance || frontEdge > state.distance) {
      if (backEdge < state.distance) {
        ob.passed = true;
        state.score.dodge += SCORE.DODGE;
        events.push({ type: 'dodge', id: ob.id, kind: ob.kind });
      }
      continue;
    }
    // overlapping longitudinally: only same-lane obstacles threaten us
    if (ob.lane !== state.lane) continue;
    let hit = false;
    if (ob.kind === 'barrier') hit = height < BARRIER_CLEAR_HEIGHT;
    else if (ob.kind === 'sign') hit = state.slideTicksLeft <= 0;
    else hit = true; // block
    if (hit) {
      state.status = 'over';
      state.reason = 'crash';
      state.crashedInto = { id: ob.id, kind: ob.kind, lane: ob.lane, z: ob.z };
      events.push({ type: 'crash', kind: ob.kind, lane: ob.lane });
      finalizeScore(state);
      return events;
    }
  }

  // --- coins ---
  for (const c of state.coins) {
    if (c.taken) continue;
    if (c.z < prevDistance - 2 || c.z > state.distance + 2) {
      if (c.z + 2 < state.distance) c.taken = true; // missed, retire
      continue;
    }
    if (c.lane !== state.lane) continue;
    const collected = c.high ? height >= COIN_HIGH_HEIGHT : height < COIN_HIGH_HEIGHT;
    if (collected) {
      c.taken = true;
      state.stats.coins += 1;
      state.score.collect += SCORE.COIN;
      events.push({ type: 'coin', id: c.id, lane: c.lane });
    }
  }

  // --- housekeeping ---
  state.obstacles = state.obstacles.filter((o) => !o.passed || o.z > state.distance - DESPAWN_BEHIND);
  state.coins = state.coins.filter((c) => !c.taken || c.z > state.distance - DESPAWN_BEHIND);
  const rng = generatorRng(state);
  ensureSpawned(state, rng);
  state.rngState = rng.state;

  // --- terminal conditions ---
  const goal = state.config.goal;
  if (goal) {
    let done = false;
    if (goal.type === 'distance') done = state.distance >= goal.value;
    else if (goal.type === 'coins') done = state.stats.coins >= goal.value;
    else if (goal.type === 'actions') done = (state.stats[goal.action + 's'] || 0) >= goal.value;
    if (done) {
      state.status = 'over';
      state.reason = 'goal';
      events.push({ type: 'goal' });
      finalizeScore(state);
      return events;
    }
  }
  if (state.movesLeft !== null && state.movesLeft <= 0) {
    state.status = 'over';
    state.reason = 'moves';
    events.push({ type: 'moves-out' });
    finalizeScore(state);
    return events;
  }
  return events;
}

function finalizeScore(state) {
  state.score.distance = Math.floor(state.distance * SCORE.DISTANCE_PER_UNIT);
}

export function totalScore(state) {
  return state.score.distance + state.score.dodge + state.score.collect;
}

export function quitRun(state) {
  if (state.status !== 'active') return;
  state.status = 'over';
  state.reason = 'quit';
  finalizeScore(state);
}

// ---------------------------------------------------------------------------
// Serialization / hashing (stable, versioned)
// ---------------------------------------------------------------------------

export function serialize(state) {
  // canonical key order via explicit construction
  const s = {
    version: state.version,
    seed: state.seed,
    tick: state.tick,
    distance: state.distance,
    lane: state.lane,
    jumpTicksLeft: state.jumpTicksLeft,
    slideTicksLeft: state.slideTicksLeft,
    obstacles: state.obstacles.map((o) => ({ id: o.id, z: o.z, lane: o.lane, kind: o.kind, passed: o.passed })),
    coins: state.coins.map((c) => ({ id: c.id, z: c.z, lane: c.lane, high: c.high, taken: c.taken })),
    nextSpawnZ: state.nextSpawnZ,
    nextId: state.nextId,
    rngState: state.rngState,
    scriptEmitted: !!state.scriptEmitted,
    score: { ...state.score },
    stats: { ...state.stats },
    movesLeft: state.movesLeft,
    status: state.status,
    reason: state.reason,
    crashedInto: state.crashedInto,
    config: state.config,
  };
  return JSON.stringify(s);
}

export function deserialize(json) {
  const s = JSON.parse(json);
  if (typeof s.version !== 'number' || s.version > RULES_VERSION) {
    throw new Error(`unsupported state version ${s.version}`);
  }
  // migration hook: version 1 is current; fill forward-compatible defaults
  s.scriptEmitted = !!s.scriptEmitted;
  return s;
}

export function stateHash(state) {
  return fnv1a(serialize(state)).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export function replayEnvelope({ seed, config, commands, result }) {
  return {
    schema: 1,
    game: 'metro-dash',
    rulesVersion: RULES_VERSION,
    seed: seed >>> 0,
    config: normalizeConfig(config),
    commands: commands.map((c) => ({ tick: c.tick, action: c.action, id: c.id || null })),
    result: result || null,
  };
}

// Re-run a replay envelope. Returns {ok, hash, score, reason, mismatchTick?}.
export function validateReplay(envelope) {
  if (!envelope || envelope.schema !== 1 || envelope.rulesVersion !== RULES_VERSION) {
    return { ok: false, error: 'unsupported-envelope' };
  }
  const state = createInitialState(envelope.seed, envelope.config);
  // commands carry the tick at which they were applied; first command per tick
  // wins, duplicates are dropped idempotently
  const byTick = new Map();
  for (const c of envelope.commands) {
    if (!byTick.has(c.tick)) byTick.set(c.tick, c.action);
  }
  const maxTick = envelope.result ? envelope.result.tick : Math.max(0, ...byTick.keys());
  for (let t = 1; t <= maxTick; t++) {
    step(state, byTick.get(t) || 'wait');
    if (state.status !== 'active') break;
  }
  const hash = stateHash(state);
  const r = envelope.result;
  const ok =
    !r ||
    (r.hash === hash && r.score === totalScore(state) && r.reason === state.reason && r.tick === state.tick);
  return { ok, hash, score: totalScore(state), reason: state.reason, tick: state.tick };
}
