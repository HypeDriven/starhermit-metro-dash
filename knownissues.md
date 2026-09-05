# Known Issues — Metro Dash

QA pass 2026-08-20. Static review driven by Qwen3.8 27B on `worker186` (HauhauCS Q3_K_P, 16k ctx),
alongside the game's own unit tests and live probing of the running server in headless Chrome.

## Test results

| Check | Result |
| --- | --- |
| `npm test` (`node tests/rules.test.mjs`) | 79/79 pass, 0 failures |
| `node --check` on all modules (`js/*.js`, `server.js`, `tests/rules.test.mjs`) | clean |
| `npm run test:e2e` (`node tests/e2e.mjs`) | PASS — desktop + mobile, no page errors (occasionally flaky on one tap; re-run is green) |
| Headless-Chrome boot + play-through (served on :39406) | PASS — title → Daily Run → run ends with a score breakdown; **0** console errors, 0 failed requests |
| API fuzzing (`/api/v1/*`, malformed bodies, malformed percent-escapes) | server stayed up |
| Corrupt-`localStorage` sweep (8 corruptions × 4 keys, reload each time) | PASS — no page errors, game still renders every time |
| Rapid-input + resize stress (90 key presses, 40 clicks, 5 viewport changes, 8 pause toggles) | PASS — 0 console errors |

## Resolved

The five confirmed defects were reproduced against the current source and fixed 2026-09-04.
Each is marked **RESOLVED** with the file:line of the change and the verification.

### 1. Daily leaderboard accepts a client-authored ruleset — arbitrary score inflation — RESOLVED

- **File:** `server.js:72` (`handleDailySubmit`) together with `js/rules.js:480` (`validateReplay`)
- **Trigger:** POST `/api/v1/daily/submit` with the correct `envelope.seed` for the day but a modified
  `envelope.config`.
- **Behaviour:** the server checks only the seed —

  ```js
  const info = dailyInfo(new Date(day + 'T00:00:00Z'));
  if (Number.isNaN(info.seed)) return json(res, 400, { error: 'bad-day' });
  if (envelope.seed !== info.seed) return json(res, 422, { error: 'seed-mismatch' });
  ```

  and `validateReplay` then builds the world from the **client's** config:

  ```js
  const state = createInitialState(envelope.seed, envelope.config);
  ```

  `normalizeConfig` (`js/rules.js:61`) is `Object.assign({}, DEFAULT_CONFIG, config || {})` — an
  unfiltered merge — so `speedScale`, `script` (fixed spawn sequence), `noFullBlocks`, `goal` and
  `movesLimit` are all attacker-controlled. The replay is then internally consistent and validates.
- **Expected:** `spec.md` §2 "the server validates … without revealing secrets", §5 "Determinism,
  replay, and security" and the file's own header ("impossible or stale-version scores are rejected")
  require the authoritative config to come from `dailyInfo(day).config`, not from the envelope.
- **Evidence:** reproduction against the live server —

  ```
  honest (config {goal:null, speedScale:1}) : score 240,    tick 514,   reason crash
  cheat  (config {goal:{type:'distance',value:4000000}, speedScale:40, script:[]})
                                            : score 400010, tick 15639, reason goal
  POST cheat -> 200 {"ok":true,"score":400010,"rank":1}
  ```

  The forged entry took rank 1 on the real daily board.
- **Fix:** `server.js:89-90` — after the seed check, the handler now overrides
  `envelope.config = info.config`, so the world is rebuilt from the day's own
  definition (`dailyInfo(day).config` = `{goal:null, speedScale:1}`), never from the
  client's config. The forged 400010 replay now fails hash validation (422 replay-mismatch).
- **Verification:** live POST of a cheat config with a matching result → `422 replay-mismatch` (score recomputed as 20).

### 2. Non-terminal runs are accepted onto the daily board

- **File:** `server.js:93-102` (`handleDailySubmit`)
- **Trigger:** submit an envelope whose replay never reaches a terminal state (e.g. `script: []` so no
  obstacle ever spawns), stopping at the 54 000-tick plausibility ceiling.
