# Metro Dash — Game Design Document

Running spec. Present tense; everything below describes the game as it ships today. Anything
the design calls for but the code does not yet do is collected in **Design intent not yet
implemented** at the end.

---

## 1. Overview

**Pitch.** Three lanes of transit track, one courier on a hover-skate, and a city that rolls
from dawn to neon night while you read traffic at 6.4 units per tick and decide — left, right,
jump, or slide — one tick at a time.

| | |
|---|---|
| Genre | Three-lane endless runner with authored campaign content |
| Players | 1 (asynchronous competition via a shared daily seed) |
| Session length | 1–5 minutes per run; a journey stage is ~40–90 s |
| Platforms | Browser, desktop + mobile (portrait and landscape), gamepad-aware |
| Rendering | Three.js (`vendor/three.module.js`) with a full canvas-2D fallback renderer |
| Simulation | Deterministic 30 tps fixed-step engine, no DOM and no wall-clock inside the rules |
| Persistence | `localStorage`, versioned and checksummed, with an in-memory fallback |

### File map

| Path | Responsibility |
|---|---|
| `index.html` | The whole DOM: topbar, canvas host, HUD, ten screens, three overlays. |
| `css/style.css` | Palette tokens, screen layout, HUD rails, touch tray, responsive and a11y modes, key art. |
| `js/main.js` | Boot, host handshake, flow state machine, input (keyboard/touch/gamepad), frame loop, achievements, progression. |
| `js/rules.js` | Pure rules engine: state, legal actions, `step`, generation, scoring, serialize/hash, replay validation. |
| `js/content.js` | Themes, 5 lessons, 40 journey stages, 6 challenges, daily derivation, achievements, reference bot, content validator. |
| `js/session.js` | One run: fixed-step accumulator, command queue, replay log, periodic hashes, pause/snapshot/restore. |
| `js/render.js` | Three.js scene (city, lamps, obstacle pools, particles, day cycle, spring camera) + 2D fallback with the same interface. |
| `js/audio.js` | WebAudio engine: four buses, authored Opus one-shots with synth fallbacks, ambience bed, adaptive music. |
| `js/ui.js` | Screen router, HUD, results, scores, help, settings, key rebinding, live-region announcements. |
| `js/storage.js` | Versioned checksummed documents, typed stores, leaderboard insert and tie-break comparator. |
| `js/platform.js` | StarHermit adapter: launch token, time sync, presence, activity, daily submit, consent-gated telemetry. |
| `js/rng.js` | `fnv1a` and a mulberry32 `Rng` with `int`/`pick`/`chance`/`fork`/`clone`. |
| `server.js` | StarHermit authoritative script: static serving + `/api/v1/*`, replay-validated daily board. |
| `tests/rules.test.mjs` | `npm test` — rules, determinism, replay, serialization, content validation. |
| `tests/e2e.mjs` | `npm run test:e2e` — real-UI playthrough in headless Chrome, desktop + mobile. |
| `tests/daily-contract.mjs` | Client↔server daily-submit contract check against a live server. |
| `tests/browser_smoke.py` | Optional Python/Playwright smoke pass (needs the `playwright` module). |
| `sfx/` | 14 Opus clips + `manifest.txt` (canonical), `manifest.json` (generator input), `manifest.md`. |
| `assets/` | Generated images: title key art, results token emblem. |
| `starhermit.txt` | Platform manifest: name, launch, owner, server, cover. |

---

## 2. Vision and design pillars

**1. One tick, one decision — and you can always see it coming.**
Every obstacle is spawned at least `SPAWN_AHEAD = 700` units out and the minimum spacing
(`max(38, 90 - speed*6)`) never drops below reaction distance. *Rules in:* readable silhouettes,
generous spacing at speed, a pattern table where **every pattern leaves a survivable lane**.
*Rules out:* blind corners, off-screen spawns, reflex-only gotchas, obstacles that require
memorising a seed.

**2. The rules engine is the game; everything else is a view.**
`js/rules.js` imports nothing but `rng.js`, touches no DOM and no clock. Renderer, audio and
HUD read snapshots. *Rules in:* replayable runs, an authoritative server that re-runs the same
code, checkpoint rewind, a reference bot that proves every authored stage is finishable.
*Rules out:* physics tied to frame rate, animation-driven hitboxes, "feel" tweaks that live in
the renderer and quietly change outcomes.

**3. Three verbs, three threats, no ambiguity.**
Barrier→jump, sign→slide, kiosk→lane change. Each obstacle kind answers exactly one verb (plus
the universal answer, moving lanes). *Rules in:* teaching by construction, colour + shape +
height all encoding the same fact. *Rules out:* obstacles that are "sometimes" jumpable, timing
windows narrower than the 16-tick jump arc, hybrid threats.

**4. The city is the clock.**
The day cycle advances with *distance*, not with real time (`phase = (themeOffset + distance/24000) mod 1`).
How far you got is legible from the sky before you look at the score. *Rules in:* five authored
themes as phase offsets, emissive windows that bloom into night, sun colour that swings blue at
phase 0.6–0.9. *Rules out:* random skyboxes, weather that hides obstacles, effects that survive
Reduced Motion.

