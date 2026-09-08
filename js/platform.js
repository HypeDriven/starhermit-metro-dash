// Platform adapter: StarHermit host integration with full offline fallback.
// - launch token read from URL (never persisted)
// - server time sync via same-origin /api/v1/time with round-trip adjustment
// - presence heartbeats while actively playing (hosted only)
// - replay submission for daily validation (hosted only; local validation otherwise)
// - anonymous funnel events, consent-gated

export class Platform {
  constructor() {
    const params = new URLSearchParams(location.search);
    this.launchToken = params.get('launch') || null; // short-lived, memory only
    this.hosted = !!this.launchToken || params.get('hosted') === '1';
    this.timeOffsetMs = 0;
    this.consent = false;
    this.funnel = [];
    this._presenceTimer = null;
  }

  async init() {
    if (!this.hosted) return;
    try {
      const t0 = Date.now();
      const res = await fetch('/api/v1/time', { headers: this._headers() });
      if (!res.ok) return; // structured errors are recoverable: fall back to local time
      const body = await res.json();
      const t1 = Date.now();
      const serverMs = typeof body.now === 'number' ? body.now : Date.parse(body.now);
      this.timeOffsetMs = serverMs - (t0 + (t1 - t0) / 2);
    } catch {
      /* offline start: local clock */
    }
  }

  _headers() {
    return this.launchToken ? { Authorization: `Bearer ${this.launchToken}` } : {};
  }

  now() {
    return new Date(Date.now() + this.timeOffsetMs);
  }

  startPresence() {
    if (!this.hosted || this._presenceTimer) return;
    const beat = () => fetch('/api/v1/presence', { method: 'POST', headers: this._headers() }).catch(() => {});
    beat();
    this._presenceTimer = setInterval(beat, 30000);
  }

  stopPresence() {
    if (this._presenceTimer) clearInterval(this._presenceTimer);
    this._presenceTimer = null;
  }

  startActivity() {
    if (!this.hosted) return;
    fetch('/api/v1/activity/start', { method: 'POST', headers: this._headers() }).catch(() => {});
  }

  endActivity() {
    if (!this.hosted) return;
    fetch('/api/v1/activity/end', { method: 'POST', headers: this._headers() }).catch(() => {});
  }

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
      return await res.json();
    } catch {
      return null;
    }
  }

  /** Anonymous aggregate funnel event. No text, no pointers, no identity. */
  track(event, props = {}) {
    if (!this.consent) return;
    const entry = { e: event, p: props, t: Date.now() };
    this.funnel.push(entry);
    if (this.funnel.length > 200) this.funnel.shift();
    if (this.hosted) {
      fetch('/api/v1/telemetry', {
        method: 'POST',
        headers: { ...this._headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      }).catch(() => {});
    }
  }
}
