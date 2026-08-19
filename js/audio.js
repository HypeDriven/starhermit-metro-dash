// Procedural WebAudio: buses (music / effects / ambience / voice), short
// original transients tied to logical events, quiet ambience, and an adaptive
// music loop whose intensity follows run speed. Pitch variants are seeded per
// run for replay consistency. Everything degrades silently if audio is
// unavailable or not yet unlocked by a user gesture.

import { Rng } from './rng.js';

export class AudioEngine {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.buses = {};
    this.unlocked = false;
    this.rng = new Rng(1);
    this.musicOn = false;
    this.musicTimer = null;
    this.intensity = 0;
    this._musicStep = 0;
  }

  unlock() {
    if (this.unlocked) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      const master = this.ctx.createGain();
      master.gain.value = 1;
      master.connect(this.ctx.destination);
      this.master = master;
      for (const name of ['music', 'effects', 'ambience', 'voice']) {
        const g = this.ctx.createGain();
        g.gain.value = this.settings[name] ?? 0.5;
        g.connect(master);
        this.buses[name] = g;
      }
      this.unlocked = true;
      this._startAmbience();
      if (this.musicOn) this._startMusic();
    } catch {
      /* audio unavailable — game remains fully playable */
    }
  }

  setVolume(bus, value) {
    this.settings[bus] = value;
    if (this.buses[bus]) this.buses[bus].gain.value = value;
  }

  setSeed(seed) {
    this.rng = new Rng(seed ^ 0x5f3759df);
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }
  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  // --- primitives ------------------------------------------------------------

  _tone({ bus = 'effects', freq = 440, freq2 = null, dur = 0.12, type = 'square', gain = 0.2, attack = 0.005 }) {
    if (!this.unlocked) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freq2) osc.frequency.exponentialRampToValueAtTime(freq2, t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.buses[bus]);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  _noise({ bus = 'effects', dur = 0.2, gain = 0.2, freq = 1200, q = 1, type = 'bandpass' }) {
    if (!this.unlocked) return;
    const t0 = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = this.rng.next() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(this.buses[bus]);
    src.start(t0);
  }

  // --- event mapping -----------------------------------------------------------

  event(type) {
    if (!this.unlocked) return;
    const jitter = 1 + (this.rng.next() - 0.5) * 0.12;
    switch (type) {
      case 'lane':
        this._tone({ freq: 300 * jitter, freq2: 420 * jitter, dur: 0.07, type: 'triangle', gain: 0.15 });
        break;
      case 'jump':
        this._tone({ freq: 280 * jitter, freq2: 620 * jitter, dur: 0.18, type: 'square', gain: 0.12 });
        break;
      case 'slide':
        this._noise({ dur: 0.22, gain: 0.14, freq: 900 * jitter, q: 0.8 });
        break;
      case 'coin':
        this._tone({ freq: 880 * jitter, dur: 0.07, type: 'sine', gain: 0.16 });
        this._tone({ freq: 1320 * jitter, dur: 0.12, type: 'sine', gain: 0.12 });
        break;
      case 'dodge':
        this._tone({ freq: 520 * jitter, freq2: 700 * jitter, dur: 0.05, type: 'triangle', gain: 0.07 });
        break;
      case 'invalid':
        this._tone({ freq: 160, dur: 0.09, type: 'sawtooth', gain: 0.1 });
        break;
      case 'crash':
        this._noise({ dur: 0.5, gain: 0.35, freq: 300, q: 0.4, type: 'lowpass' });
        this._tone({ freq: 140, freq2: 50, dur: 0.5, type: 'sawtooth', gain: 0.25 });
        break;
      case 'goal':
        for (let i = 0; i < 4; i++) {
          setTimeout(() => this._tone({ freq: [523, 659, 784, 1046][i], dur: 0.16, type: 'triangle', gain: 0.16 }), i * 90);
        }
        break;
      case 'countdown':
        this._tone({ freq: 440, dur: 0.1, type: 'sine', gain: 0.18, bus: 'voice' });
        break;
      case 'go':
        this._tone({ freq: 880, dur: 0.25, type: 'sine', gain: 0.2, bus: 'voice' });
        break;
      case 'ui':
        this._tone({ freq: 600, dur: 0.04, type: 'sine', gain: 0.08 });
        break;
      case 'achievement':
        this._tone({ freq: 784, dur: 0.12, type: 'sine', gain: 0.14 });
        setTimeout(() => this._tone({ freq: 1175, dur: 0.2, type: 'sine', gain: 0.14 }), 110);
        break;
    }
  }

  // --- ambience ----------------------------------------------------------------

  _startAmbience() {
    if (!this.unlocked || this._ambience) return;
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    const g = this.ctx.createGain();
    g.gain.value = 0.06;
    src.connect(filter).connect(g).connect(this.buses.ambience);
    src.start();
    this._ambience = src;
  }

  // --- adaptive music ----------------------------------------------------------
  // Two stems: a bass pulse and an arpeggio. Intensity (0..1, driven by run
  // speed) gates the arpeggio density and adds a hi-hat layer.

  startMusic() {
    this.musicOn = true;
    if (this.unlocked) this._startMusic();
  }

  stopMusic() {
    this.musicOn = false;
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  setIntensity(v) {
    this.intensity = Math.max(0, Math.min(1, v));
  }

  _startMusic() {
    if (this.musicTimer) return;
    const scale = [0, 3, 5, 7, 10, 12, 15];
    const root = 110; // A2
    this.musicTimer = setInterval(() => {
      if (!this.unlocked || !this.musicOn) return;
      const stepIdx = this._musicStep++;
      const beat = stepIdx % 8;
      if (beat === 0 || beat === 4) {
        this._tone({ bus: 'music', freq: root / 2, dur: 0.22, type: 'triangle', gain: 0.2 });
      }
      if (this.intensity > 0.15 && (beat % 2 === 0 || this.intensity > 0.6)) {
        const note = scale[Math.floor(this.rng.next() * scale.length)];
        const freq = root * Math.pow(2, note / 12) * 2;
        this._tone({ bus: 'music', freq, dur: 0.12, type: 'square', gain: 0.05 + this.intensity * 0.05 });
      }
      if (this.intensity > 0.45) {
        this._noise({ bus: 'music', dur: 0.04, gain: 0.04 + this.intensity * 0.04, freq: 6000, q: 1, type: 'highpass' });
      }
    }, 150);
  }
}
