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
// rendered once offline at start (OfflineAudioContext, one context a stem) and
// looped on the music bus, each music layer's level set by the intensity (the runtime has no
// ambience bus: the bed's gain folds in the old ambience slider's 50 % against
// music's 70 %). The runtime's Options own the volumes and the voice limit;
// the top bar's ♪ button mutes the game for the session (the engine's setMuted).
// UI taps play on the "interface" bus, the rest on "effects". The oscillator
// blips the browser build synthesized while a sample decoded are not ported
// (a live synthesis graph makes clip loads fail on the engine's web runtime),
// so a clip still loading is silent. Every clip loads at once in onStart; the
// rendered loops play once the mixer runs (natively at once, in a browser
// after the first press).
import { context, createClip, type GainNode, isMuted, loadClip, OfflineAudioContext, play as playClip, setMuted, type AudioClip, type Sound } from "starhermit:audio";
import { createRandom } from "starhermit:engine";

export { isMuted, setMuted };

const SFX_BY_EVENT: Record<string, string> = {
  lane: "lane-switch", jump: "jump", slide: "slide", coin: "token-pickup", dodge: "near-miss", invalid: "invalid-move", crash: "crash",
  goal: "goal-reached", countdown: "countdown-beep", go: "go-signal", ui: "ui-tap", achievement: "achievement", rewind: "rewind", best: "personal-best",
};
const clips = new Map<string, AudioClip>();
let suspended = false;

/** Loads every clip at once (onStart); a cue whose clip is still loading is skipped. */
export function loadSfx(): void {
  for (const name of new Set(Object.values(SFX_BY_EVENT))) {
    loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); }, (e: unknown) => console.warn(`sfx ${name}: ${String(e)}`));
  }
  renderLoops().catch((e: unknown) => console.warn(`audio: ${String(e)}`));
}

/** audio.js event(type): the event's authored clip. */
export function event(type: string): void {
  if (suspended) return;
  const file = SFX_BY_EVENT[type];
  if (!file) return;
  const clip = clips.get(file);
  if (!clip) return;
  try { playClip(clip, { bus: type === "ui" ? "interface" : "effects" }); }
  catch { /* the mixer is full this frame: skip it */ }
}

// -- the rendered loops ----------------------------------------------------------------------
const RATE = 22050;
const STEP = 0.15, STEPS = 32, LOOP = STEP * STEPS;
const SCALE = [0, 3, 5, 7, 10, 12, 15];
const ROOT = 110;
const ARP_GAIN = 0.1, HAT_GAIN = 0.08;
// Measured against the old script renders (rms): the band-limited square reads 1.5 dB under the old naive one; the biquad highpass 8.8 dB over the old one-pole.
const ARP_MAKEUP = 1.19, HAT_MAKEUP = 0.364;
const rng = createRandom(0x3a7, { algorithm: "mulberry32" });
const notes = Array.from({ length: STEPS }, () => SCALE[Math.floor(rng.float() * SCALE.length)]!);

/** audio.js _tone's envelope: 5 ms linear attack, exponential fall to 0.0001 by `dur`. */
function envelope(g: GainNode["gain"], t: number, dur: number, gain: number): void {
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(gain, t + 0.005);
  g.exponentialRampToValueAtTime(0.0001, t + dur);
  g.setValueAtTime(0, t + dur);
}
function tone(off: OfflineAudioContext, type: "triangle" | "square", freq: number, t: number, dur: number, gain: number): void {
  const osc = off.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const g = off.createGain();
  g.gain.value = 0;
  envelope(g.gain, t, dur, gain);
  osc.connect(g).connect(off.destination);
  osc.start(t);
  osc.stop(t + dur);
}
async function clipOf(off: OfflineAudioContext, skip = 0): Promise<AudioClip> {
  const r = await off.startRendering();
  return createClip([r.getChannelData(0).slice(skip)], RATE);
}
/** The ambience: a 2 s noise loop lowpassed at 400 Hz (periodic once the filter settles, so it joins without a click). */
function renderAmbience(): Promise<AudioClip> {
  const settle = Math.round(0.25 * RATE);
  const off = new OfflineAudioContext(1, settle + RATE * 2, RATE);
  const noise = off.createNoise({ seed: 0x3a7, seconds: 2 });
  const lp = off.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 400;
  noise.connect(lp).connect(off.destination);
  noise.start();
  return clipOf(off, settle);
}
/** The arpeggio's tones on even or odd beats of the 32 steps, or the bass on beats 1 and 5 of 8. */
function renderTones(pick: (beat: number) => boolean, tones: (off: OfflineAudioContext, step: number, t: number) => void): Promise<AudioClip> {
  const off = new OfflineAudioContext(1, Math.round(RATE * LOOP), RATE);
  for (let s = 0; s < STEPS; s++) if (pick(s % 8)) tones(off, s, s * STEP);
  return clipOf(off);
}
/** A 40 ms noise tick on every step, highpassed at 6 kHz (audio.js _noise highpass). */
function renderHat(): Promise<AudioClip> {
  const off = new OfflineAudioContext(1, Math.round(RATE * LOOP), RATE);
  const tick = off.createNoiseBuffer(0.04, "white", { seed: 0x3a8 });
  const hp = off.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 6000;
  const g = off.createGain();
  g.gain.value = 0;
  for (let s = 0; s < STEPS; s++) {
    const src = off.createBufferSource();
    src.buffer = tick;
    src.connect(hp);
    src.start(s * STEP);
    envelope(g.gain, s * STEP, 0.04, HAT_GAIN * HAT_MAKEUP);
  }
  hp.connect(g).connect(off.destination);
  return clipOf(off);
}

