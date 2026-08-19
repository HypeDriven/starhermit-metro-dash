// Session: runs a single game. Fixed 30 tps simulation with an accumulator,
// one queued command per tick (action ids prevent double commits), replay
// recording with periodic state hashes, pause/resume, and snapshot restore.
// Rendering consumes snapshots + interpolation alpha; only this module
// mutates rules state, and only through validated commands.

import {
  createInitialState, step, serialize, deserialize, stateHash, totalScore,
  quitRun, legalActionMap, TICKS_PER_SECOND, replayEnvelope,
} from './rules.js';
import { saveSnapshot, loadSnapshot, clearSnapshot, sessionId } from './storage.js';

let commandCounter = 0;

export class RunSession {
  /**
   * @param {object} content  content record {id, kind, seed, config, ...}
   * @param {object} hooks    {onEvents(events, state), onEnd(result), onTick(state)}
   */
  constructor(content, hooks = {}) {
    this.content = content;
    this.hooks = hooks;
    this.modeKey = content.kind + ':' + content.id;
    this.id = sessionId();
    this.state = createInitialState(content.seed, content.config);
    this.commands = []; // ordered input log for replay
    this.hashes = []; // periodic state hashes
    this.accumulator = 0;
    this.lastTime = null;
    this.paused = false;
    this.pendingCommand = null; // {action, id}
    this.stepMs = 1000 / TICKS_PER_SECOND;
    this.alpha = 0; // interpolation alpha for the renderer
  }

  static restore(modeKey, content, hooks) {
    const raw = loadSnapshot(modeKey);
    if (!raw) return null;
    try {
      const saved = JSON.parse(raw);
      if (saved.contentId !== content.id || saved.contentKind !== content.kind) return null;
      const s = new RunSession(content, hooks);
      s.state = deserialize(saved.state);
      s.commands = saved.commands || [];
      s.hashes = saved.hashes || [];
      s.id = saved.id || sessionId();
      return s;
    } catch {
      return null;
    }
  }

  saveSnapshot() {
    if (this.state.status !== 'active') return;
    saveSnapshot(this.modeKey, JSON.stringify({
      contentId: this.content.id,
      contentKind: this.content.kind,
      state: serialize(this.state),
      commands: this.commands,
      hashes: this.hashes,
      id: this.id,
    }));
  }

  clearSnapshot() {
    clearSnapshot(this.modeKey);
  }

  /** Queue a command for the next tick. Returns {accepted, reason}. */
  command(action) {
    if (this.state.status !== 'active') return { accepted: false, reason: 'run-over' };
    if (this.paused) return { accepted: false, reason: 'paused' };
    const legality = legalActionMap(this.state)[action];
    if (!legality) return { accepted: false, reason: 'unknown-action' };
    if (!legality.ok) return { accepted: false, reason: legality.reason };
    // one command per tick; a newer input replaces an unapplied queued one
    this.pendingCommand = { action, id: ++commandCounter };
    return { accepted: true };
  }

  legalActions() {
    return legalActionMap(this.state);
  }

  pause() {
    if (this.state.status === 'active') {
      this.paused = true;
      this._pausedAt = Date.now();
      this.saveSnapshot();
    }
  }

  /** Practice-mode undo: capture a rewind checkpoint. */
  snapshot() {
    return { state: serialize(this.state), commandCount: this.commands.length };
  }

  restoreCheckpoint(cp) {
    this.state = deserialize(cp.state);
    this.commands.length = cp.commandCount;
    this.pendingCommand = null;
    this.accumulator = 0;
    this._finished = false;
    this.paused = false;
    this.lastTime = null;
  }

  resume() {
    this.paused = false;
    this.lastTime = null; // avoid a giant accumulator step
  }

  quit() {
    quitRun(this.state);
    this.finish();
  }

  /** Advance wall-clock time; runs fixed sim steps. Returns events flushed. */
  update(nowMs) {
    if (this.paused || this.state.status !== 'active') {
      this.alpha = 1;
      return [];
    }
    if (this.lastTime === null) this.lastTime = nowMs;
    let dt = nowMs - this.lastTime;
    this.lastTime = nowMs;
    if (dt > 250) dt = 250; // background-tab guard: no death spirals
    this.accumulator += dt;
    const allEvents = [];
    let steps = 0;
    while (this.accumulator >= this.stepMs && this.state.status === 'active' && steps < 12) {
      this.accumulator -= this.stepMs;
      steps++;
      const action = this.pendingCommand ? this.pendingCommand.action : 'wait';
      const cmdId = this.pendingCommand ? this.pendingCommand.id : null;
      this.pendingCommand = null;
      const events = step(this.state, action);
      if (action !== 'wait') {
        this.commands.push({ tick: this.state.tick, action, id: cmdId });
      }
      if (this.state.tick % (TICKS_PER_SECOND * 10) === 0) {
        this.hashes.push({ tick: this.state.tick, hash: stateHash(this.state) });
      }
      for (const e of events) allEvents.push(e);
      if (this.hooks.onTick) this.hooks.onTick(this.state);
    }
    if (steps === 12) this.accumulator = 0; // shedding load, sim stays authoritative
    this.alpha = Math.min(1, this.accumulator / this.stepMs);
    if (allEvents.length && this.hooks.onEvents) this.hooks.onEvents(allEvents, this.state);
    if (this.state.status !== 'active') this.finish();
    return allEvents;
  }

  finish() {
    if (this._finished) return;
    this._finished = true;
    this.clearSnapshot();
    const result = {
      sessionId: this.id,
      contentId: this.content.id,
      contentKind: this.content.kind,
      seed: this.state.seed,
      reason: this.state.reason,
      tick: this.state.tick,
      score: totalScore(this.state),
      components: { ...this.state.score },
      stats: { ...this.state.stats },
      distance: Math.floor(this.state.distance),
      hash: stateHash(this.state),
    };
    this.result = result;
    this.envelope = replayEnvelope({
      seed: this.state.seed,
      config: this.state.config,
      commands: this.commands,
      result: { tick: result.tick, hash: result.hash, score: result.score, reason: result.reason },
    });
    if (this.hooks.onEnd) this.hooks.onEnd(result, this.envelope, this.state);
  }
}