**5. Guest-first, offline-complete, host-better.**
Nothing requires a login. With a StarHermit launch token the game adds server time, presence,
activity pairing and an authoritative daily board. *Rules in:* every network call wrapped and
failure-tolerant. *Rules out:* gating content on connectivity, blocking a run on a fetch,
persisting the launch token.

---

## 3. Player experience

**Target player.** Someone who wants a run they can finish on a train platform, plus a reason
to come back tomorrow (the daily seed) and a ladder to climb when they want one (40 journey
stages, 6 challenges).

**First 60 seconds.**
1. Boot lands on the title over the key-art backdrop; the attract-mode backdrop drifts a live
   daily-seeded run behind the menu, so the game demonstrates itself before the first click.
2. Eight menu buttons, `Play Daily Run — YYYY-MM-DD` first and styled primary. Two of them —
   **Learn** and **How to Play** — teach: *Learn* is five scripted lessons that will not complete
   until you actually perform the mechanic (`goal: {type:'actions', action:'jump', value:3}`),
   and *How to Play* lists every binding, generated from the player's current bindings, plus the
   four rules (barrier/sign/kiosk/token).
3. Whatever you pick, the **briefing** screen states mode, objective, speed %, expected length,
   ranked status and any restriction *before* the run starts, and the run itself opens with a
   3-2-1-GO countdown so no input is lost.
4. Journey stage 1 carries `tutorial: true` and introduces one mechanic ("Barriers"); the setup
   screen names the new mechanic in a "New mechanic" row.

**Session shape.** Pick content → briefing → countdown → 30–120 s run → results breakdown
(distance / dodges / tokens / total, personal-best comparison, achievements) → Retry, Next Stage,
or Menu. Journey chains forward automatically: finishing stage *n* wires **Next Stage** to *n+1*.

**Emotional beat.** The one-frame gap between *seeing* a full-height kiosk drop into your lane
and *committing* to a side — and the `near-miss` whoosh plus +10 that confirms you read it right.

---

## 4. Core loop and rules contract

All of §4 is implemented in `js/rules.js` unless stated otherwise.

### 4.1 Board and entities

- Lanes are `[-1, 0, 1]`, `LANE_WIDTH = 6` world units apart. The player never leaves lane centres;
  lateral position is a render-only spring.
- The player has `PLAYER_DEPTH = 2`; obstacles have `OBSTACLE_DEPTH = 4`.
- Obstacles: `{id, z, lane, kind, passed}` with `kind ∈ {barrier, sign, block}`.
- Tokens ("coins"): `{id, z, lane, high, taken}`.
- State also carries `tick`, `distance`, `lane`, `jumpTicksLeft`, `slideTicksLeft`, `nextSpawnZ`,
  `nextId`, `rngState`, `score{distance,dodge,collect}`, `stats{jumps,slides,laneChanges,invalidActions,coins}`,
  `movesLeft`, `status`, `reason`, `crashedInto`, `config`.

### 4.2 Motion model

| Quantity | Formula | Source |
|---|---|---|
| Tick rate | 30 tps (`TICKS_PER_SECOND`) | `rules.js` |
| Speed | `min(6.4·s, 2.1·s + distance·0.00085·s)`, `s = config.speedScale` | `speedAt()` |
| Jump | 16 ticks, parabola `4·5.5·t·(1−t)`, `t = (16 − jumpTicksLeft)/16`, peak 5.5 at tick 8 | `jumpHeight()` |
| Slide | 18 ticks, no height change; the *state* of sliding is what clears a sign | `step()` |
| Barrier clearance | height ≥ 2.0 → cleared (true for roughly ticks 2–14 of the arc) | `BARRIER_CLEAR_HEIGHT` |
| High token | height ≥ 2.5 → collects a `high` token, below → collects a ground token | `COIN_HIGH_HEIGHT` |

A ground token and a high token in the same lane are therefore mutually exclusive on one pass:
jumping banks the high one and misses the low one.

### 4.3 Legal actions

`legalActions(state)` returns a verdict per action in `['left','right','jump','slide','wait']`:

| Action | Legal when | Rejection reason |
|---|---|---|
| `left` | `lane > -1` | `left-edge` |
| `right` | `lane < 1` | `right-edge` |
| `jump` | grounded (`jumpTicksLeft === 0 && slideTicksLeft === 0`) | `airborne` / `sliding` |
| `slide` | grounded | `sliding` / `airborne` |
| `wait` | always | — |
| any | present in `config.allowedActions` | `restricted` |
| any | `status === 'active'` | `run-over` |

Rejected commands never throw: they increment `stats.invalidActions`, emit an `invalid` event and
resolve as `wait`.

### 4.4 Resolution order (`step(state, command)`) — exact

