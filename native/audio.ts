// Sound, as the browser build's js/audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per game event — lane switch, jump,
// slide, token, near miss, rejected move, crash, objective, the countdown
// beeps and the go signal, UI taps, achievement, rewind, personal best — the
// quiet ambience bed (white noise lowpassed at 400 Hz, looped) and the
// adaptive music loop (a bass pulse on beats 1 and 5 of 8 at 150 ms steps,
// an arpeggio of seeded A-minor-pentatonic notes on even steps from
// intensity 0.15 and on every step from 0.6, a hi-hat tick from 0.45; the
// intensity follows the run's speed). The browser build ran the ambience and
// the music live (a noise loop and oscillators on an interval); here they are
// rendered once into clips (createClip, a slice a frame) and looped on the
// music bus, each music layer's level set by the intensity (the runtime has no
// ambience bus: the bed's gain folds in the old ambience slider's 50 % against
// music's 70 %). The runtime's Options own the volumes and the voice limit;
// the top bar's ♪ button mutes the game's sound for the session, as before.
// UI taps play on the "interface" bus, the rest on "effects". The oscillator
// blips the browser build synthesized while a sample decoded are not ported
// (a live synthesis graph makes clip loads fail on the engine's web runtime),
// so a clip still loading is silent. Clips load once the mixer runs (natively
// at once, in a browser after the first press), one at a time.
import { context, createClip, loadClip, play as playClip, type AudioClip, type Sound } from "starhermit:audio";

const SFX_BY_EVENT: Record<string, string> = {
  lane: "lane-switch", jump: "jump", slide: "slide", coin: "token-pickup", dodge: "near-miss", invalid: "invalid-move", crash: "crash",
  goal: "goal-reached", countdown: "countdown-beep", go: "go-signal", ui: "ui-tap", achievement: "achievement", rewind: "rewind", best: "personal-best",
};
const clips = new Map<string, AudioClip>();
const queue: string[] = [];
let loading = false;
let wantClips = false;
let suspended = false;
let muted = false;

/** Asks for the clips; they load once the mixer runs (see update). */
export function loadSfx(): void { wantClips = true; }

/** audio.js event(type): the event's authored clip. */
export function event(type: string): void {
  if (suspended || muted) return;
  const file = SFX_BY_EVENT[type];
  if (!file) return;
  const clip = clips.get(file);
  if (!clip) return;
  try { playClip(clip, { bus: type === "ui" ? "interface" : "effects" }); }
  catch { clips.delete(file); if (!queue.includes(file)) queue.push(file); } // a clip the mixer lost: load it again
}