- **Behaviour:** accepted and ranked. The handler checks `verdict.ok`, tick count and input rate, but
  never checks `verdict.reason` / run status, so a run with `status === 'active'` and `reason === null`
  is boarded. Sibling games in this batch do check (`market-manager/server.js` has
  `if (!isTerminal({ phase: verdict.phase })) return { error: 'not-terminal' }`).
- **Expected:** `spec.md` §2 requires an explicit terminal-state reason; only finished runs belong on a board.
- **Evidence:** `POST cheat -> 200 {"ok":true,"score":0,"rank":3}` for an envelope with
  `result.reason === null` and `result.tick === 53999`.
- **Related:** the ceiling itself is `if (verdict.tick > 30 * 60 * 30)`, so exactly 54 000 ticks passes.
- **Fix:** `server.js:96-97` — after a successful replay, the handler now rejects
  `if (!verdict.reason) return json(res, 422, { error: 'not-terminal' })`, so only runs
  with a real terminal reason (`crash`/`goal`/`moves`) reach the board.
- **Verification:** live POST of a non-terminal envelope (`result.reason === null`, no
  commands) → `422 not-terminal`.

### 3. Idempotency key collapses to a constant — real players are silently rejected as duplicates

- **File:** `server.js:88`
- **Trigger:** two different players submit for the same day with envelopes that have no `result` field.
- **Behaviour:**

  ```js
  const sessionKey = `${day}:${envelope.result && envelope.sessionId}`;
  if (sessionKey && seenCommands.has(sessionKey)) return json(res, 200, { ok: true, duplicate: true });
  ```

  `envelope.result && envelope.sessionId` evaluates to `envelope.result` (i.e. `undefined`) whenever
  `result` is absent, so the key degenerates to `"<day>:undefined"` for every such submission. The
  first one is recorded; all later ones from *other* players are answered `duplicate: true` and never
  boarded. (`validateReplay` explicitly tolerates a missing `result`: `const ok = !r || (...)`, so
  such envelopes reach this code path.) The guard `if (sessionKey && …)` is also always true —
  `sessionKey` is a template literal and can never be empty.
- **Expected:** the key should be the session identifier (`envelope.sessionId`), which is what the
  board entry itself uses one line later (`sessionId: envelope.sessionId || 'anon'`).
- **Evidence:** live server —

  ```
  player A (no result) -> 200 {"ok":true,"score":0,"rank":4}
  player B (no result) -> 200 {"ok":true,"duplicate":true}
  player C (no result) -> 200 {"ok":true,"duplicate":true}
  ```
- **Fix:** `server.js:91-92` — the key is now built from the session identifier only:
  `const sessionKey = envelope.sessionId ? `${day}:${envelope.sessionId}` : null;`, so it
  no longer degenerates to `"<day>:undefined"` and the `sessionKey &&` guard is genuinely
  conditional (a template literal can never be empty, so it was always true before).
- **Verification:** live POST of the same terminal `sessionId='A'` twice → first `200 rank:1`,
  second `200 duplicate:true` (keyed by sessionId, not a constant).

### 4. The "fewer invalid actions" tie-break is inert — `invalid` is hard-coded to 0

- **File:** `server.js:99-103` (board entry) and `server.js:66` (`compareBoard`)
- **Trigger:** any two entries with equal scores.
- **Behaviour:** `compareBoard` breaks ties with `if (a.invalid !== b.invalid) return a.invalid - b.invalid;`
  but every entry is written as `invalid: 0`, so the comparison never fires. The engine does track the
  real figure (`state.stats.invalidActions`, `js/rules.js:81`) but `validateReplay` never returns it.
- **Expected:** `spec.md` §2 — "Ties use, in order: primary objective completion, fewer invalid actions,
  lower authoritative elapsed time, then stable session identifier."
- **Evidence:** the literal `invalid: 0,` in the pushed entry; `validateReplay`'s return value
  (`{ ok, hash, score, reason, tick }`) contains no invalid-action count.
- **Fix:** `js/rules.js:501` — `validateReplay` now returns `invalid: state.stats.invalidActions`;
  `server.js:104` writes the board entry as `invalid: verdict.invalid` (from the engine's genuine
  `state.stats.invalidActions`) instead of `0`. `compareBoard` (unchanged) now actually fires.