1. Return immediately if the run is over. Unknown commands are counted invalid and coerced to `wait`.
2. `tick += 1`.
3. Apply the command if legal (lane change / start jump / start slide), decrement `movesLeft` for any
   non-`wait` accepted action, emit `lane` / `jump` / `slide`.
4. Advance motion: `distance += speedAt(prevDistance)`, then decrement `jumpTicksLeft` / `slideTicksLeft`,
   then read `height = jumpHeight(jumpTicksLeft)`.
5. **Obstacles.** For each un-passed obstacle, the swept interval `[z − 3, z + 3]` (half depths summed)
   is tested against `(prevDistance, distance]`. Fully behind → mark `passed`, `score.dodge += 10`,
   emit `dodge`. Overlapping and in the player's lane → barrier hits if `height < 2.0`, sign hits if
   `slideTicksLeft <= 0`, block always hits. A hit sets `status='over'`, `reason='crash'`, records
   `crashedInto`, finalises the score and returns.
6. **Tokens.** Un-taken tokens within ±2 units of the swept range and in the player's lane are collected
   if the height test matches their `high` flag: `stats.coins += 1`, `score.collect += 25`, emit `coin`.
   Tokens left behind are retired without scoring.
7. **Housekeeping.** Drop passed/taken entities more than `DESPAWN_BEHIND = 40` units back; run
   `ensureSpawned` from the stored generator cursor; write the cursor back to `rngState`.
8. **Goal check**, then **move-budget check** (see §4.6).

Obstacle resolution precedes token collection, so a crash and a pickup on the same tick resolve as a
crash with no token.

### 4.5 Generation

`ensureSpawned` fills track until `distance + 700` using a distance-weighted pattern table
(`patternTable`), each entry returning the length it consumed; the next spawn point advances by
`max(minGap, used + rng.int(0,40))` with `minGap = max(38, 90 − speed·6)`.

| Pattern | Unlocks at distance | Weight | Shape |
|---|---|---|---|
| `single-barrier` | 0 | 10 | one barrier, random lane |
| `coin-line` | 0 | 7 | 5 ground tokens, 10 units apart |
| `gap` | 0 | 6 | empty breathing room |
| `single-sign` | 300 | 10 | one overhead sign |
| `coin-arc` | 400 | 6 | barrier at `z+20` with 5 tokens over it, the middle three `high` |
| `single-block` | 700 | 8 | one kiosk (suppressed by `noFullBlocks`) |
| `coin-snake` | 900 | 5 | 6 tokens weaving across lanes |
| `double-mixed` | 1200 | 9 | two lanes covered by barrier/sign, one lane free |
| `barrier-plus-sign` | 1800 | 7 | barrier + sign in two shuffled lanes, third free |
| `double-block` | 2200 | 6 | two kiosks, one free lane |

Lane shuffling uses Fisher-Yates over the run's stream (not a comparator sort) so results are identical
across JS engines. Scripted content (`config.script`) bypasses the generator entirely and emits its fixed
list once.

### 4.6 Terminal states

| `reason` | Trigger |
|---|---|
| `crash` | Same-lane obstacle not answered (§4.4 step 5). |
| `goal` | `config.goal` satisfied: `distance ≥ value`, `stats.coins ≥ value`, or `stats[action+'s'] ≥ value`. |
| `moves` | `config.movesLimit` exhausted (`movesLeft <= 0`). |
| `quit` | Player ends the run from the pause panel (`quitRun`). |

On any terminal transition `finalizeScore` sets `score.distance = floor(distance × 0.1)`.

### 4.7 Scoring

`totalScore = score.distance + score.dodge + score.collect`, where distance = `floor(distance × 0.1)`,
each cleanly passed obstacle = **10**, each token = **25**.

*Worked example.* A daily run ends by crashing at `distance = 2 437.4` having passed 18 obstacles and
collected 7 tokens: distance `floor(243.74) = 243`, dodges `18 × 10 = 180`, tokens `7 × 25 = 175`,
**total 598**. The results table shows exactly those three rows plus the total.

### 4.8 Ties, RNG and replay

- **Local board ties** (`storage.js compareEntries`) and **server board ties** (`server.js compareBoard`)
  both order by: score desc → fewer `invalidActions` → fewer ticks → stable session id.
- **RNG.** mulberry32 seeded by `fnv1a` of a stable string. Content seeds: `fnv1a('journey:v1:<n>')`,
  `fnv1a('challenge:<name>')`, `fnv1a('lesson:<name>')`, daily `fnv1a('metro-dash:daily:v1:<YYYY-MM-DD>')`.
  Practice uses `Math.random()` — it is unranked by design. The generator cursor lives in `state.rngState`,
  so a deserialized state resumes the identical stream. Decoration (city layout, particles) uses separate
  streams and never touches play.
- **Replay.** `replayEnvelope({seed, config, commands, result})` (schema 1) carries only non-`wait` commands
  with their tick. `validateReplay` re-runs them (first command per tick wins, duplicates dropped) and
  compares hash, score, reason and tick. `stateHash` is `fnv1a` over a canonically key-ordered serialization.
