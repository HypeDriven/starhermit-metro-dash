// Node test runner: rules legality, determinism/replay, serialization,
// content validation. Run: node tests/rules.test.mjs
import {
  createInitialState, step, legalActions, legalActionMap, isLegal,
  serialize, deserialize, stateHash, totalScore, quitRun, replayEnvelope,
  validateReplay, jumpHeight, JUMP_TICKS, ACTIONS, RULES_VERSION,
} from '../js/rules.js';
import {
  JOURNEY_STAGES, CHALLENGES, LESSONS, ACHIEVEMENTS, THEMES, dailyInfo,
  validateContent, simulateToEnd, referenceBotAction,
} from '../js/content.js';

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; }
  else { failed++; console.error(`FAIL: ${name}`); }
}
function section(name) { console.log(`\n== ${name}`); }

// --- legal actions -----------------------------------------------------------
section('legal actions');
{
  const s = createInitialState(12345, { goal: { type: 'distance', value: 100 } });
  ok(s.tick === 0 && s.status === 'active' && s.lane === 0, 'initial state sane');
  const m = legalActionMap(s);
  ok(m.left.ok && m.right.ok && m.jump.ok && m.slide.ok && m.wait.ok, 'all actions legal at start');
  step(s, 'left');
  ok(s.lane === -1 && !legalActionMap(s).left.ok, 'left edge blocks further left');
  ok(legalActionMap(s).left.reason === 'left-edge', 'invalid reason reported');
  step(s, 'right'); step(s, 'right');
  ok(s.lane === 1 && !legalActionMap(s).right.ok, 'right edge blocks further right');
  step(s, 'jump');
  ok(!legalActionMap(s).jump.ok && legalActionMap(s).jump.reason === 'airborne', 'no double jump');
  ok(!legalActionMap(s).slide.ok, 'no slide while airborne');
  const inv = s.stats.invalidActions;
  step(s, 'jump');
  ok(s.stats.invalidActions === inv + 1, 'invalid action counted, ignored');
  ok(!ACTIONS.includes('fly') && step(s, 'fly').some(e => e.type === 'invalid'), 'unknown command treated as invalid');
  // restricted actions
  const s2 = createInitialState(7, { allowedActions: ['jump', 'wait'] });
  ok(!legalActionMap(s2).left.ok && legalActionMap(s2).left.reason === 'restricted', 'restricted action rejected');
  ok(isLegal(s2, 'jump') && !isLegal(s2, 'slide'), 'isLegal matches');
}

// --- crash and terminal reasons ----------------------------------------------
section('terminal states');
{
  // crash: drive straight into whatever comes, never dodge
  const s = createInitialState(999, { goal: null });
  let guard = 30000;
  while (s.status === 'active' && guard-- > 0) step(s, 'wait');
  ok(s.status === 'over' && s.reason === 'crash', 'passive run ends in crash');
  ok(s.crashedInto && s.score.distance > 0, 'crash records culprit and distance score');
  ok(legalActions(s).every(a => !a.ok), 'no legal actions after run over');
  // goal
  const g = createInitialState(1, { goal: { type: 'distance', value: 50 }, speedScale: 0.5 });
  guard = 5000;
  while (g.status === 'active' && guard-- > 0) step(g, 'wait');
  ok(g.reason === 'goal', 'distance goal terminates run');
  // moves limit
  const mv = createInitialState(2, { movesLimit: 3, goal: { type: 'distance', value: 100000 }, speedScale: 0.3 });
  step(mv, 'jump'); step(mv, 'wait');
  while (mv.jumpTicksLeft > 0) step(mv, 'wait');
  step(mv, 'slide');
  while (mv.slideTicksLeft > 0) step(mv, 'wait');
  step(mv, 'left');
  ok(mv.movesLeft === 0 && mv.reason === 'moves', 'move budget terminates run');
  // quit
  const q = createInitialState(3, {});
  step(q, 'wait'); quitRun(q);
  ok(q.reason === 'quit' && q.status === 'over', 'quit reason recorded');
}

// --- determinism / replay -----------------------------------------------------
section('determinism and replay');
{
  const seed = 0xC0FFEE;
  const config = { goal: null, speedScale: 1.2 };
  const script = ['wait', 'left', 'jump', 'wait', 'slide', 'right', 'jump', 'wait'];
  const runOnce = () => {
    const st = createInitialState(seed, config);
    const commands = [];
    let guard = 30000;
    while (st.status === 'active' && guard-- > 0) {
      const a = script[st.tick % script.length];
      step(st, a);
      if (a !== 'wait') commands.push({ tick: st.tick, action: a });
    }
    return { st, commands };
  };
  const a = runOnce(), b = runOnce();
  ok(stateHash(a.st) === stateHash(b.st), 'same seed+commands => identical hash');
  ok(a.st.status === 'over', 'scripted run terminates');
  const env = replayEnvelope({
    seed, config, commands: a.commands,
    result: { tick: a.st.tick, hash: stateHash(a.st), score: totalScore(a.st), reason: a.st.reason },
  });
  const verdict = validateReplay(env);
  ok(verdict.ok, `replay validates (${verdict.error || 'ok'})`);
  const tampered = JSON.parse(JSON.stringify(env));
  tampered.result.score += 1;
  ok(!validateReplay(tampered).ok, 'tampered score rejected');
  const dup = JSON.parse(JSON.stringify(env));
  dup.commands.push({ ...dup.commands[0] });
  ok(validateReplay(dup).ok, 'duplicate commands rejected idempotently');
}

