// Platform adapter: StarHermit host integration with full offline fallback.
// - launch token read ONCE from the URL fragment (#game_token=<jwt>, optional
//   &session_id=), then stripped via history.replaceState; query-param
//   fallbacks exist for local dev only
// - JWT payload decoded (sub, game_scope); Authorization: Bearer on every call
// - token refresh every 45 min via POST /api/v1/games/{slug}/launch-token
// - account nickname via GET /api/v1/users/{sub}/profile (never /api/v1/me,
//   never usernames); "Player "+id8 fallback
// - cloud save: ONE zip+base64 slot at /api/v1/me/cloud-saves/{gameKey},
//   2 s debounce + pagehide/visibilitychange flush, remote-preferred load;
//   localStorage stays the offline cache
// - daily replay validation stays on this game's own server.js backend,
//   with graceful fallback to the local board when it is unreachable
// - presence/activity/telemetry target the local dev server only (its
//   server.js implements them; the platform has no such per-game routes)

import { zipStore, unzipFirstEntry, bytesToBase64 } from './zip.js';

const REFRESH_MS = 45 * 60 * 1000;
const REFRESH_RETRY_MS = 60 * 1000;
const SAVE_DEBOUNCE_MS = 2000;
const MAX_SAVE_BYTES = 10 * 1024 * 1024;

function readLaunchToken() {
  // Fragment is the on-platform channel; read once, then strip it.
  if (location.hash) {
    const frag = new URLSearchParams(location.hash.slice(1));
    const token = frag.get('game_token');
    if (token) {
      try {
        history.replaceState(null, '', location.pathname + location.search);
      } catch { /* strip is best-effort */ }
      return token;
    }
  }
  // local dev fallbacks only
  const params = new URLSearchParams(location.search);
  return params.get('launch') || params.get('token');
}

function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return {};
  }
}

export class Platform {
  constructor() {
    this.launchToken = readLaunchToken(); // short-lived, memory only
    const payload = this.launchToken ? decodeJwtPayload(this.launchToken) : {};
    this.userId = typeof payload.sub === 'string' ? payload.sub : null; // never persisted
    this.gameKey = typeof payload.game_scope === 'string' ? payload.game_scope : null;
    this.hosted = !!this.launchToken;
    this.devServer = /^(localhost|127\.0\.0\.1|::1)$/.test(location.hostname);
    this.nickname = null;
    this.timeOffsetMs = 0;
    this.consent = false;
    this.funnel = [];
    this.syncState = 'offline'; // 'saving' | 'synced' | 'offline'
    this.getCloudDoc = null; // set by main.js: () => mirror doc
    this._presenceTimer = null;
    this._refreshTimer = null;
    this._saveTimer = null;
    this._cloudDirty = false;
    this._syncListeners = new Set();
  }

  async init() {
    if (!this.hosted) return null;
    await this._syncTime();
    await this._loadProfile();
    const remoteDoc = await this._pullCloudSave();
    this._scheduleTokenRefresh();
    return remoteDoc; // main.js applies it (remote-preferred), null = none/unreachable
  }

  _headers() {
    return this.launchToken ? { Authorization: `Bearer ${this.launchToken}` } : {};
  }

  now() {
    return new Date(Date.now() + this.timeOffsetMs);
  }

  // --- time -----------------------------------------------------------------

  async _syncTime() {
    try {
      const t0 = Date.now();
      const res = await fetch('/api/v1/time', { headers: this._headers() });
      if (!res.ok) return; // recoverable: fall back to local time
      const body = await res.json();
      const t1 = Date.now();
      const serverMs = typeof body.now === 'number' ? body.now : Date.parse(body.now);
      this.timeOffsetMs = serverMs - (t0 + (t1 - t0) / 2);
    } catch {
      /* offline start: local clock */
    }
  }

  // --- identity ----------------------------------------------------------------

  async _loadProfile() {
    if (!this.userId) return;
    try {
      const res = await fetch(`/api/v1/users/${encodeURIComponent(this.userId)}/profile`, {
        headers: this._headers(),
      });
      if (res.ok) {
        const body = await res.json();
        if (body && typeof body.nickname === 'string' && body.nickname) {
          this.nickname = body.nickname;
        }
      }
    } catch {
      /* offline: fall back below */
    }
    if (!this.nickname) this.nickname = 'Player ' + this.userId.slice(0, 8);
  }