type Layer = "bass" | "even" | "odd" | "hat";
let ambClip: AudioClip | null = null;
let music: Record<Layer, AudioClip> | null = null;
let ambVoice: Sound | null = null;
let musicVoices: Record<Layer, Sound> | null = null;
let musicOn = false;
let intensity = 0;

async function renderLoops(): Promise<void> {
  const arp = (off: OfflineAudioContext, s: number, t: number): void => tone(off, "square", ROOT * Math.pow(2, notes[s]! / 12) * 2, t, 0.12, ARP_GAIN * ARP_MAKEUP);
  const [amb, bass, even, odd, hat] = await Promise.all([
    renderAmbience(),
    renderTones((beat) => beat === 0 || beat === 4, (off, _s, t) => tone(off, "triangle", ROOT / 2, t, 0.22, 0.2)),
    renderTones((beat) => beat % 2 === 0, arp),
    renderTones((beat) => beat % 2 === 1, arp),
    renderHat(),
  ]);
  ambClip = amb;
  music = { bass, even, odd, hat };
}

/** audio.js setIntensity: 0..1, from the run's speed. */
export function setIntensity(v: number): void { intensity = Math.max(0, Math.min(1, v)); }
export function startMusic(): void { musicOn = true; }
export function stopMusic(): void { musicOn = false; }
/** Pause and a hidden window: everything quiet (audio.js suspend / resume). */
export function setSuspended(on: boolean): void { suspended = on; }

function levels(): Record<Layer, number> {
  const on = musicOn && !suspended;
  const arp = (0.05 + intensity * 0.05) / ARP_GAIN;
  return {
    bass: on ? 1 : 0,
    even: on && intensity > 0.15 ? arp : 0,
    odd: on && intensity > 0.6 ? arp : 0,
    hat: on && intensity > 0.45 ? (0.04 + intensity * 0.04) / HAT_GAIN : 0,
  };
}

/** Each frame, once the mixer runs: the loops, then their levels. */
export function update(): void {
  if (context.state !== "running" || !ambClip || !music) return;
  if (!ambVoice) {
    try { ambVoice = playClip(ambClip, { bus: "music", gain: 0, loop: true }); } catch { ambVoice = null; }
    return;
  }
  if (!musicVoices) {
    // all four layers start together (one frame) so they stay in step
    try {
      musicVoices = {
        bass: playClip(music.bass, { bus: "music", gain: 0, loop: true }), even: playClip(music.even, { bus: "music", gain: 0, loop: true }),
        odd: playClip(music.odd, { bus: "music", gain: 0, loop: true }), hat: playClip(music.hat, { bus: "music", gain: 0, loop: true }),
      };
    } catch { musicVoices = null; }
    return;
  }
  try {
    ambVoice.fade(suspended ? 0 : 0.043, 0.15);
    const lv = levels();
    for (const k of Object.keys(lv) as Layer[]) musicVoices[k].fade(lv[k], 0.12);
  } catch { /* the mixer restarted */ }
}