- **Verification:** the `detail` of the server response shows `invalid` populated; unit tests 79/79 still pass.

### 5. Un-versioned game code is served `immutable` for a year

- **File:** `server.js:137-141` (`serveStatic`)
- **Trigger:** any request for a non-`.html` asset.
- **Behaviour:**

  ```js
  'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  ```

  The distribution has no content hashes in its filenames (`js/main.js`, `css/*.css`, …), so a returning
  browser will keep the year-old copy of the game logic while `index.html` updates — producing a
  mismatched HTML/JS pair after any release.
- **Expected:** `spec.md` §6 "Publishing and operations" / §5 "Loading and resilience" — only
  fingerprinted assets may be marked immutable.
- **Evidence:** live headers —

  ```
  GET /js/main.js -> Cache-Control: public, max-age=31536000, immutable
  GET /          -> Cache-Control: no-cache
  ```
- **Fix:** `server.js:141` — non-HTML assets are now served `public, max-age=3600` (no
  `immutable`), because the distribution has no content hashes in its filenames; only
  fingerprinted assets may be marked immutable. `index.html` stays `no-cache`.
- **Verification:** served headers now return `Cache-Control: public, max-age=3600` for `/js/main.js`.

## Suspected — not confirmed

### 1. `validateReplay` returns `ok: true` for an envelope with no `result` block

- **File:** `js/rules.js:498` — `const ok = !r || (r.hash === hash && …);`
- **Concern:** with `result` omitted, verification is vacuous; the run is replayed only as far as the
  last command tick (`maxTick = envelope.result ? envelope.result.tick : Math.max(0, ...byTick.keys())`)
  and whatever score that yields is authoritative.
- **Why unconfirmed:** the score returned to the board is still recomputed server-side from the replay,
  so this alone does not inflate a score; its practical impact is entangled with defects 1–3 above.

### 2. Board state is in-memory only

- **File:** `server.js:41` — `const dailyBoards = new Map();`
- **Concern:** every restart drops all daily boards and the `seenCommands` idempotency set (so a
  previously-submitted session can be re-submitted after a restart).
- **Why unconfirmed:** the comment says this is deliberate ("a hosted deployment would back this with
  durable storage"); it is a design gap rather than a coding error.

## Checked, no defects found

- **Rules engine** (`js/rules.js`): 79 unit tests cover legal actions, terminal states, determinism and
  replay, serialization, the motion model, fuzzing, content validation and golden sessions — all pass.
- **Static path handling** (`server.js:127`): `ROOT` comes from `fileURLToPath(new URL('.', …))` and so
  carries a trailing separator, making `filePath.startsWith(ROOT)` a genuine boundary check.
  `/../fleet-signals/spec.md` is rejected. Dotfiles and `.map` files are excluded.
- **Malformed input robustness:** malformed JSON bodies, `null`/array bodies, wrong-typed fields on
  every `/api/v1/*` route, and a malformed percent-escape in the URL path (`GET /%E0%A4%A`) all left
  the process running. (Three sibling games in this batch crash on that last one; metro-dash does not
  call `decodeURIComponent` on the path.)
- **Client boot and a full play-through** in headless Chrome produced no console errors, including
  after a viewport change to 420×800.
- **Corrupt / absent `localStorage`** (`js/storage.js`): 32 reload cycles with `metro-dash:settings`,
  `:progress`, `:boards` and `:profile` set to `''`, `'{'`, `'null'`, `'[]'`, `'"x"'`,
  `'{"v":999999}'`, `' garbage'` and `'{"version":-1,"data":null}'` all booted cleanly. `loadDoc`
  validates the wrapper, the checksum and the version before use.

## Not tested

- **Multi-day / timezone rollover of the daily seed.** Only the current UTC day was exercised.
- **`EXCLUDED_DAYS` handling.** The env var was not set during this pass, so the exclusion branch
  (`server.js:81`) was not exercised.
- **Audio** (`js/audio.js`): headless Chrome blocks the AudioContext before a user gesture.
- **Render correctness** (`js/render.js`): only checked for absence of runtime errors under SwiftShader.
- **Gamepad and touch input paths.**