- **Undo/hints.** There is no undo in ranked play. Practice mode keeps up to four 5-second checkpoints
  and the pause panel exposes **Rewind 5s**, which restores the snapshot and truncates the command log.

---

## 5. Modes and progression

| Mode | Entry | Content | Goal | Ranked |
|---|---|---|---|---|
| **Daily Run** | `btn-play` | One shared UTC-day seed, theme = `seed mod 5` | none (endless) | Yes — local board scoped to the day, plus the server board when hosted |
| **Journey** | `btn-journey` | 40 authored stages, sequential unlock | distance | Local board |
| **Learn** | `btn-learn` | 5 scripted lessons | perform the mechanic | Local board |
| **Challenges** | `btn-challenge` | 6 constrained runs | distance or tokens | Local board |
| **Practice** | `btn-practice` | Relaxed / Standard / Intense, random seed | none | **No** — never boarded, rewind allowed |

**Journey curve** (`buildJourney`, `content.js`): for stage `i` (1…40), `tier = floor((i−1)/5)`,
`mastery = i % 5 === 0`, `speedScale = 0.6 + tier·0.09 + (mastery ? 0.05 : 0)` (0.60 → 1.28),
`goal.distance = 700 + i·90 + (mastery ? 300 : 0)` (790 → 4 600), theme cycles through the five themes by
tier. Mechanics arrive one at a time: barriers (1), overhead signs (6), kiosks (11), token routes (16),
express speed (21), rush-hour density (26), mixed traffic (31). Stars on the journey grid: `★★★` at or above
`par.score`, `★★` at ≥ 66 % of par, else `★`.

**Challenges.** Grounded (no jump, 1 600 units), Stay Upright (no slide, 1 600), Center Lock (jump/slide only,
kiosks suppressed, 1 200), Minimalist (30-move budget, 1 400), Express Service (`speedScale 1.5`, 2 000),
Token Rush (25 tokens). Each records a best score.

**Daily.** `dailyInfo(date)` derives id, seed, theme and label from the UTC date string; the config is fixed
at `{goal:null, speedScale:1}` and the server re-derives it rather than trusting the client. Playing on three
distinct days unlocks *Regular Commuter*.

**Achievements** (`ACHIEVEMENTS`, unlocked idempotently in `main.js checkAchievements`): First Arrival (finish
any run), Graduate (all five lessons), Mid-Line (journey 20), End of the Line (journey 40), Regular Commuter
(3 daily days), Long Haul (100 000 total units).

**Unlocks.** Journey stage *n* requires stage *n−1* completed; nothing else is gated. Progress lives in
`metro-dash:progression` and is resettable from Settings → Data.

---

## 6. Controls and interaction

| Action | Keyboard (default) | Touch | Gamepad |
|---|---|---|---|
| Left | `←` / `A` | swipe left, or `◀` tray button | D-pad left, stick X < −0.5 |
| Right | `→` / `D` | swipe right, or `▶` | D-pad right, stick X > 0.5 |
| Jump | `↑` / `W` / `Space` | swipe up, or `▲` | A, D-pad up, stick Y < −0.5 |
| Slide | `↓` / `S` | swipe down, or `▼` | B, D-pad down, stick Y > 0.5 |
| Pause / resume | `Esc` / `P` | `⏸` button | Start (button 9) |

- **Rebinding.** Settings → Accessibility & Controls: pick an action, press a key; the override is stored and
  the How to Play cards regenerate from it. Rebind capture runs before all other key handling.
- **Swipe thresholds** (`main.js setupInput`): pointer travel < 24 px is a tap and commits nothing; a gesture
  slower than 600 ms is discarded; the dominant axis decides the action.
- **Input locking.** Commands are only accepted in `gameState === 'active'`; `keydown` repeats are ignored;
  one command is queued per tick and a newer input replaces an unapplied one, so mashing cannot bank moves.
  Gamepad input is edge-triggered per frame.
- **Feedback for every input.** Accepted → sim event → sample/synth cue + renderer response. Rejected →
  `invalid-move` cue, `Not now: <reason>` in the live region, and no state change. Tray buttons invert on
  `:active`; `pointerdown` also unlocks the AudioContext.

---

## 7. Screens and UI flow

**Flow states** (`main.js gameState`): `boot → title → (mode screens) → preparing → countdown → active ↔ paused → results`.
`quit`, `crash`, `goal` and `moves` all land on `results`.

**Screens** (`ui.js SCREENS`, exactly one visible): `title`, `journey`, `learn`, `challenge`, `practice`,
`setup`, `results`, `scores`, `help`, `settings`. **Overlays**: pause (modal), countdown, interrupt
("Welcome back"). Every screen change focuses its first interactive element; `[data-back]` returns to the
title, or restores the pause panel if the run is paused.

**Layout.**
- *Desktop*: full-bleed canvas; HUD objective + progress rail top-left, stat block top-right, pause button
  top-centre; screens are scrollable centred columns over a scrim.
