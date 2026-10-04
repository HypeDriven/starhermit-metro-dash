// Platform adapter: StarHermit host integration over the shared SDK
// (window.StarHermit from starhermit-sdk.js), with full offline fallback.
// - the SDK reads the launch token once (#game_token= / #access_token=),
//   strips it, renews it and signs out when renewal is refused
// - account nickname via the profile route (never /api/v1/me, never usernames)
// - cloud save: the game:<slug> slot, 2 s debounce + keepalive flush on
//   pagehide / hidden tab, remote-preferred load; localStorage stays the cache
// - settings KV mirror (changed keys only) and key bindings via controls
// - sign-in button / invite link
// - daily replay validation, server time, presence/activity/telemetry target
//   this game's own server.js on localhost only (the platform has no such
//   per-game routes, so they are never requested on StarHermit)

const SAVE_DEBOUNCE_MS = 2000;
const SETTINGS_DEBOUNCE_MS = 1500;

export class Platform {
  /** opts.sh: SDK instance (default window.StarHermit); opts.hostname for tests. */
  constructor(opts = {}) {
    this.sh = opts.sh || globalThis.StarHermit;
    this.sh.init();
    const host = opts.hostname != null ? opts.hostname : (typeof location !== 'undefined' ? location.hostname : '');
    this.devServer = /^(localhost|127\.0\.0\.1|::1)$/.test(host);
    this.nickname = null;
    this.timeOffsetMs = 0;
    this.consent = false;
    this.funnel = [];
    this.syncState = 'offline'; // 'saving' | 'synced' | 'offline'
    this.getCloudDoc = null; // set by main.js: () => mirror doc
    this._presenceTimer = null;
    this._syncListeners = new Set();
    this._authListeners = new Set();
    this._lastSettings = null;
    this._pendingPatch = null;
    this._settingsTimer = null;
    this.sh.on('saved', (ok) => this._setSync(ok ? 'synced' : 'offline'));
    this.sh.on('auth', (a) => {
      if (!a.signedIn) { this.nickname = null; this._setSync('offline'); }
      for (const fn of this._authListeners) {
        try { fn(a); } catch { /* listener errors must not break auth handling */ }
      }
    });
  }

  get hosted() { return !!this.sh.signedIn; }
  get userId() { return this.sh.userId; }
  get gameKey() { return this.sh.slug; }

  async init() {
    if (!this.hosted) return null;
    if (this.devServer) await this._syncTime();
    const p = await this.sh.profile();
    this.nickname = p ? p.displayName : 'Player ' + String(this.userId).slice(0, 6);
    this._setSync('saving');
    const doc = await this.sh.loadJSON();
    this._setSync('synced');
    return doc; // main.js applies it (remote-preferred), null = none/unreachable
  }

  now() {
    return new Date(Date.now() + this.timeOffsetMs);
  }

  onAuth(fn) { this._authListeners.add(fn); }
  canSignIn() { return this.sh.canSignIn(); }
  signIn() { return this.sh.signIn(); }
  inviteLink() { return this.hosted ? this.sh.inviteLink() : null; }

  // --- time (own dev server only) ------------------------------------------------

  async _syncTime() {
    try {
      const t0 = Date.now();
      const res = await fetch('/api/v1/time');
      if (!res.ok) return; // recoverable: fall back to local time
      const body = await res.json();
      const t1 = Date.now();
      const serverMs = typeof body.now === 'number' ? body.now : Date.parse(body.now);
      if (Number.isFinite(serverMs)) this.timeOffsetMs = serverMs - (t0 + (t1 - t0) / 2);
    } catch {
      /* offline start: local clock */
    }
  }

  // --- cloud save -----------------------------------------------------------------

  onSyncChange(fn) {
    this._syncListeners.add(fn);
  }

  _setSync(state) {
    this.syncState = state;
    for (const fn of this._syncListeners) {
      try { fn(state); } catch { /* listener errors must not break sync */ }
    }
  }

