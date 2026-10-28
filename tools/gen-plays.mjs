// Writes the engine play scripts that drive whole runs through the real UI
// (tests/native/*.play): content.js's reference bot plays a stage with the
// browser build's rules (js/rules.js) and its commands become timed key
// lines, so the scripts replay the bot's runs exactly and check the final
// score on the results. Timing (measured on the 1.22.0 render check, which
// plays one fixed step a frame at the rules' 30 Hz): after `click =Start` the
// countdown takes 63 steps; a line after `frames F` that follows the click
// acts in the frame whose rules tick (before stepping) is F − 61, and a
// command pressed there is applied on that frame's step, as the bot's
// decision at that tick; every key line takes one frame and `frames N` takes
// N + 1. A repeated action on consecutive ticks alternates between its keys
// (a key held over two lines would be one press).
//   node tools/gen-plays.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInitialState, step, totalScore, isLegal, TICKS_PER_SECOND } from '../js/rules.js';
import { JOURNEY_STAGES, CHALLENGES, referenceBotAction } from '../js/content.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEYS = { left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], jump: ['ArrowUp', 'KeyW', 'Space'], slide: ['ArrowDown', 'KeyS'] };
const AFTER_START = -62; // the rules tick a line acts at when it directly follows `click =Start`

/** The bot's run: [{ tick, action }] (the pre-step tick it decided at) and the final state. */
export function plan(item, { from = 1, maxTicks = TICKS_PER_SECOND * 60 * 5 } = {}) {
  const state = createInitialState(item.seed, item.config);
  const cmds = [];
  while (state.status === 'active' && state.tick < maxTicks) {
    let a = referenceBotAction(state);
    if (a !== 'wait' && (state.tick < from || !isLegal(state, a))) a = 'wait';
    if (a !== 'wait') cmds.push({ tick: state.tick, action: a });
    step(state, a);
  }
  return { cmds, state };
}

/** Key lines for the commands, from the line after `click =Start`. */
export function lines(cmds) {
  const out = [];
  let c = AFTER_START;
  let last = null;
  for (const { tick, action } of cmds) {
    if (tick < c) throw new Error(`command at tick ${tick} before the script can press (${c})`);
    if (tick > c) out.push(`frames ${tick - c - 1}`);
    const keys = KEYS[action];
    const k = last && last.action === action && last.tick === tick - 1 ? keys[(keys.indexOf(last.key) + 1) % keys.length] : keys[0];
    out.push(`key ${k} 1`);
    last = { action, tick, key: k };
    c = tick + 1;
  }
  return out;
}
const fmt = (n) => Math.floor(n).toLocaleString('en-US');

function write(name, header, body) {
  writeFileSync(join(root, 'tests', 'native', name), header.map((l) => `# ${l}`).join('\n') + '\n' + body.join('\n') + '\n');
  console.log(`wrote tests/native/${name}`);
}

// Journey stage 1 to the objective, on a desktop window.
const j1 = plan(JOURNEY_STAGES[0]);
if (j1.state.reason !== 'goal') throw new Error('the bot does not finish Journey stage 1');
write('journey-1.play', [
  'Journey stage 1 played to its objective by content.js\'s reference bot (tools/gen-plays.mjs; generated: do not edit),',
  `the total checked on the results (${fmt(totalScore(j1.state))} points); then Next Stage opens stage 2's briefing, and the`,
  'Scores board and the Journey grid show the run.',
], [
  'until 300 Metro Dash', 'frames 30', 'click =Journey', 'until 60 mastery test', 'frames 10', 'click =Stage 1', 'until 60 Expected', 'frames 10',
  'save briefing', 'click =Start', ...lines(j1.cmds),
  'until 600 Stage Complete', 'frames 20', `expect Objective complete — ${fmt(totalScore(j1.state))} points`, 'save results',
  'click =Next Stage', 'until 60 Stage 2', 'frames 10', 'save stage-2-briefing', 'click =Back', 'until 60 How to Play', 'frames 10',
  'click =Scores', 'until 60 Local board', 'frames 10', `expect ${fmt(totalScore(j1.state))}`, 'save scores', 'click =Back', 'until 60 How to Play',
  'frames 10', 'click =Journey', 'until 60 mastery test', 'frames 20', 'expect ★', 'save journey-done',
]);

// The Express Service challenge (1.5× speed) in a phone held sideways.
const express = CHALLENGES.find((c) => c.id === 'ch-express');
const ex = plan(express);
if (ex.state.reason !== 'goal') throw new Error('the bot does not finish Express Service');
write('challenge-express-landscape.play', [
  'The Express Service challenge played to its objective by the reference bot in a phone held sideways',
  `(tools/gen-plays.mjs; generated: do not edit): ${fmt(totalScore(ex.state))} points on the results, then Retry and End Run from the pause panel.`,
  'viewport 844x390@3',
], [
  'until 300 Metro Dash', 'frames 30', 'click =Challenges', 'until 60 Constrained runs', 'frames 10', 'save challenges',
  'click =Express Service', 'until 60 Expected', 'frames 10', 'save briefing', 'click =Start', ...lines(ex.cmds),
  'until 900 Stage Complete', 'frames 20', `expect ${fmt(totalScore(ex.state))} points`, 'save results',
  'click =Retry', 'until 120 GO', 'frames 30', 'key Escape 1', 'until 60 End Run', 'frames 10', 'save paused', 'click =End Run',
  'until 60 Run Ended', 'frames 20', 'save ended', 'click =Menu', 'until 60 How to Play', 'frames 10',
]);