- *Portrait mobile* (≤700 px): rails narrow to 46/38 vw, stat labels hide leaving values, the pause button
  moves to the bottom-right above the tray, and the four-button touch tray sits in the thumb zone.
- *Landscape mobile* (≤480 px tall): rails shrink to 0.8 rem and the tray moves to the right edge (mirrored
  by the left-handed setting).
- *Safe areas*: `--sat/--sab/--sal/--sar` from `env(safe-area-inset-*)` pad the topbar, rails, tray and every
  screen; `viewport-fit=cover` is set.

**Must never be cut off:** the score/distance/token readouts, the objective line and its progress bar, the
pause control, the touch tray, and on results the full breakdown table with its total row.

---

## 8. Art direction

**UI palette** (`css/style.css` `:root`): background `#10131f`, panel `rgba(16,19,31,0.92)`, solid panel
`#181c2e`, text `#eef1f8`, muted `#9aa3b8`, accent `#ffc94d`, secondary `#2f9e8f`, danger `#ff5a3c`,
focus `#7fe7ff`. High contrast swaps to pure black panels, `#fff` text, `#ffe14d` accent, `#fff` focus.

**World themes** (`content.js THEMES`) — each is a palette *and* a phase offset into the day cycle:

| Theme | Sky top → bottom | Fog | Accent | Phase |
|---|---|---|---|---|
| Harbor Dawn | `#2e3a67` → `#f2a56b` | `#d98f6a` | `#ffb347` | 0.00 |
| Civic Noon | `#3f7fd0` → `#bfe3f2` | `#a8c8d8` | `#2f9e8f` | 0.30 |
| Ember Dusk | `#35255c` → `#e2614d` | `#b06a6a` | `#ff7a59` | 0.60 |
| Neon Night | `#070b1e` → `#1b2440` | `#141a30` | `#7fe7ff` | 0.85 |
| Monorail Mist | `#46555e` → `#9db4b8` | `#8aa0a4` | `#d9f26b` | 0.45 |

**Shape language.** Everything is a primitive: capsule courier in coral `#ff5a3c` with a cream visor on a
teal `#2f9e8f` emissive board; barriers are coral/cream striped bars at 1.15 units on thin posts; signs are
teal panels at 3.1 units on tall posts (slide clearance underneath); kiosks are purple `#6b4a8f` boxes with a
dark roof, full height, unambiguously impassable; tokens are gold `#ffc94d` metallic torus rings. Buildings
are instanced boxes with a procedural emissive window texture; lamp posts are cylinders with glow spheres.