  /** Call after any local doc write; debounces a cloud mirror PUT. */
  scheduleCloudSave() {
    if (!this.hosted || !this.getCloudDoc) return;
    this._setSync('saving');
    this.sh.saveJSON(this.getCloudDoc(), SAVE_DEBOUNCE_MS);
  }

  flushCloudSave() {
    if (!this.hosted) return Promise.resolve(false);
    this.flushSettings();
    return this.sh.flushSave(true);
  }

  // --- settings KV (key bindings travel via the controls API) ----------------------

  async loadSettings() {
    return this.hosted ? (await this.sh.getSettings()) || {} : {};
  }

  primeSettings(settings) { this._lastSettings = JSON.stringify(kvView(settings)); }

  pushSettings(settings) {
    if (!this.hosted || this._lastSettings === null) return;
    const obj = kvView(settings);
    const json = JSON.stringify(obj);
    if (json === this._lastSettings) return;
    const prev = JSON.parse(this._lastSettings);
    this._lastSettings = json;
    this._pendingPatch = this._pendingPatch || {};
    for (const k of Object.keys(obj)) {
      if (JSON.stringify(obj[k]) !== JSON.stringify(prev[k])) this._pendingPatch[k] = obj[k];
    }
    clearTimeout(this._settingsTimer);
    this._settingsTimer = setTimeout(() => this.flushSettings(), SETTINGS_DEBOUNCE_MS);
  }

  flushSettings() {
    clearTimeout(this._settingsTimer);
    this._settingsTimer = null;
    if (!this._pendingPatch || !this.hosted) return Promise.resolve(null);
    const patch = this._pendingPatch;
    this._pendingPatch = null;
    return this.sh.patchSettings(patch);
  }

  // --- controls ---------------------------------------------------------------------

  loadBindings(defaults) { return this.hosted ? this.sh.loadBindings(defaults) : Promise.resolve(defaults); }
  /** Persist the full binding map (a rebind may move a code between actions). */
  saveBindings(bindings) {
    if (!this.hosted) return Promise.resolve(null);
    return this.sh.setControls(bindings).catch(() => null);
  }
  resetBindings() { return this.hosted ? this.sh.resetControls() : Promise.resolve(null); }

  // --- daily validation (this game's own server.js backend, localhost only) ---------

  /** Submit a daily replay for authoritative validation. Returns verdict or null. */
  async submitDaily(envelope, day) {
    if (!this.hosted || !this.devServer) return null;
    try {
      const res = await fetch('/api/v1/daily/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ envelope, day }),
      });
      if (res.status === 429) return { ok: false, error: 'rate-limited' };
      if (!res.ok) return null; // board unavailable: local records stand
      return await res.json();
    } catch {
      return null;
    }
  }

  // --- dev-server-only endpoints (implemented by server.js, absent on-platform) -----

  startPresence() {
    if (!this.hosted || !this.devServer || this._presenceTimer) return;
    const beat = () => fetch('/api/v1/presence', { method: 'POST' }).catch(() => {});
    beat();
    this._presenceTimer = setInterval(beat, 30000);
  }

  stopPresence() {
    if (this._presenceTimer) clearInterval(this._presenceTimer);
    this._presenceTimer = null;
  }

  startActivity() {
    if (!this.hosted || !this.devServer) return;
    fetch('/api/v1/activity/start', { method: 'POST' }).catch(() => {});
  }

  endActivity() {
    if (!this.hosted || !this.devServer) return;
    fetch('/api/v1/activity/end', { method: 'POST' }).catch(() => {});
  }

  /** Anonymous aggregate funnel event. No text, no pointers, no identity. */
  track(event, props = {}) {
    if (!this.consent) return;
    const entry = { e: event, p: props, t: Date.now() };
    this.funnel.push(entry);
    if (this.funnel.length > 200) this.funnel.shift();
    if (this.hosted && this.devServer) {
      fetch('/api/v1/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      }).catch(() => {});
    }
  }
}

function kvView(settings) {
  const o = { ...settings };
  delete o.bindings;
  return o;
}
