// Targeted verification: daily submit contract client<->server.
import { createGameServer } from '../server.js';
import {
  createInitialState, step, totalScore, stateHash, replayEnvelope,
} from '../js/rules.js';
import { dailyInfo } from '../js/content.js';

const server = await createGameServer(0);
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
};

// Build a genuine daily run (survive a while with a simple dodge policy, then crash)
const info = dailyInfo(new Date());
const state = createInitialState(info.seed, info.config);
const commands = [];
let guard = 30000;
while (state.status === 'active' && guard-- > 0) {
  // minimal survival: jump/slide/change lane when a threat is near
  let action = 'wait';
  const threat = state.obstacles
    .filter((o) => !o.passed && o.lane === state.lane && o.z >= state.distance)
    .sort((a, b) => a.z - b.z)[0];
  if (threat && threat.z - state.distance < 30) {
    if (threat.kind === 'barrier' && state.jumpTicksLeft === 0 && state.slideTicksLeft === 0) action = 'jump';
    else if (threat.kind === 'sign' && state.jumpTicksLeft === 0 && state.slideTicksLeft === 0) action = 'slide';
    else if (state.lane < 1) action = 'right';
    else action = 'left';
  }
  step(state, action);
  if (action !== 'wait') commands.push({ tick: state.tick, action, id: commands.length + 1 });
}
ok(state.status === 'over', 'genuine run terminated', `reason=${state.reason}`);

const envelope = replayEnvelope({
  seed: info.seed,
  config: info.config,
  commands,
  result: { tick: state.tick, hash: stateHash(state), score: totalScore(state), reason: state.reason },
});
envelope.sessionId = 'test-session-1';

const post = (body) => fetch(`${base}/api/v1/daily/submit`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

// 1. honest submission with the fixed {envelope, day} contract
let res = await post({ envelope, day: info.day });
ok(res.status === 200 && res.body.ok && typeof res.body.rank === 'number',
  'honest daily submission accepted', JSON.stringify(res.body));

// 2. idempotent resubmit (same sessionId)
res = await post({ envelope, day: info.day });
ok(res.status === 200 && res.body.duplicate === true, 'resubmission is idempotent', JSON.stringify(res.body));

// 3. malformed envelope (commands not an array) -> 400, not 500
res = await post({ envelope: { ...envelope, commands: 'nope' }, day: info.day });
ok(res.status === 400 && res.body.error === 'missing-fields', 'malformed commands -> 400', JSON.stringify(res.body));

// 4. implausible duration rejected before replay
const big = JSON.parse(JSON.stringify(envelope));
big.sessionId = 'test-session-2';
big.result.tick = 99999999;
res = await post({ envelope: big, day: info.day });
ok(res.status === 422 && res.body.error === 'implausible-duration', 'huge tick -> 422 before replay', JSON.stringify(res.body));

// 5. bare envelope without day (old client shape) still rejected cleanly
res = await post(envelope);
ok(res.status === 400, 'bare envelope without day -> 400', JSON.stringify(res.body));

// 6. forged config is discarded: server replays with the day's own config,
// so the score is identical to the honest run (no inflation possible)
const cheat = JSON.parse(JSON.stringify(envelope));
cheat.sessionId = 'test-session-3';
cheat.config = { goal: { type: 'distance', value: 1 }, speedScale: 40, script: [] };
res = await post({ envelope: cheat, day: info.day });
ok(res.status === 200 && res.body.score === totalScore(state),
  'forged config neutralized (score recomputed from day config)', JSON.stringify(res.body));

for (const tick of ['99999999', -1, 1.5]) {
  const bad = { ...envelope, sessionId: 'invalid-tick', result: { ...envelope.result, tick } };
  const r = await post({ envelope: bad, day: info.day });
  ok(r.status === 422, 'invalid tick rejected: ' + tick);
}
const missing = { ...envelope, result: undefined };
const missingRes = await post({ envelope: missing, day: info.day });
ok(missingRes.status === 400, 'missing terminal result rejected');
await new Promise(resolve => server.close(resolve));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