// --- serialization ------------------------------------------------------------
section('serialization');
{
  const s = createInitialState(4242, { goal: { type: 'coins', value: 5 } });
  for (let i = 0; i < 200; i++) step(s, ['wait', 'left', 'jump', 'right'][i % 4]);
  const h1 = stateHash(s);
  const restored = deserialize(serialize(s));
  ok(stateHash(restored) === h1, 'serialize/deserialize roundtrip preserves hash');
  // continue from restored state identically
  const a = restored, b = deserialize(serialize(s));
  for (let i = 0; i < 100; i++) { step(a, 'jump'); step(b, 'jump'); }
  ok(stateHash(a) === stateHash(b), 'restored state continues identically');
  let threw = false;
  try { deserialize(JSON.stringify({ version: 999 })); } catch { threw = true; }
  ok(threw, 'future version rejected');
}

// --- jump arc sanity ----------------------------------------------------------
section('motion model');
{
  let peak = 0;
  for (let t = 0; t <= JUMP_TICKS; t++) peak = Math.max(peak, jumpHeight(t));
  ok(peak > 4, 'jump clears barrier height');
  ok(jumpHeight(0) === 0, 'grounded height is zero');
}

// --- fuzz: malformed commands must never hang or NaN --------------------------
section('fuzz');
{
  const junk = [null, undefined, '', 'fly', 42, {}, [], 'LEFT', ' jump'];
  for (let seed = 0; seed < 20; seed++) {
    const st = createInitialState(seed, { goal: { type: 'distance', value: 2000 } });
    let guard = 20000;
    while (st.status === 'active' && guard-- > 0) {
      step(st, junk[Math.floor(Math.random() * junk.length)] ?? ACTIONS[seed % ACTIONS.length]);
      if (!Number.isFinite(st.distance) || !Number.isFinite(st.tick)) throw new Error('NaN in state');
    }
    ok(guard > 0, `fuzz seed ${seed} terminated`);
    ok(st.status === 'over', `fuzz seed ${seed} ended cleanly (${st.reason})`);
  }
}

// --- content validation -------------------------------------------------------
section('content');
{
  ok(JOURNEY_STAGES.length === 40, '40 journey stages');
  ok(CHALLENGES.length >= 5, 'challenges present');
  ok(LESSONS.length === 5, 'five lessons');
  ok(ACHIEVEMENTS.length >= 5, 'achievement set declared');
  ok(Object.keys(THEMES).length === 5, 'five themes');
  ok(JOURNEY_STAGES.some(s => s.mastery), 'mastery stages present');
  const d1 = dailyInfo(new Date(Date.UTC(2026, 5, 10)));
  const d2 = dailyInfo(new Date(Date.UTC(2026, 5, 10)));
  const d3 = dailyInfo(new Date(Date.UTC(2026, 5, 11)));
  ok(d1.seed === d2.seed && d1.seed !== d3.seed, 'daily seed stable per UTC day');
  console.log('validating all content with reference bot (this can take a moment)...');
  const problems = validateContent();
  for (const p of problems) console.error('  content problem:', p);
  ok(problems.length === 0, 'all content passes offline validators');
}

// --- golden sessions ----------------------------------------------------------
section('golden sessions');
{
  const gold = (seed, config, policy, name, expectReason) => {
    const st = createInitialState(seed, config);
    let guard = 30 * 30 * 10;
    while (st.status === 'active' && guard-- > 0) step(st, policy(st));
    ok(st.reason === expectReason, `${name}: reason=${st.reason} score=${totalScore(st)} ticks=${st.tick}`);
  };
  gold(11, { goal: { type: 'distance', value: 800 }, speedScale: 0.6 }, referenceBotAction, 'easy', 'goal');
  gold(22, { goal: { type: 'distance', value: 2500 }, speedScale: 1.0 }, referenceBotAction, 'medium', 'goal');
  gold(33, { goal: { type: 'distance', value: 4000 }, speedScale: 1.3 }, referenceBotAction, 'hard', 'goal');
  // interrupted/resumed: serialize mid-run, resume, same outcome
  const st = createInitialState(44, { goal: { type: 'distance', value: 1500 }, speedScale: 0.8 });
  for (let i = 0; i < 100; i++) step(st, referenceBotAction(st));
  const restored = deserialize(serialize(st));
  while (restored.status === 'active') step(restored, referenceBotAction(restored));
  while (st.status === 'active') step(st, referenceBotAction(st));
  ok(stateHash(st) === stateHash(restored), 'interrupted/resumed session identical');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