// -- the rendered loops ----------------------------------------------------------------------
const RATE = 22050;
let seed = 0x3a7;
function rnd(): number {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
/** audio.js _tone's envelope: 5 ms linear attack, exponential fall to 0.0001 by `dur`. */
function env(t: number, dur: number, gain: number): number {
  if (t < 0 || t > dur) return 0;
  if (t < 0.005) return (gain * t) / 0.005;
  return gain * Math.pow(0.0001 / gain, (t - 0.005) / Math.max(0.001, dur - 0.005));
}
const tri = (ph: number): number => (ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph);
const sq = (ph: number): number => (ph < 0.5 ? 1 : -1);

// The ambience: a 2 s noise loop through a one-pole 400 Hz lowpass, run twice so it joins without a click.
const AMB_N = RATE * 2;
const amb = new Float32Array(AMB_N);
let ambPos = 0, ambY = 0;
function renderAmbience(count: number): boolean {
  const k = 1 - Math.exp((-2 * Math.PI * 400) / RATE);
  const end = Math.min(2 * AMB_N, ambPos + count);
  for (; ambPos < end; ambPos++) {
    const i = ambPos % AMB_N;
    if (ambPos < AMB_N) amb[i] = rnd() * 2 - 1;
    ambY += k * (amb[i]! - ambY);
    if (ambPos >= AMB_N) amb[i] = ambY;
  }
  return ambPos >= 2 * AMB_N;
}

// The music: 32 steps of 150 ms (4.8 s), one array a layer.
const STEP = 0.15, STEPS = 32, MUS_N = Math.round(RATE * STEP * STEPS);
const SCALE = [0, 3, 5, 7, 10, 12, 15];
const ROOT = 110;
const ARP_GAIN = 0.1, HAT_GAIN = 0.08;
const notes = Array.from({ length: STEPS }, () => SCALE[Math.floor(rnd() * SCALE.length)]!);
const layers = { bass: new Float32Array(MUS_N), even: new Float32Array(MUS_N), odd: new Float32Array(MUS_N), hat: new Float32Array(MUS_N) };
const hatNoise = new Float32Array(Math.round(RATE * 0.04) + 1).map(() => rnd() * 2 - 1);
let musPos = 0;
function renderMusic(count: number): boolean {
  const end = Math.min(MUS_N, musPos + count);
  for (; musPos < end; musPos++) {
    const t = musPos / RATE;
    let bass = 0, even = 0, odd = 0, hat = 0;
    // a step's tone still sounding from the step before (the bass rings 220 ms) wraps round the loop
    for (const back of [0, 1, 2]) {
      const s = (Math.floor(t / STEP) - back + STEPS) % STEPS;
      const local = t - Math.floor(t / STEP) * STEP + back * STEP;
      const beat = s % 8;
      if (beat === 0 || beat === 4) bass += tri(((local * ROOT) / 2) % 1) * env(local, 0.22, 0.2);
      const f = ROOT * Math.pow(2, notes[s]! / 12) * 2;
      const a = sq((local * f) % 1) * env(local, 0.12, ARP_GAIN);
      if (beat % 2 === 0) even += a; else odd += a;
      if (back === 0) {
        const i = Math.floor(local * RATE);
        if (i < hatNoise.length) hat += hatNoise[i]! * env(local, 0.04, HAT_GAIN);
      }
    }
    layers.bass[musPos] = bass; layers.even[musPos] = even; layers.odd[musPos] = odd; layers.hat[musPos] = hat;
  }
  if (musPos >= MUS_N) {
    // a one-pole highpass at 6 kHz on the hat layer (audio.js _noise highpass)
    const k = Math.exp((-2 * Math.PI * 6000) / RATE);
    let px = 0, py = 0;
    for (let i = 0; i < MUS_N; i++) { const x = layers.hat[i]!; py = k * (py + x - px); px = x; layers.hat[i] = py; }
    return true;
  }
  return false;
}

let ambClip: AudioClip | null = null;
const music: Record<keyof typeof layers, AudioClip | null> = { bass: null, even: null, odd: null, hat: null };
let ambVoice: Sound | null = null;
let musicVoices: Record<keyof typeof layers, Sound> | null = null;
let musicOn = false;
let intensity = 0;

/** audio.js setIntensity: 0..1, from the run's speed. */
export function setIntensity(v: number): void { intensity = Math.max(0, Math.min(1, v)); }
export function startMusic(): void { musicOn = true; }
export function stopMusic(): void { musicOn = false; }
/** Pause and a hidden window: everything quiet (audio.js suspend / resume). */
export function setSuspended(on: boolean): void { suspended = on; }
/** The top bar's ♪ toggle (audio.js setMuted). */
export function setMuted(on: boolean): void { muted = on; }
export function isMuted(): boolean { return muted; }

function levels(): Record<keyof typeof layers, number> {
  const on = musicOn && !suspended && !muted;
  const arp = (0.05 + intensity * 0.05) / ARP_GAIN;
  return {
    bass: on ? 1 : 0,
    even: on && intensity > 0.15 ? arp : 0,
    odd: on && intensity > 0.6 ? arp : 0,
    hat: on && intensity > 0.45 ? (0.04 + intensity * 0.04) / HAT_GAIN : 0,
  };
}

/** Each frame: the clips once the mixer runs (one at a time), then the loops, then their levels. */
export function update(): void {
  if (context.state !== "running") return;
  if (wantClips) {
    wantClips = false;
    for (const n of Object.values(SFX_BY_EVENT)) if (!queue.includes(n)) queue.push(n);
  }
  if (!loading && queue.length) {
    const name = queue.shift()!;
    if (!clips.has(name)) {
      loading = true;
      loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); loading = false; }, (e: unknown) => { console.warn(`sfx ${name}: ${String(e)}`); loading = false; });
    }
    return;
  }
  if (loading) return;
  if (!ambClip) {
    if (!renderAmbience(8000)) return;
    try { ambClip = createClip([amb], RATE); } catch (e) { console.warn(`audio: ${String(e)}`); ambPos = 0; }
    return;
  }
  if (!ambVoice) {
    try { ambVoice = playClip(ambClip, { bus: "music", gain: 0, loop: true }); } catch { ambVoice = null; }
    return;
  }
  if (!music.hat) {
    if (!renderMusic(6000)) return;
    for (const k of Object.keys(layers) as (keyof typeof layers)[]) {
      try { music[k] = createClip([layers[k]], RATE); } catch (e) { console.warn(`audio: ${String(e)}`); }
    }
    return;
  }
  if (!musicVoices) {
    // all four layers start together (one frame) so they stay in step
    try {
      musicVoices = {
        bass: playClip(music.bass!, { bus: "music", gain: 0, loop: true }), even: playClip(music.even!, { bus: "music", gain: 0, loop: true }),
        odd: playClip(music.odd!, { bus: "music", gain: 0, loop: true }), hat: playClip(music.hat!, { bus: "music", gain: 0, loop: true }),
      };
    } catch { musicVoices = null; }
    return;
  }
  try {
    ambVoice.fade(suspended || muted ? 0 : 0.043, 0.15);
    const lv = levels();
    for (const k of Object.keys(lv) as (keyof typeof layers)[]) musicVoices[k].fade(lv[k], 0.12);
  } catch { /* the mixer restarted */ }
}