  // --- token refresh -------------------------------------------------------------

  _scheduleTokenRefresh() {
    clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => this._refreshToken(), REFRESH_MS);
  }

  async _refreshToken() {
    let ok = false;
    if (this.gameKey) {
      try {
        const res = await fetch(`/api/v1/games/${encodeURIComponent(this.gameKey)}/launch-token`, {
          method: 'POST',
          headers: { ...this._headers(), 'Content-Type': 'application/json' },
        });
        if (res.ok) {
          const body = await res.json();
          const token = body && (body.token || body.launchToken || body.launch_token);
          if (typeof token === 'string' && token) {
            this.launchToken = token; // scoped tokens re-mint; swap in
            ok = true;
          }
        }
      } catch {
        ok = false;
      }
    }
    // success: next refresh in 45 min; failure: retry in ~60 s
    this._refreshTimer = setTimeout(() => this._refreshToken(), ok ? REFRESH_MS : REFRESH_RETRY_MS);
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

  async _pullCloudSave() {
    if (!this.hosted || !this.gameKey) return null;
    this._setSync('saving');
    try {
      const res = await fetch(`/api/v1/me/cloud-saves/${encodeURIComponent(this.gameKey)}`, {
        headers: this._headers(),
      });
      if (res.status === 404) { this._setSync('synced'); return null; } // no remote save yet
      if (!res.ok) throw new Error('cloud-load-' + res.status);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const doc = JSON.parse(new TextDecoder().decode(unzipFirstEntry(bytes)));
      this._setSync('synced');
      return doc;
    } catch {
      this._setSync('offline');
      return null; // local cache stands
    }
  }

  /** Call after any local doc write; debounces a cloud mirror PUT. */
  scheduleCloudSave() {
    if (!this.hosted || !this.gameKey || !this.getCloudDoc) return;
    this._cloudDirty = true;
    this._setSync('saving');
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.flushCloudSave(), SAVE_DEBOUNCE_MS);
  }

  async flushCloudSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    if (!this.hosted || !this.gameKey || !this.getCloudDoc || !this._cloudDirty) return;
    try {
      const doc = this.getCloudDoc();
      const body = { dataBase64: bytesToBase64(zipStore('save.json', new TextEncoder().encode(JSON.stringify(doc)))) };
      if (body.dataBase64.length * 3 / 4 > MAX_SAVE_BYTES) throw new Error('save-too-large');
      const res = await fetch(`/api/v1/me/cloud-saves/${encodeURIComponent(this.gameKey)}`, {
        method: 'PUT',
        headers: { ...this._headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('cloud-put-' + res.status);
      this._cloudDirty = false;
      this._setSync('synced');
    } catch {
      this._setSync('offline'); // retried on the next change / pagehide flush
    }
  }

  // --- daily validation (this game's own server.js backend) -------------------------

  /** Submit a daily replay for authoritative validation. Returns verdict or null. */
  async submitDaily(envelope, day) {
    if (!this.hosted) return null;
    try {
      const res = await fetch('/api/v1/daily/submit', {
        method: 'POST',
        headers: { ...this._headers(), 'Content-Type': 'application/json' },
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
    const beat = () => fetch('/api/v1/presence', { method: 'POST', headers: this._headers() }).catch(() => {});
    beat();
    this._presenceTimer = setInterval(beat, 30000);
  }

  stopPresence() {
    if (this._presenceTimer) clearInterval(this._presenceTimer);
    this._presenceTimer = null;
  }

  startActivity() {
    if (!this.hosted || !this.devServer) return;
    fetch('/api/v1/activity/start', { method: 'POST', headers: this._headers() }).catch(() => {});
  }

  endActivity() {
    if (!this.hosted || !this.devServer) return;
    fetch('/api/v1/activity/end', { method: 'POST', headers: this._headers() }).catch(() => {});
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
        headers: { ...this._headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      }).catch(() => {});
    }
  }
}
