# Metro Dash — Game Design Document

Running spec. Present tense; everything below describes the game as it ships today, on the StarHermit
engine. Port differences from the old browser build and known limitations are collected at the end.

---

## 1. Overview

**Pitch.** Three lanes of transit track, one courier on a hover-skate, and a city that rolls
from dawn to neon night while you read traffic at 6.4 units per tick and decide — left, right,
jump, or slide — one tick at a time.

| | |
|---|---|
| Genre | Three-lane endless runner with authored campaign content |
| Players | 1 (asynchronous competition via a shared daily seed and the platform's high-score board) |
| Session length | 1–5 minutes per run; a journey stage is ~40–90 s |
| Platforms | StarHermit engine script game (engine 1.29.0, host API 1.31, `engine.minor=31`): played natively by the StarHermit client and in browsers by the engine's web runtime; desktop, phones (portrait and landscape), gamepads |
| Rendering | `starhermit:scene` (three.js r185-parity scene graph; the old build used three.js r160) and `starhermit:ui` / `starhermit:draw` for every screen and the HUD |
| Simulation | Deterministic 30 tps rules (`js/rules.js`), one rules step per runtime fixed step (`setFixedRate(30)`); no wall clock inside the rules |
| Persistence | The engine save (`starhermit:storage saves`: device + the player's cloud slot), the game's options as engine settings, interrupted-run snapshots in device storage |

### File map

| Path | Responsibility |
|---|---|
| `starhermit.txt` | Manifest: name, owner, server (`score-script.js`), cover, `launch=index.html`, `engine.*` (entry `native/main.ts`, version 1.29.0, minor 31, capabilities platform/storage/clipboard), the five actions with keyboard and gamepad defaults. |
| `index.html`, `starhermit-files.json` | The engine's web loader and package file index, written by `npm run package` (`starhermit package --web .`); never edited by hand. |
| `native/main.ts` | Entry module: flow state machine (title → mode screens → briefing → countdown → run ⇄ pause → results), input (actions, swipes, tray), rules events → sound/sparks/announcements, progression, achievements, local board, leaderboard posting, Practice rewind, "Welcome back" resume, the attract run, lifecycle. |
| `native/screens.ts` | Every screen, the top bar, HUD, tray, countdown, pause and "Welcome back" dialogs, toasts on `starhermit:ui`; the layouts. |
| `native/render.ts` | The city on `starhermit:scene`: street, towers, lamps, WGSL sky dome, day cycle, courier, obstacle and token pools, sparks and motes, spring camera, sun shadows, post effects per quality tier. |
| `native/quality.ts` | The old presets and budgets keyed by the runtime's quality tier and level. |
| `native/audio.ts` | Authored one-shots on `starhermit:audio`; the ambience bed and four adaptive music layers rendered to looping clips. |
| `native/platform.ts` | The save (merge, foreign-save migration), the game's options and legacy settings removal, player/invite/clock, score posting. |
| `native/i18n.ts` | Locale from the runtime's interface language; `T`/`N`/`S`/`fmt`. |
| `native/style.ts` | Registers `assets/ui-style.json`, the theme and the high-contrast tokens. |
| `native/shim.ts` | `localStorage` over device storage for `js/storage.js` (run snapshots). |
| `native/game.ts` | Typed facade over the unchanged ES modules in `js/`. |
| `js/rules.js` | Pure rules engine: state, legal actions, `step`, generation, scoring, serialize/hash, replay validation (unchanged). |
| `js/content.js` | Themes, 5 lessons, 40 journey stages, 6 challenges, daily derivation, practice, achievements, reference bot, content validator (unchanged). |
| `js/session.js` | One run: command queue, replay log, periodic hashes, pause/snapshot/restore, checkpoints (unchanged; stepped once per fixed step). |
| `js/storage.js` | Snapshot keys, achievement unlocks, the local board insert and tie-break comparator (JSON clones instead of `structuredClone`). |
| `js/save.js` | The save document: normalize, merge, foreign (old cloud mirror) reading, the game's options, legacy KV keys. |
| `js/strings.js`, `js/i18n.js`, `js/lang.js`, `js/sh-strings.js` | Translation tables (English keys, nine locales), the lookup core (`MDI18N`), the content's `T`/`N`, the account strings. |
| `js/rng.js` | `fnv1a` and the mulberry32 `Rng`. |
| `score-script.js` | StarHermit platform script (`server=`): range-checks a finished run's score and posts it to the `high-score` leaderboard. |
| `assets/` | Title key art, results token emblem, `ui-style.json` (from `tools/ui-style.css`), `textures/` (baked asphalt, roughness and window maps). |
| `sfx/` | 14 Opus clips + `manifest.txt` / `manifest.json` / `manifest.md` (left out of the package). |
| `tools/` | `css.mjs`, `package-web.mjs`, `bake-textures.mjs`, `gen-plays.mjs`, `browser-play.mjs`, `ui-style.css` (left out of the package). |
| `tests/` | `rules.test.mjs`, `save.test.mjs`, `i18n.test.mjs`, `native.mjs` + `native/*.play` (left out of the package). |

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
HUD read snapshots. *Rules in:* replayable runs (envelopes any referee can re-run with the same
code), checkpoint rewind, a reference bot that proves every authored stage is finishable.
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
Nothing requires a login. Signed in to StarHermit the game adds the platform's time, the player's
name in the top bar, cloud-synced progress and the high-score board. *Rules in:* every
network call wrapped and failure-tolerant. *Rules out:* gating content on connectivity, blocking a
run on a network call.

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

- **Local board ties** (`storage.js compareEntries`) order by: score desc → fewer `invalidActions` → fewer ticks → stable session id.
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
| **Daily Run** | `btn-play` | One shared UTC-day seed, theme = `seed mod 5` | none (endless) | Yes — local board scoped to the day; signed-in runs also post to the platform's high-score board |
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
at `{goal:null, speedScale:1}`. Playing on three
distinct days unlocks *Regular Commuter*.

**Achievements** (`ACHIEVEMENTS`, unlocked idempotently in `native/main.ts checkAchievements`): First Arrival (finish
any run), Graduate (all five lessons), Mid-Line (journey 20), End of the Line (journey 40), Regular Commuter
(3 daily days), Long Haul (100 000 total units). Unlocks happen as a run ends; the results screen lists them and plays the `achievement` cue (no toast).

**Unlocks.** Journey stage *n* requires stage *n−1* completed; nothing else is gated. Progress lives in
the engine save and is resettable from Settings → Data.

---

## 6. Controls and interaction

| Action (`starhermit.txt`) | Keyboard (default) | Touch | Gamepad (default) |
|---|---|---|---|
| `left` | `←` / `A` | swipe left, or the tray's `◀` | D-pad left, left stick left |
| `right` | `→` / `D` | swipe right, or `▶` | D-pad right, left stick right |
| `jump` | `↑` / `W` / `Space` | swipe up, or `▲` | A (South), D-pad up, left stick up |
| `slide` | `↓` / `S` | swipe down, or `▼` | B (East), D-pad down, left stick down |
| `pause` | `Esc` / `P` | the HUD's pause button | Start |

- **Rebinding** is the runtime's: Settings → *Key bindings* (`requestRebind`) or the runtime's Options; How to
  Play shows the effective keys (`bindings()`), so it follows every rebind.
- **Swipes** (`main.ts pointerInput`): a press on the street (not on the top bar, the pause button or the tray)
  and its release within 600 ms; travel under 24 logical px is a tap and commits nothing; the dominant axis
  decides the action. A mouse drag counts as a swipe too, as the old pointer events did.
- **Tray** (touch-first devices, or a phone-sized window before its first touch): four 64 px buttons named
  Move left / Jump / Slide / Move right; the left-handed option mirrors their order (and puts the tray on the
  left in a short landscape window).
- **Input locking.** Commands are only accepted while the run is active (not during the countdown, the pause
  panel or a screen); one command is queued per rules step and a newer input replaces an unapplied one, so
  mashing cannot bank moves. Game keys clear UI focus so they never also walk the HUD's buttons.
- **Feedback for every input.** Accepted → rules event → sound + renderer response. Rejected → the
  `invalid-move` sound, `Not now: <reason>` / `Can’t do that: <reason>` in the live region, no state change.

---

## 7. Screens and UI flow

**Flow** (`main.ts app.game`): `title → (mode screens) → countdown → active ⇄ paused → results`. `quit`,
`crash`, `goal` and `moves` all land on results. The countdown counts 21 fixed steps per number (the old
700 ms), then GO (shown 15 steps) as the run starts and the music comes in.

**Screens** (one at a time, under the top bar): title (over the key art; Play Daily Run with the UTC day,
Journey, Learn, Practice, Challenges, Scores, Settings, How to Play, Sign in with StarHermit for guests,
Invite a friend when signed in, the progress line), journey (the 40-stage grid with ★ mastery marks, stars
by par, locks), learn and challenges (cards with ✓ marks / best scores), practice (Relaxed / Standard /
Intense), setup (the briefing: mode, objective, speed, expected time, players, ranked, move budget, allowed
moves, new mechanic), results (title, token emblem, headline, score table, personal best, leaderboard line,
achievements, Retry / Next Stage / Menu), scores (All Runs / Daily / Mine filters, the local board's top 50),
help (the five controls with their effective keys and touch/pad alternatives, the rules), settings.
**Overlays** over the run: the countdown, the pause panel (Resume, Rewind 5s in Practice, Settings, How to
Play, Restart, End Run) and "Welcome back" (Resume run / Abandon run) as dialogs. Every screen focuses its
first control; Back returns to the title, or to the pause panel when the run is paused (Settings and How to
Play opened from the pause panel). Escape on a panel resumes the run.

**Top bar** (56 px): METRO DASH, the player chip (Guest or the display name), the cloud chip for signed-in
players (Syncing… / Cloud synced / Cloud offline; left out under 460 px), the UTC clock by the platform's time
(left out under 340 px) and the ♪ button (mutes the game's sound for the session; ∅ while muted). The street
is drawn in the band below it (`camera.setViewOffset`), as the old canvas sat under the DOM top bar.

**Layouts** (by the window's logical size, the old media queries):
- *Desktop / compact*: objective rail top-left (290 px, 230 under 1024 px), stats rail top-right, pause button
  top-centre; screens are centred scrolling columns.
- *Portrait phone* (≤ 700 px wide, portrait): narrower objective rail, stat labels hidden (values only), the
  pause button bottom-right above the tray.
- *Short landscape* (≤ 480 px tall): slimmer rails, the tray at the side, the pause panel in two columns, the
  title menu as wrapping rows, a 52 px emblem.
- Larger UI on big screens and the player's UI size are the runtime's (`ui.preferences().scale`); safe areas
  pad the top bar and rails.

**Must never be cut off:** the score/distance/token readouts, the objective line and its progress bar, the
pause control, the touch tray, and on results the full breakdown table with its total row (screens scroll
when taller than the window).

---

## 8. Art direction

**UI palette** (`tools/ui-style.css` `:root`, the old `css/style.css`): background `#10131f`, panel `rgba(16,19,31,0.92)`, solid panel
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

**Typography.** The runtime's sans-serif faces; headings in accent gold (the old soft text glow is not
drawn), sized by the layout; numerals tabular in the HUD; larger text is the runtime's text-size option.

**Motion principles.** Critically damped springs, never cumulative lerps: the player's lane x and the camera's
follow (`laneFollow 0.42`, `springK 42`) use the same `spring()`. Shake is tiered (`crash 0.55`, `dodge 0.06`)
and decays exponentially in a frame-rate-independent way. A small FOV kick tracks speed. Ground scroll is
derived from simulation distance, not frame count, so a stutter never desynchronises the road from the world.

**The hero of the screen** is the lane the player is in, one third from the bottom, with 320 units of readable
track ahead of it. The city, fog and day cycle are all backdrop and must never out-contrast an obstacle.

**Reduced motion** (the runtime's reduced-motion option): camera shake off,
FOV kick off, shadows off, particle bursts capped at 4, courier idle bob, token spin, ambient motes, barrier
light pulse and beacon blinking off, crash vibration suppressed.


**Graphics** (`native/render.ts`, `native/quality.ts`). ACES filmic tone mapping (exposure 1.05) with sRGB
output. A WGSL sky dome draws the gradient, sun glow and disc, and night stars; exponential fog matches its
horizon. The day cycle runs on distance (`phaseOffset` of the theme + distance / 24 000) through five keys
(dawn, noon, dusk, night, dawn) and drives the sky, fog, sun and hemisphere light (r160 intensities),
window glow, lamp glow, light-pool opacity, sun direction and colour and the reflections' strength. Lights
follow the old build at r160; reflections come from a prefiltered `RoomEnvironment` given to each standard
material as its own `envMap` with the old per-material `envMapIntensity` × daylight (r160 scaled the scene
environment by each material; three.js r163+, as the engine, does that only for a material's own map).

The runtime's quality tier (Options › Graphics: Auto from the device's graphics level, or a level) picks the
old preset's look:

| Tier | Shadows | AO | Bloom | Grade | AA | Reflections | Particles | City detail | Materials | Towers/side |
|---|---|---|---|---|---|---|---|---|---|---|
| Low | off | off | off | off | MSAA | off | low | plain | Lambert | 10 |
| Balanced | 1024 | off | on | on | FXAA | on | high | detailed | Standard | 16 |
| High | 2048 | on | on | on | SMAA | on | high | detailed | Physical | 24 |
| Ultra | 4096 | high | on | on | MSAA | on | high | detailed | Physical | 32 |

Sparks (600–4 000) and motes (80–400) scale up to 2× with the level inside a tier. Bloom: strength 0.45,
radius 0.45, threshold 0.92 (lamps, windows, beacons, tokens, neon strip). Grade (fx.js GradeShader, display
space after the output): contrast 0.11 (the old 0.22 S-curve weight), saturation 1.1, cool shadows / warm
highlights, a bluer cast at night, a 0.24 vignette. City detail adds the baked asphalt (1024 px; the runtime
holds textures to the level) with its damp roughness map, curbs, lamp light pools and rooftop beacons. The
runtime owns render scale, the pixel-ratio cap, adaptive resolution, the frame-rate limit and readout; the old
per-effect overrides and the benchmark hook are not offered.

---

## 9. Audio direction

All one-shots are the authored Opus clips (`sfx/manifest.txt`): lane switch, jump, slide, token, near miss,
invalid move, crash, objective, countdown beep, go signal, UI tap, achievement, rewind, personal best. UI taps
play on the runtime's *interface* bus, the rest on *effects*. The ambience bed (white noise lowpassed at
400 Hz) and the adaptive music (a 55 Hz triangle bass on beats 1 and 5 of 8 at 150 ms steps; a square-wave
arpeggio of seeded A-minor-pentatonic notes on even steps from intensity 0.15 and on every step from 0.6; a
6 kHz hi-hat tick from 0.45; intensity = (speed − 2) / 5) are rendered once into clips and looped on the
*music* bus, each music layer faded to its level; the music runs from GO to the run's end. Pause and a hidden
window silence everything. Volumes, mute and the voice limit are the runtime's Options; the ♪ button mutes the
game for the session. Clips load once the mixer runs, one at a time; a clip still loading is silent.

---

## 10. Localization

Nine locales: en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT. The locale is the runtime's
interface language (Options › Language, else the account's preferred language, else the device's), mapped to
the nearest shipped locale (`native/i18n.ts pickLocale`); a change shows on the next frame without touching the
run. Strings are English keys in `js/strings.js` (en-GB, es-ES, fr-CA carry only their differences), the account
lines in `js/sh-strings.js`. Numbers use the locale's digit grouping; dates on the Scores board the locale's
format. The rules' reasons in `Not now: <reason>` stay the rules' identifiers, as before.

---

## 11. Accessibility

Every control is a runtime widget with a name (the tray's glyph buttons are named Move left / Jump / Slide /
Move right; journey stages "Stage 3, mastery, completed, locked"), reachable by Tab, arrows and the gamepad,
with a visible focus ring. The live region announces the countdown, crashes, completed objectives, rejected
commands, score every 250 points and the results. High contrast (runtime option) swaps the palette to black
panels and drops the key art; larger text and reduced motion are the runtime's options (reduced motion: see
§8). The colour palette option (Standard, Deuteranopia-, Protanopia-, Tritanopia-safe) recolours the courier
and tokens. Rules never depend on colour alone (shapes and heights differ by obstacle).

---

## 12. StarHermit integration

- **Save.** The engine save (`saves`, schema 1) holds `{ v, progression, achievements, leaderboard }`; it is
  written at the end of every run and on a reset, on the device at once and to the account (debounced by the
  runtime). Two devices' saves merge (`js/save.js merge`): stages and challenges keep the better score, lessons
  and Daily days are united, totals and the best Daily per day take the larger, achievements the earliest
  unlock, the runs board is united by session id. The old build's cloud mirror (`game:<slug>`, the JS SDK's
  `saveJSON` of `{ v, settings, progression, achievements, leaderboard }`) shows as a foreign save: it is
  merged in once and replaced (`replaceForeign`). The old browser localStorage (guests' local progress) does
  not migrate.
- **Options.** The colour palette, left-handed tray and hints are engine `settings` (synced with the account);
  their old values in the account's settings KV are adopted unless set since, then every old KV key (volumes,
  graphics, reduced motion, high contrast, larger text, consent, `ui.language`, `audio.options`, …) is removed.
  Key bindings are the runtime's controls.
- **Interrupted runs.** Pausing a run (or hiding the window, which pauses it) snapshots it to device storage
  (`metro-dash:snapshot:<kind>:<id>`); at the next start a Daily, Journey or lesson snapshot is offered back as
  "Welcome back" (Resume run / Abandon run). Coming back to a window that was hidden mid-run shows the same
  notice.
- **Leaderboard.** Signed-in players' finished runs (not Practice, lessons or runs ended from the pause panel)
  post their total through `score-script.js` (a practice session whose socket carries `{ type: 'result',
  scores: { 'high-score': n } }`; the script range-checks it) and the results show the rank on the board. Per
  the user's decision, solo scores stay client totals range-checked by the script for this port.
- **Player and clock.** The top bar shows the display name and the cloud status; the Daily's day and the clock
  come from the platform's time (`serverNow`), else the device's UTC date. Sign in (guests) and Invite a friend
  (copies the invite link) are on the title.

---

## 13. Technical architecture

The rules, content and session modules are the browser build's ES modules, imported unchanged through
`native/game.ts` (`allowJs`). `setFixedRate(30)`: each runtime fixed step runs exactly one rules step of the
active run (the session's accumulator is set to one step and `update(0)` called), the countdown counts the same
steps, and the attract run behind the menus advances one step per fixed step (restarted when it crashes). So
pauses, a hidden window and slow frames never cost time, and render checks replay play scripts exactly. The
street is drawn between steps by the frame's interpolation (distance + speed × alpha). Practice keeps a
checkpoint every 150 steps (the last four); Rewind 5s restores the latest. UI presses are applied after the
frame's UI is built (`later`). Cosmetic randomness (sparks, shake) never touches the rules' stream.

---

## 14. Testing

- `npm run test:unit` — `tests/rules.test.mjs` (rules legality, determinism, replay, serialization, content
  validation incl. the reference bot reaching every goal), `tests/save.test.mjs` (old cloud mirror read as a
  foreign save, normalize, lossless merges, options and legacy keys), `tests/i18n.test.mjs` (every key the
  client and content show is in every locale, no stale keys, placeholders, account strings, locale switching).
- `npm run test:native` — `tests/native.mjs`: the web index matches the files, `tsc`, `starhermit check .`
  with zero warnings, and every `tests/native/*.play` as a signed-out render check driving the real UI:
  `menus` (every door off the title, the sound toggle, Settings' reset confirm), `journey-1` (stage 1 by the
  reference bot's timed keys, the exact total on the results, Next Stage, Scores, the grid's star),
  `challenge-express-landscape` (Express Service by the bot in an 844×390@3 window, Retry, End Run),
  `lesson-lanes-phone` (Lesson 1 on a 390×844@3 phone by a tray tap and a swipe), `daily-practice` (the Daily
  to its crash with Settings / How to Play opened from the pause panel, Scores, Practice paused, restarted and
  ended). `tools/gen-plays.mjs` writes the bot-driven scripts.
- `npm run test:browser` — `tools/browser-play.mjs`: the packaged loader in GPU Chrome at a desktop, a DPR-3
  phone and a DPR-3 landscape phone: keys or finger taps, the tray and swipes (CDP touch), pause, the results;
  fails on console errors/warnings or the runtime's error screen.
- `npm run package` regenerates `index.html` + `starhermit-files.json` after every change.

---

## 15. Asset inventory

`assets/keyart-title.webp` (title backdrop), `assets/token-emblem.webp` (results emblem),
`assets/textures/asphalt.webp`, `asphalt-rough.png`, `windows.png` (baked by `tools/bake-textures.mjs` from the
old canvas painters), `assets/ui-style.json`, `sfx/*.opus` (14 clips), `cover.jpg`, `icon.png`,
`coverart.png` (source art, not packaged). The small textures (plain street stripes, barrier stripes, sign
face, kiosk face and screen, the radial glow) are painted at start on the engine's canvas.

---

## 16. Port differences and known limitations

- The old Settings screen's audio sliders, graphics panel, reduced motion, high contrast, larger text,
  language and key rebinding are the runtime's Options; the anonymous-usage-stats switch is gone (its
  telemetry only ever went to the local dev server).
- The local dev server (`server.js`) with its replay-validated Daily board, presence, activity and telemetry
  routes is gone (none of it ran on StarHermit); Daily runs are recorded on the local board and, signed in,
  posted to the platform's high-score board.
- The 2D-canvas fallback renderer is gone (the runtime draws everywhere it runs).
- During pause the frozen run stays visible behind the panel (the old build drew the attract run there).
- A lesson goal of lane changes reads "Perform 2× lane change" (the old build showed the identifier
  `laneChange`).
- The title's soft text glow and the emblem's screen blend are not drawn; the music loop starts when the
  mixer is ready rather than on the beat at GO.
- Practice seeds come from `Math.random()` (unranked by design), so Practice is not covered by an exact
  play script; its rewind is exercised by hand only.
- Guests' old browser localStorage progress cannot migrate (accepted); cloud saves do.
- Signed-in paths (foreign save, legacy settings, score posting) are covered by unit tests, not live-tested.