**Typography.** System UI stack (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`); headings in
accent gold with a soft glow, `clamp()`-scaled; numerals tabular in the HUD; "Larger text" scales the body to
120 %.

**Motion principles.** Critically damped springs, never cumulative lerps: the player's lane x and the camera's
follow (`laneFollow 0.42`, `springK 42`) use the same `spring()`. Shake is tiered (`crash 0.55`, `dodge 0.06`)
and decays exponentially in a frame-rate-independent way. A small FOV kick tracks speed. Ground scroll is
derived from simulation distance, not frame count, so a stutter never desynchronises the road from the world.

**The hero of the screen** is the lane the player is in, one third from the bottom, with 320 units of readable
track ahead of it. The city, fog and day cycle are all backdrop and must never out-contrast an obstacle.

**Reduced motion** (`settings.reducedMotion`, also honoured via `prefers-reduced-motion`): camera shake off,
FOV kick off, shadows off, particle bursts capped at 4, HUD progress transition and toast animation off,
crash haptics suppressed.

**Visual assets the design calls for:** a title-screen key art backdrop that shows the three lanes and all
three obstacle kinds at dawn; a results-screen token emblem tying the score screen to the collectible; a
16:9 cover image with the wordmark. All three ship (§15).

---

## 9. Audio direction

**Mix philosophy.** The simulation is the composer: cues are one per rules event, short, dry and pitch-jittered
per run seed so a coin line does not machine-gun. Nothing loops in the effects bus; nothing in the mix masks the
`crash` cue, because the music stops on the same frame the run ends.

**Buses** (`js/audio.js`, gains from settings): `music` 0.7, `effects` 0.9, `ambience` 0.5, `voice` 0.8, all into
a master gain. `setMuted()` zeroes bus gains without touching the stored volumes, so the topbar `♪` toggle is
reversible. The AudioContext is created lazily on the first pointer or key gesture; every method is a no-op
until then, and the game is fully playable with audio unavailable.

**Music and ambience.** Ambience is a looped filtered-noise city bed at 0.06 gain. Music is two procedural stems
on a 150 ms clock: a root bass pulse on beats 0 and 4, an arpeggio gated by intensity above 0.15, and a hi-hat
layer above 0.45. Intensity is `(speed − 2)/5`, pushed every frame from `speedAt(distance)` — the track literally
tightens as the city speeds up.

**SFX event table** — the source of truth for `sfx/manifest.txt`. Every event has an authored Opus clip *and* a
WebAudio synth fallback that plays while the sample decodes or if it fails to load.

| Event id | File | Sound | Usage context |
|---|---|---|---|
| `lane` | `lane-switch.opus` | Short sideways air swish with a fabric flap | Accepted left/right; the most frequent cue, kept dry |
| `jump` | `jump.opus` | Rising airy swoop off pavement | Jump accepted, 16-tick arc begins |
| `slide` | `slide.opus` | Gritty shoe scrape on asphalt | Slide accepted, 18-tick window begins |
| `coin` | `token-pickup.opus` | Bright metallic clink with a ringing shimmer | Each token collected |
| `dodge` | `near-miss.opus` | Sharp close pass-by whoosh | Obstacle cleared, +10 banked |
| `invalid` | `invalid-move.opus` | Dull dampened wooden clunk | Command rejected; paired with a live-region message |
| `crash` | `crash.opus` | Body impact into metal with clattering debris | Run-ending hit |
| `goal` | `goal-reached.opus` | Four ascending mallet bells | Objective completed |
| `countdown` | `countdown-beep.opus` | Clean mid electronic beep | Voice bus; 3-2-1 at 700 ms spacing |
| `go` | `go-signal.opus` | Higher sustained start tone | Voice bus; control unlocks on the same frame |
| `ui` | `ui-tap.opus` | Soft plastic button press | Menu and pause interactions |
| `achievement` | `achievement.opus` | Two-tone chime with a medal sparkle | Each newly unlocked achievement |
| `rewind` | `rewind.opus` | Reverse tape swoosh with a settling click | Practice "Rewind 5s" restores a checkpoint |
| `best` | `personal-best.opus` | Rising three-note flourish with a shimmer tail | Results screen, only when an existing personal best is beaten |

---

## 10. Localization

The nine required locales are **en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT**.

Today the shipped game is **en-US only**: user-facing strings are inline literals in `index.html` (menu,
help, settings, overlays) and in `js/ui.js` / `js/content.js` (HUD, results headlines, briefings, lesson
and challenge copy, achievement labels), and numbers are formatted with a hard-coded
`toLocaleString('en-US')` in `ui.js fmtScore`. `<html lang="en">` is static; there is no locale bundle,
no string catalogue and no language selector. Adding the remaining eight locales is tracked in
**Design intent not yet implemented** (§17) — the intended shape is a `data/locales/<tag>.json` catalogue
keyed by stable string ids, chosen from `navigator.languages` with a manual override in Settings, falling
back en-GB→en-US, es-ES→es-419, fr-CA→fr-FR.

**Expansion allowances for that work (already respected by the layout):** headings use `clamp()`, buttons
have no fixed width and wrap, the menu column is `min(320px, 86vw)`, HUD rails are capped in `ch` rather
than px, and the results table is two columns with a scrollable screen — German and French strings 40 %
longer than English fit without clipping at 390 px.

---

## 11. Accessibility

- **Keyboard-only path.** A skip link jumps to the game. Every screen focuses its first control on entry;
  every action (including play) is a real `<button>`. `Esc`/`P` pauses and the pause dialog focuses **Resume**;
  closing an overlay restores the previously focused element.
- **Focus.** `:focus-visible { outline: 3px solid #7fe7ff }` globally, offset 2 px, never suppressed.
- **Screen reader.** `#sr-status` is a polite live region: countdown numbers, `Crash!`, `Objective complete!`,
  rejection reasons, score every 250 points, and the results headline. The canvas host is `aria-hidden`, so
  nothing decorative is announced. The journey grid is a `role="list"` of buttons with labels like
  "Stage 12, mastery, completed". The objective progress bar is a `role="progressbar"` with live `aria-valuenow`.
- **Contrast.** Body text `#eef1f8` on `#10131f` exceeds 15:1; screens sit on an 0.82–0.94 alpha scrim so the
  key art or 3D scene behind them never reduces text contrast. High Contrast mode forces black/white/`#ffe14d`.
- **Colour independence.** Obstacle kinds differ by shape and height as well as hue, and three colour-vision
  palettes (deuteranopia, protanopia, tritanopia) re-hue the player and tokens (`render.js applyPalette`).
- **Reduced motion.** See §8; the setting is a checkbox and is also read from the media query for animations.
- **Target sizes.** All buttons are ≥44 px tall; the touch tray uses 64 px targets with 12 px separation and
  a left-handed mirror option; larger text scales the UI to 120 %.
- **No audio-only information.** Every cue has a visual or textual equivalent.

---

## 12. StarHermit integration

`starhermit.txt` declares `name`, `launch=index.html`, `owner`, `server=server.js`, `cover=coverart.png`.
Conventions per <https://wiki.starhermit.com/>.

**Used.**
- *Launch handshake* — `?launch=<token>` is read into memory only (never persisted) and sent as
  `Authorization: Bearer`; presence of the token (or `?hosted=1`) switches the game to hosted mode.
- *Time* — `GET /api/v1/time`, round-trip adjusted; the topbar clock chip and the daily-day derivation use
  the corrected clock so the daily rolls over on server time.
- *Presence* — `POST /api/v1/presence` on run start, then every 30 s until the run ends.
- *Sessions/activity* — `POST /api/v1/activity/start` at boot, `/end` on `beforeunload`.
- *Leaderboard* — `POST /api/v1/daily/submit` with `{envelope, day}`; the server re-derives the day's seed
  **and config**, replays the command log with the same `js/rules.js`, rejects `stale-version`,
  `seed-mismatch`, `implausible-duration` (> 54 000 ticks), `replay-mismatch`, `not-terminal` and
  `implausible-input-rate` (more commands than ticks), de-duplicates by `day:sessionId`, and returns a rank.
- *Telemetry* — `POST /api/v1/telemetry`, consent-gated (Settings → Data), anonymous `{event, props, ts}` only.

**Not used.** No identity or profile API (the profile chip is a static "Guest"), no platform achievement or
cloud-save API (achievements and progression are local), no matchmaking, party, chat or realtime multiplayer —
the game is single-player with asynchronous daily competition.

**Offline.** Without a launch token every one of those calls is skipped client-side, and all failures are
caught: the game boots, plays, scores and persists identically.

---

## 13. Technical architecture

**Module boundaries.** `rules.js` is pure and imports only `rng.js`. `session.js` is the only module that
mutates rules state, and only through validated commands. `render.js` and `audio.js` are read-only consumers of
snapshots and event arrays. `ui.js` owns the DOM and knows nothing about the simulation beyond the snapshot
fields it prints. `main.js` is the only place the three meet.

**Timing.** `session.update(now)` accumulates wall-clock delta, clamps a single delta to 250 ms (background-tab
guard) and runs at most 12 fixed 33.3 ms steps per frame, shedding the remainder rather than death-spiralling.
The leftover fraction becomes `alpha` for the renderer.

**Determinism and replay.** Same seed + same config + same command log ⇒ same hash, verified in unit tests and
enforced server-side. A hash is recorded every 300 ticks (10 s) alongside the command log.

**Persistence** (`localStorage`, prefix `metro-dash:`, wrapper `{v:1, checksum, payload}` with an FNV-1a
checksum; corrupt or stale documents are backed up to `<key>.backup` and replaced by defaults; if storage is
unavailable an in-memory Map takes over): `settings`, `progression`, `achievements`, `leaderboard` (bounded to
200 entries per mode/day scope), and `snapshot:<kind>:<id>` for interrupted runs.

**Interruption.** Pausing writes a snapshot; backgrounding the tab auto-pauses and suspends audio; on the next
boot the game scans daily/journey/lesson keys and offers "Welcome back" with the exact restored state or
abandon.

**Rendering budgets.** Quality tiers `low / medium / high` set pixel ratio (1 / 1.5 / 2), shadows (off/on/on),
building count (10 / 16 / 24), particle cap (400 / 1 500 / 4 000) and render scale (0.85 / 1 / 1). `auto`
picks `low` when `deviceMemory ≤ 3` or on a coarse pointer with a short screen edge < 500 px. Obstacles use
fixed pools (22 per kind), tokens a pool of 48, buildings and lamps are instanced and recycled modulo a
520-unit span; nothing is allocated per frame in the hot path. If WebGL is missing, `createRenderer` falls back
to the 2D pseudo-perspective renderer with the same interface and the title shows a compatibility notice.

**Automation surface.** `window.__md` exposes read-only getters for `state`, `session` and `settings` so the e2e
test can assert flow state — it drives the game exclusively through real buttons, keys and taps.

---

## 14. Testing and acceptance criteria

**`npm test` → `node tests/rules.test.mjs`** covers: legal-action verdicts at both lane edges and in every
motion state; the jump/slide clearance model; obstacle and token resolution; all four terminal reasons; the
score formula; serialize/deserialize/hash round-trips and version rejection; RNG stability; replay validation
including mismatch detection; fuzzed command streams that must never throw; and `validateContent()`, which runs
the deterministic reference bot over all 40 journey stages, 6 challenges and 5 lessons to prove every goal is
reachable and no stage soft-locks, plus an endless daily sanity run.

**`npm run test:e2e` → `tests/e2e.mjs`** starts a static server on an ephemeral port and drives headless Chrome
twice — desktop 1280×800 with the keyboard, then mobile 390×844 with touch — through: title → help (≥5 cards) →
journey grid (exactly 40 stages, exactly 1 unlocked) → settings toggle → daily briefing (must state ranked
status) → countdown → active play with six real inputs → distance actually accumulating → pause/resume →
run to crash → results breakdown (≥3 rows) → retry → pause → end run → results → menu. Any `pageerror` or
non-benign console error fails the run; screenshots are written per stage.

**`node tests/daily-contract.mjs`** boots the real `server.js` and checks the submit contract end to end:
honest run accepted with a rank, resubmission answered `duplicate`, forged config rejected.

**QA bar** (`agents/qa.md`) as checkable statements:
1. A first-time player is taught: Learn mode's five lessons each require the mechanic they teach, How to Play
   lists every binding, and each briefing states the objective before play. ✔
2. Every implemented feature is reachable in the browser through visible controls — all ten screens, both
   overlays, rebinding, the audio toggle, data reset, practice rewind. ✔
3. No console errors or warnings during boot, a full run, resize or pause, at desktop and mobile sizes
   (asserted by e2e). ✔
4. Nothing is cut off at 1280×800, 390×844 portrait or 844×390 landscape; safe-area insets pad every edge. ✔
5. Platform features that could be used are used (§12). ✔
6. Localization: **not met** — en-US only (§10, §17).

---

## 15. Asset inventory

| Path | Purpose | Source | Status |
|---|---|---|---|
| `coverart.png` (1200×675) | StarHermit cover art: courier mid-jump over the three lanes at dusk, wordmark and tagline | FLUX.2 klein seed 88213 + ffmpeg wordmark | Generated in this pass (replaces a placeholder template card) |
| `assets/keyart-title.webp` (1024×576) | Title-screen backdrop behind the menu scrim | FLUX.2 klein seed 730451 | Generated in this pass, wired in `css/style.css` |
| `assets/token-emblem.webp` (320×320) | Decorative token emblem on the results screen | FLUX.2 klein seed 40219 | Generated in this pass, wired in `index.html` |
| `icon.png`, `favicon.svg` | App icon and tab icon | Authored | Shipped |
| `sfx/lane-switch.opus` … `sfx/achievement.opus` (12 clips) | Core event cues (§9) | MOSS-SoundEffect v2.0, 100 steps | Shipped |
| `sfx/rewind.opus` | Practice rewind cue | MOSS-SoundEffect v2.0, 100 steps | Generated in this pass, wired to `audio.event('rewind')` |
| `sfx/personal-best.opus` | Personal-best flourish | MOSS-SoundEffect v2.0, 100 steps | Generated in this pass, wired to `audio.event('best')` |
| `sfx/manifest.txt` | Canonical clip → event → description → context map | Authored | Updated in this pass |
| `sfx/manifest.json` | Generator input for the SFX toolchain | Authored | Updated in this pass |
| Ground, window, stripe textures | Road stripes, emissive building windows, barrier stripes | Procedural canvas textures in `render.js` | Shipped |
| Player, obstacles, tokens, city | All in-world geometry | Three.js primitives in `render.js` | Shipped — no 3D model files, by design |
| Music, ambience | Adaptive two-stem loop and city bed | Procedural WebAudio | Shipped |

No 3D model or character-animation assets are needed: the world is deliberately built from primitives so the
low tier stays cheap and the silhouettes stay unambiguous (pillar 3).

---

## 16. Known limitations

1. **English only.** See §10 — the QA bar's localization requirement is unmet.
2. **Daily boards are in-memory** (`server.js dailyBoards`): a restart drops every board and the idempotency
   set, so a previously submitted session can be re-submitted after a restart. Durable storage is a hosting
   concern the script does not implement.
3. **Replay envelopes without a `result` block validate vacuously** (`rules.js validateReplay`: `ok = !r || …`).
   The score returned to the board is still recomputed server-side, and the submit handler now also requires a
   terminal reason, so this does not inflate scores — but the check is weaker than it reads.
4. **The "Show hints" setting has no behaviour**: it is persisted and tagged onto leaderboard entries as
   `assists`, but no hint is ever shown.
5. **`holdToSlide` exists in `DEFAULT_SETTINGS` with no UI and no effect.**
6. **The profile chip is a static "Guest"** — there is no identity integration (§12).
7. **The 2D fallback renderer is functional, not pretty**: flat rectangles, no day cycle, no particles, no
   camera work. It exists so a WebGL-less device can still play.
8. **`tests/browser_smoke.py` cannot run in the current environment** (no Python `playwright` module); the Node
   e2e suite covers the same flow.
9. **Untested paths** (per `knownissues.md`): gamepad input, multi-day daily rollover, `EXCLUDED_DAYS`, and
   audio under headless Chrome (the AudioContext is blocked before a gesture).

---

## 17. Design intent not yet implemented

- **Nine-locale localization.** String ids extracted from `index.html`/`ui.js`/`content.js` into
  `data/locales/<tag>.json` for en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT; language chosen
  from `navigator.languages` with a Settings override; `fmtScore` switching to the active locale; `<html lang>`
  updated on change.
- **A hint system behind the existing "Show hints" toggle**: a first-encounter prompt for each mechanic
  ("Overhead sign — swipe down to slide") shown once per mechanic per profile, suppressed once the matching
  lesson is complete.
- **`holdToSlide`**: hold the slide input to re-arm the slide as soon as the 18-tick window ends.
- **Identity in the profile chip** when a launch token resolves to a StarHermit account, replacing "Guest".
- **A durable daily board** behind the same submit contract, so ranks survive a restart.
