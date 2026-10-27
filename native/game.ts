// The browser build's pure game modules, imported unchanged (allowJs) and
// typed here with the shapes this client reads: the deterministic rules
// (js/rules.js: state, legality, the 30 Hz step, collisions, scoring, hashing,
// replay envelopes and their check), the versioned content (js/content.js:
// the five themes, five lessons, 40 Journey stages, six challenges, the Daily,
// Practice, achievements and the reference bot), the session with its
// command queue, replay log, snapshots and checkpoints (js/session.js), the
// local stores' helpers (js/storage.js: achievement unlocks and the local runs
// board) and the save document with the game's options (js/save.js).
import * as RulesJs from "../js/rules.js";
import * as ContentJs from "../js/content.js";
import * as SessionJs from "../js/session.js";
import * as StorageJs from "../js/storage.js";
import * as SaveJs from "../js/save.js";

export type Action = "left" | "right" | "jump" | "slide" | "wait";
export interface Obstacle { id: number; z: number; lane: number; kind: "barrier" | "sign" | "block"; passed: boolean }
export interface Coin { id: number; z: number; lane: number; high: boolean; taken: boolean }
export interface Goal { type: "distance" | "coins" | "actions"; value: number; action?: string }
export interface Config {
  goal: Goal | null; speedScale: number; allowedActions: Action[]; movesLimit: number | null; noFullBlocks: boolean; script: unknown[] | null;
}
export interface State {
  version: number; seed: number; tick: number; distance: number; lane: number; jumpTicksLeft: number; slideTicksLeft: number;
  obstacles: Obstacle[]; coins: Coin[]; score: { distance: number; dodge: number; collect: number };
  stats: { jumps: number; slides: number; laneChanges: number; invalidActions: number; coins: number } & Record<string, number>;
  movesLeft: number | null; status: "active" | "over"; reason: "crash" | "goal" | "moves" | "quit" | null;
  crashedInto: { kind: string; lane: number } | null; config: Config;
}
export interface RulesEvent { type: string; kind?: string; lane?: number; reason?: string; action?: string }
export interface Theme { id: string; label: string; phaseOffset: number }
export interface Content {
  id: string; kind: "daily" | "journey" | "learn" | "practice" | "challenge" | "attract"; label?: string; briefing?: string;
  seed: number; theme?: string; config: Partial<Config>; index?: number; mastery?: boolean; introduces?: string[];
  par?: { score?: number; ticks?: number }; day?: string;
}
export interface Achievement { key: string; label: string; desc: string }
export interface RunResult {
  sessionId: string; contentId: string; contentKind: string; seed: number; reason: string; tick: number; score: number;
  components: { distance: number; dodge: number; collect: number }; stats: State["stats"]; distance: number; crashedKind: string | null; hash: string;
}
export interface Checkpoint { state: string; commandCount: number }
export interface Session {
  content: Content; state: State; modeKey: string; id: string; paused: boolean; keepCheckpoints?: boolean;
  accumulator: number; lastTime: number | null; stepMs: number; alpha: number; result?: RunResult;
  command(action: string): { accepted: boolean; reason?: string };
  pause(): void; resume(): void; quit(): void;
  update(nowMs: number): RulesEvent[];
  snapshot(): Checkpoint; restoreCheckpoint(cp: Checkpoint): void;
  saveSnapshot(): void; clearSnapshot(): void;
}
export interface Hooks {
  onEvents?: (events: RulesEvent[], state: State) => void;
  onEnd?: (result: RunResult, envelope: unknown, state: State) => void;
}
export interface Entry {
  name: string; mine?: boolean; score: number; distance: number; ticks: number; invalid: number; mode: string; day: string | null;
  seed: number; ruleset: string; assists: string; sessionId: string; when: number;
}
export interface Progression {
  journeyCompleted: Record<string, { score: number; ticks?: number }>; lessonsCompleted: Record<string, boolean>;
  challengesCompleted: Record<string, { score: number }>; totalDistance: number; totalRuns: number; dailyDays: string[]; bestDaily: Record<string, number>;
}
export interface SaveDoc { v: number; progression: Progression; achievements: { unlocked: Record<string, string> }; leaderboard: { entries: Entry[] } }
export interface Options { colorPalette: string; leftHanded: boolean; hints: boolean }

interface RulesApi {
  TICKS_PER_SECOND: number; LANE_WIDTH: number; JUMP_TICKS: number; SLIDE_TICKS: number; ACTIONS: Action[];
  speedAt(distance: number, config: Partial<Config>): number;
  jumpHeight(jumpTicksLeft: number): number;
  totalScore(state: State): number;
  createInitialState(seed: number, config: Partial<Config>): State;
  step(state: State, command: string): RulesEvent[];
  validateReplay(envelope: unknown): { ok: boolean; score: number };
}
interface ContentApi {
  THEMES: Record<string, Theme>; THEME_IDS: string[];
  LESSONS: Content[]; JOURNEY_STAGES: Content[]; CHALLENGES: Content[]; ACHIEVEMENTS: Achievement[];
  dailyInfo(date?: Date): Content & { day: string };
  practiceConfig(difficulty: string): Omit<Content, "seed">;
  referenceBotAction(state: State): Action;
}
interface SessionCtor {
  new (content: Content, hooks?: Hooks): Session;
  restore(modeKey: string, content: Content, hooks: Hooks): Session | null;
}
interface StorageApi {
  unlockAchievement(store: { unlocked: Record<string, string> }, key: string): boolean;
  addLeaderboardEntry(board: { entries: Entry[] }, entry: Entry): unknown;
}
interface SaveApi {
  SCHEMA: number; PALETTES: string[]; DEFAULT_OPTIONS: Options; OPTION_KEYS: (keyof Options)[]; BROWSER_KEYS: string[];
  normalize(raw: unknown): SaveDoc;
  merge(local: unknown, remote: unknown): SaveDoc;
  same(a: unknown, b: unknown): boolean;
  readForeign(text: string | null): SaveDoc | null;
  pickOptions(raw: unknown): Partial<Options>;
}

export const Rules = RulesJs as unknown as RulesApi;
export const Content = ContentJs as unknown as ContentApi;
export const RunSession = (SessionJs as unknown as { RunSession: SessionCtor }).RunSession;
export const Store = StorageJs as unknown as StorageApi;
export const Save = SaveJs as unknown as SaveApi;
