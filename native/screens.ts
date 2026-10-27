// The browser build's DOM shell (index.html + js/ui.js + css/style.css) as
// starhermit:ui, built every frame over the city: the top bar (METRO DASH,
// the player chip, the cloud-save chip, the UTC clock and the ♪ sound
// toggle); the screens over their wash (the title over the key art — Play
// Daily Run with the day, Journey, Learn, Practice, Challenges, Scores,
// Settings, How to Play, Sign in / Invite and the progress line; the Journey
// grid of 40 stages with mastery marks, stars and locks; the lesson and
// challenge cards; the Practice difficulty; the briefing with its facts; the
// results with the token emblem, the score table, the personal best, the
// leaderboard line and achievements; the local Scores board with its filters;
// How to Play with the effective keys and the rules; Settings); the run's HUD
// (the objective rail with its progress bar and move budget, the stats rail,
// the pause button, the touch tray); the countdown; the pause panel and the
// "Welcome back" notice as dialogs; the toasts. The old media queries are
// layouts picked by the window's logical size: portrait phone (≤ 700 px wide,
// portrait: the stat labels hidden, the pause button above the tray), short
// landscape (≤ 480 px tall: slimmer rails, the tray at the side, the pause
// panel in two columns, a smaller emblem) and compact (< 1024 px: narrower
// rails).
import { frame, openMenu } from "starhermit:engine";
import { bindings, requestRebind } from "starhermit:input";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { Content, Rules, Save, type Entry } from "./game.ts";
import * as audio from "./audio.ts";
import { N, S, T, fmt } from "./i18n.ts";
import * as platform from "./platform.ts";
import {
  ACTION_WORDS, MODE_NAMES, PRACTICE_LEVELS, app, back, canRewind, contentLabel, copyInvite, daily, doAction, hudRects, later,
  leaderboardLine, nextStage, objectiveProgress, objectiveText, open, pauseGame, quitRun, resetProgress, restartRun, resultsHeadline,
  resultsMenu, resultsTitle, resumeGame, retry, rewindRun, save, selectContent, signIn, startPending, startPractice, toggleMute, touchOnly,
} from "./main.ts";

// ------------------------------------------------------------------ layout
const TB = 56; // the top bar: 44 px buttons inside 6 px padding
interface Layout { lw: number; lh: number; sc: number; portrait: boolean; short: boolean; compact: boolean }
function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const sa = f.safeArea;
  const lw = Math.max(1, (f.width - sa.left - sa.right) / sc), lh = Math.max(1, (f.height - sa.top - sa.bottom) / sc);
  return { lw, lh, sc, portrait: lw <= 700 && lh >= lw, short: lh <= 480 && lw > lh, compact: lw < 1024 };
}
/** The top bar's height in window pixels (the street is drawn below it). */
export function topbarHeight(): number {
  const f = frame();
  return TB * ui.preferences().scale + f.safeArea.top;
}
const lastSize = new Map<string, number>();
function textWidth(text: string, style: string, kind?: "button" | "heading"): number {
  return ui.measureText(text, { ...(kind ? { kind } : {}), style: [style] }).width / ui.preferences().scale;
}
const fresh = (): boolean => frame().frame !== app.openedFrame;
interface Btn { id: string; text: string; style?: string; act: () => void; disabled?: boolean; selected?: boolean; name?: string }
const buttonWidth = (text: string, style: string): number => textWidth(text, style, "button") + 4;
/** A button `width` wide (null: its text's); a label too long for it wraps inside. */
function button(b: Btn, width: number | null = null): void {
  const style = b.style ?? "btn";
  const opts: ui.ButtonOptions = {};
  if (b.disabled) opts.disabled = true;
  if (b.selected !== undefined) opts.selected = b.selected;
  const s: ui.Style = width != null ? { width } : {};
  if (width != null && buttonWidth(b.text, style) > width) {
    const inner = Math.max(20, width - 44);
    opts.content = () => { ui.style({ text: { align: "center" } }).paragraph(b.text, inner); };
  }
  if (ui.style(style, s).id(b.id).button(b.name ?? b.text, opts) && fresh()) later(b.act);
}
/** One full-width button a line (index.html .menu). */
function stack(label: string, list: Btn[], width: number, gap = 10): ui.Rect {
  return ui.column(label, () => { for (const b of list) button(b, width); }, { spacing: gap, width });
}
/** index.html .row: buttons at their own widths in centred rows that wrap at `width`. */
function flow(label: string, list: Btn[], width: number, gap = 12): ui.Rect {
  const rows: Btn[][] = [[]];
  let used = 0;
  const bw = (b: Btn): number => Math.min(width, buttonWidth(b.text, b.style ?? "btn"));
  for (const b of list) {
    const w = bw(b);
    if (rows[rows.length - 1]!.length && used + gap + w > width) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1]!.length ? gap : 0) + w;
    rows[rows.length - 1]!.push(b);
  }
  return ui.column(label, () => {
    rows.forEach((row, ri) => ui.row(`${label}-r${ri}`, () => {
      for (const b of row) button(b, bw(b) >= width ? width : null);
    }, { spacing: gap, width, justify: "center" }));
  }, { spacing: gap, width });
}
/** Text up to `width` wide: one label when it fits, else a paragraph. */
function para(text: string, width: number, cls = "body", id?: string, align: "start" | "center" = "center"): void {
  if (!text) return;
  let u = ui.style(cls, { text: { align } });
  if (id) u = u.id(id);
  if (textWidth(text, cls) <= width) u.label(text);
  else u.paragraph(text, width);
}
function heading(cls: string, text: string, width: number, id?: string): void {
  if (textWidth(text, cls, "heading") <= width) (id ? ui.id(id) : ui).style(cls).heading(text);
  else ui.style(cls, { text: { align: "center" } }).paragraph(text, width);
}
function rect(r: ui.Rect): void { hudRects.push({ x: r.x, y: r.y, width: r.width, height: r.height }); }

// ------------------------------------------------------------------ the frame
export function drawScreens(): void {
  const L = layoutNow();
  const f = frame();
  if (app.screen === null) runScreen(L);
  else {
    backdrop(app.screen === "title" ? (ui.preferences().highContrast ? "title-plain" : "title-wash") : "screen-wash", L);
    switch (app.screen) {
      case "title": page("title", L, titleScreen, 900); break;
      case "journey": page("journey", L, journeyScreen, 760); break;
      case "learn": page("learn", L, (w) => listScreen(w, "learn"), 600); break;
      case "challenge": page("challenge", L, (w) => listScreen(w, "challenge"), 600); break;
      case "practice": page("practice", L, practiceScreen, 600); break;
      case "setup": page("setup", L, setupScreen, 600); break;
      case "results": page("results", L, resultsScreen, 600); break;
      case "scores": page("scores", L, scoresScreen, 700); break;
      case "help": page("help", L, helpScreen, 640); break;
      case "settings": page("settings", L, settingsScreen, 600); break;
    }
  }
  overlays(L);
  topbar(L);
  toasts(L);
  if (app.focusNext) {
    const age = f.frame - app.openedFrame;
    if (age >= 1) ui.setFocus(app.focusNext);
    if (age >= 3) app.focusNext = null;
  }
}

/** A box in a class over the street below the top bar: a placed role-"none" widget, so it covers what was built before it. */
function backdrop(cls: string, L: Layout): void {
  const f = frame();
  const top = topbarHeight();
  ui.place("backdrop", { anchor: "top-start", x: -f.safeArea.left / L.sc, y: -f.safeArea.top / L.sc }, () => {
    ui.widget("", { role: "none", size: { width: f.width / L.sc, height: f.height / L.sc }, draw: () => draw.box(0, top, f.width, f.height - top, cls) });
  });
}
/** A screen (index.html .screen): a centred column under the top bar, at most `width` wide, scrolling when taller than the room. */
function page(key: string, L: Layout, build: (w: number, L: Layout) => void, width: number): void {
  const pad = L.short ? 12 : 20;
  const outer = Math.min(width, L.lw - 24);
  const avail = Math.max(80, L.lh - TB - 8);
  const h = lastSize.get(key) ?? 0;
  const scroll = h > avail;
  const inner = outer - 2 * pad - (scroll ? 14 : 0);
  const opening = frame().frame - app.openedFrame <= 5;
  ui.place(`page-${key}`, { anchor: "top", y: TB + 4 }, () => {
    const body = (): void => {
      const r = ui.column(`${key}-col`, () => build(inner, L), { width: outer - (scroll ? 14 : 0), spacing: L.short ? 8 : 12, padding: pad, align: "center" });
      lastSize.set(key, r.height / L.sc);
    };
    if (scroll) ui.scrollArea(`${key}-scroll`, { width: outer, height: avail }, body, opening ? { scrollTo: { top: 0 } } : undefined);
    else body();
  });
}
const gap = (h: number): void => { ui.widget("", { role: "none", size: { width: 1, height: h } }); };

// ------------------------------------------------------------------ the top bar
function chip(id: string, text: string): void {
  ui.column(id, () => ui.style("chip-text").id(`${id}-t`).label(text), { style: "chip", align: "center" });
}
function topbar(L: Layout): void {
  const f = frame();
  const sa = f.safeArea;
  const signedIn = platform.signedIn();
  const sync = platform.syncState();
  const syncText = sync === "saving" ? T("Syncing…") : sync === "synced" ? T("Cloud synced") : sync === "offline" ? T("Cloud offline") : "";
  const clock = new Date(platform.nowMs()).toISOString().slice(11, 16) + " UTC";
  const r = ui.place("topbar", { anchor: "top-start", x: -sa.left / L.sc, y: -sa.top / L.sc }, () => {
    ui.row("topbar-row", () => {
      ui.style("brand").id("brand").label("METRO DASH");
      ui.spacer();
      chip("profile-chip", signedIn ? platform.displayName() || T("Guest") : T("Guest"));
      if (signedIn && syncText && L.lw > 460) chip("sync-chip", syncText);
      if (L.lw > 340) chip("clock-chip", clock);
      const muted = audio.isMuted();
      const pressed = ui.style("icon-btn").id("btn-audio-toggle").button(T("Toggle sound"), { selected: muted, content: () => ui.label(muted ? "∅" : "♪") });
      if (pressed && fresh()) later(toggleMute);
    }, {
      style: "topbar", width: f.width / L.sc, height: TB + sa.top / L.sc, spacing: 10, align: "center",
      padding: { top: 6 + sa.top / L.sc, bottom: 6, start: 12 + sa.left / L.sc, end: 12 + sa.right / L.sc },
    });
  });
  rect(r);
}

// ------------------------------------------------------------------ title
function titleScreen(w: number, L: Layout): void {
  const doc = save();
  const p = doc.progression;
  if (!L.short) gap(Math.min(48, L.lh * 0.06));
  const big = L.lw >= 640 && !L.short;
  heading(big ? "title" : "title-small", "Metro Dash", w, "title-h");
  para(T("Three lanes. One city. Dawn to night."), w, "tagline", "tagline");
  if (!L.short) gap(Math.min(24, L.lh * 0.03));
  const mw = Math.min(320, w);
  const list: Btn[] = [
    { id: "btn-play", text: T("Play Daily Run — {day}", { day: daily().day }), style: "btn-primary", act: () => selectContent(daily()) },
    { id: "btn-journey", text: T("Journey"), act: () => open("journey") },
    { id: "btn-learn", text: T("Learn"), act: () => open("learn") },
    { id: "btn-practice", text: T("Practice"), act: () => open("practice") },
    { id: "btn-challenge", text: T("Challenges"), act: () => open("challenge") },
    { id: "btn-scores", text: T("Scores"), act: () => open("scores") },
    { id: "btn-settings", text: T("Settings"), act: () => open("settings") },
    { id: "btn-help", text: T("How to Play"), act: () => open("help") },
  ];
  if (!platform.signedIn()) list.push({ id: "btn-signin", text: S("signIn"), act: signIn });
  if (platform.inviteLink()) list.push({ id: "btn-invite", text: S("invite"), act: copyInvite });
  if (L.short) flow("title-menu", list, w, 10);
  else stack("title-menu", list, mw, 10);
  para(T("Journey {done}/{stages} · Lessons {lessons}/{lessonTotal} · Total distance {distance}", {
    done: Object.keys(p.journeyCompleted).length, stages: Content.JOURNEY_STAGES.length, lessons: Object.keys(p.lessonsCompleted).length,
    lessonTotal: Content.LESSONS.length, distance: fmt(p.totalDistance),
  }), w, "muted", "title-progress");
}

// ------------------------------------------------------------------ journey, learn, challenges, practice
function backButton(w: number): void { stack("back-row", [{ id: "btn-back", text: T("Back"), act: back }], Math.min(w, Math.max(120, buttonWidth(T("Back"), "btn")))); }
function stars(score: number, par: number): string { return score >= par ? "★★★" : score >= par * 0.66 ? "★★" : "★"; }
function journeyScreen(w: number): void {
  heading("h2", T("Journey"), w, "journey-h");
  para(T("40 stages. New traffic mechanics arrive one at a time; every fifth stage is a mastery test."), w, "muted", "journey-note");
  const p = save().progression;
  const gw = Math.min(720, w);
  const cols = Math.max(2, Math.floor((gw + 10) / (88 + 10)));
  const cw = (gw - (cols - 1) * 10) / cols;
  const stages = Content.JOURNEY_STAGES;
  ui.column("journey-grid", () => {
    for (let r = 0; r * cols < stages.length; r++) {
      ui.row(`jg-${r}`, () => {
        for (let i = r * cols; i < Math.min(stages.length, (r + 1) * cols); i++) {
          const stage = stages[i]!;
          const unlocked = i === 0 || !!p.journeyCompleted[stages[i - 1]!.id];
          const done = p.journeyCompleted[stage.id];
          const cls = done ? (stage.mastery ? "stage-done-mastery" : "stage-done") : stage.mastery ? "stage-mastery" : "stage-card";
          const name = [T("Stage {n}", { n: i + 1 }), stage.mastery ? T("mastery") : "", done ? T("completed") : "", unlocked ? "" : T("locked")].filter(Boolean).join(", ");
          const face = (): void => {
            ui.label(stage.mastery ? `${i + 1} ★` : `${i + 1}`);
            if (done) ui.style("stars").label(stars(done.score, stage.par?.score ?? 0));
          };
          const opts: ui.ButtonOptions = { content: face };
          if (!unlocked) opts.disabled = true;
          if (ui.style(cls, { width: cw }).id(`stage-${i + 1}`).button(name, opts) && fresh() && unlocked) later(() => selectContent(stage));
        }
      }, { spacing: 10 });
    }
  }, { spacing: 10, width: gw });
  backButton(w);
}
function listScreen(w: number, kind: "learn" | "challenge"): void {
  const p = save().progression;
  const learn = kind === "learn";
  heading("h2", learn ? T("Learn") : T("Challenges"), w, `${kind}-h`);
  para(learn ? T("Interactive lessons. Each one teaches a single rule — and makes you use it.") : T("Constrained runs: restricted tools, move budgets, express speed."), w, "muted", `${kind}-note`);
  const items = learn ? Content.LESSONS : Content.CHALLENGES;
  const cw = Math.min(560, w);
  ui.column(`${kind}-list`, () => items.forEach((it, i) => {
    const mark = learn ? (p.lessonsCompleted[it.id] ? `✓ ${T("done")}` : "") : p.challengesCompleted[it.id] ? `✓ ${fmt(p.challengesCompleted[it.id]!.score)}` : "";
    const title = T(it.label ?? "");
    const brief = T(it.briefing ?? "");
    const inner = cw - 34;
    const face = (): void => {
      ui.row(`${kind}-${i}-head`, () => {
        para(title, inner - (mark ? textWidth(mark, "done-mark") + 12 : 0), "strong", undefined, "start");
        ui.spacer();
        if (mark) ui.style("done-mark").label(mark);
      }, { width: inner, align: "center" });
      para(brief, inner, "small-muted", undefined, "start");
    };
    if (ui.style("card", { width: cw }).id(`${learn ? "lesson" : "challenge"}-${i}`).button(title, { content: face }) && fresh()) later(() => selectContent(it));
  }), { spacing: 10, width: cw });
  backButton(w);
}
function practiceScreen(w: number): void {
  heading("h2", T("Practice"), w, "practice-h");
  para(T("Unranked. Rewind allowed. No effect on ratings or boards."), w, "muted", "practice-note");
  ui.column("practice-difficulty", () => {
    para(T("Difficulty"), w - 40, "legend", "difficulty-legend");
    flow("diff-row", Object.entries(PRACTICE_LEVELS).map(([id, label]) => ({
      id: `diff-${id}`, text: T(label), style: "btn-small", selected: app.difficulty === id, act: () => { app.difficulty = id; audio.event("ui"); },
    })), Math.min(w - 40, 420), 10);
  }, { style: "fieldset", spacing: 8, width: Math.min(w, 460), align: "center" });
  flow("practice-btns", [
    { id: "btn-practice-start", text: T("Start Practice"), style: "btn-primary", act: startPractice },
    { id: "btn-back", text: T("Back"), act: back },
  ], w);
}

// ------------------------------------------------------------------ the briefing
function setupScreen(w: number): void {
  const c = app.pending;
  if (!c) return;
  heading("h2", contentLabel(c), w, "setup-h");
  const goal = c.config.goal;
  const rows: [string, string][] = [
    [T("Mode"), T(MODE_NAMES[c.kind] ?? c.kind)],
    [T("Objective"), goal
      ? goal.type === "distance" ? T("Reach {n} units", { n: fmt(goal.value) })
        : goal.type === "coins" ? T("Collect {n} tokens", { n: goal.value })
          : T("Perform {n}× {action}", { n: goal.value, action: T(ACTION_WORDS[goal.action!] ?? goal.action!) })
      : T("Endless — survive and score")],
    [T("Speed"), `${Math.round((c.config.speedScale || 1) * 100)}%`],
    [T("Expected"), goal ? T("~{n} min", { n: Math.max(1, Math.round((c.par?.ticks || 1200) / Rules.TICKS_PER_SECOND / 60)) }) : T("1–5 min")],
    [T("Players"), "1"],
    [T("Ranked"), c.kind === "daily" ? T("Yes (daily board)") : c.kind === "practice" ? T("No") : T("Local board")],
  ];
  if (c.config.movesLimit) rows.push([T("Move budget"), String(c.config.movesLimit)]);
  if (c.config.allowedActions && c.config.allowedActions.length < 5) {
    rows.push([T("Allowed moves"), c.config.allowedActions.filter((a) => a !== "wait").map((a) => T(ACTION_WORDS[a] ?? a)).join(", ")]);
  }
  if (c.introduces && c.introduces.length) rows.push([T("New mechanic"), c.introduces.map((m) => T(m)).join(", ")]);
  const fw = Math.min(w, 420);
  const dtw = Math.min(fw * 0.45, Math.max(...rows.map(([k]) => textWidth(k, "facts-dt"))) + 6);
  ui.column("setup-facts", () => rows.forEach(([k, v], i) => ui.row(`fact-${i}`, () => {
    ui.column(`fact-${i}-k`, () => para(k, dtw, "facts-dt", undefined, "start"), { width: dtw });
    ui.column(`fact-${i}-v`, () => para(v, fw - dtw - 18, "facts-dd", `fact-${i}-v`, "start"), { width: fw - dtw - 18 });
  }, { spacing: 18, width: fw })), { spacing: 4, width: fw });
  if (c.briefing) para(T(c.briefing), w, "body", "setup-briefing");
  flow("setup-btns", [
    { id: "btn-setup-start", text: T("Start"), style: "btn-primary", act: startPending },
    { id: "btn-back", text: T("Back"), act: back },
  ], w);
}

// ------------------------------------------------------------------ results
/** A table (index.html <table>): rows of cells at the given widths. */
function table(id: string, widths: number[], head: string[] | null, rows: { cells: string[]; cls?: string; total?: boolean }[], compact = false): void {
  const w = widths.reduce((a, b) => a + b, 0);
  const pad = compact ? 14 : 32;
  const tr = (key: string, cells: string[], cls: string, rowCls: string): void => {
    ui.row(key, () => cells.forEach((c, i) => ui.column(`${key}-${i}`, () => para(c, widths[i]! - pad, cls, undefined, "start"), { width: widths[i]! - pad })),
      { style: rowCls, width: w, spacing: pad, align: "center" });
  };
  ui.column(id, () => {
    if (head) tr(`${id}-head`, head, "th", compact ? "tr-compact" : "tr");
    rows.forEach((r, i) => tr(`${id}-${i}`, r.cells, r.cls ?? "td", r.total ? "tr-total" : compact ? "tr-compact" : "tr"));
  }, { spacing: 0, width: w });
}
function resultsScreen(w: number, L: Layout): void {
  const R = app.results;
  if (!R) return;
  const r = R.result;
  heading(L.short ? "h2-small" : "h2", resultsTitle(), w, "results-h");
  if (!ui.preferences().highContrast) {
    // the decorative token emblem (style.css #results-emblem: a round 84 px badge, 52 px in a short window)
    const sz = L.short ? 52 : 84;
    ui.style("emblem").widget("", { role: "none", size: { width: sz, height: sz } });
  }
  para(resultsHeadline(), w, "headline", "results-headline");
  const tw = Math.min(420, w);
  const c2 = Math.max(90, textWidth(T("Points"), "th") + 40);
  table("results-table", [tw - c2, c2], [T("Component"), T("Points")], [
    { cells: [`${T("Distance")} (${T("{n} units", { n: fmt(r.distance) })})`, fmt(r.components.distance)], cls: "td-strong" },
    { cells: [T("Clean dodges"), fmt(r.components.dodge)], cls: "td-strong" },
    { cells: [`${T("Tokens")} (${T("{n} collected", { n: r.stats.coins })})`, fmt(r.components.collect)], cls: "td-strong" },
    { cells: [T("Total"), fmt(r.score)], cls: "td-total", total: true },
  ]);
  const comparison = R.isBest ? T("New personal best for this board!") : R.bestScore != null ? T("Personal best: {n}", { n: fmt(R.bestScore) }) : "";
  para(comparison, w, "muted", "results-comparison");
  const lb = leaderboardLine();
  if (lb) para(lb, w, "muted", "results-lb");
  if (R.newAchievements.length) {
    para(T("Achievements: {names}", { names: R.newAchievements.map((k) => T(Content.ACHIEVEMENTS.find((a) => a.key === k)?.label ?? k)).join(" · ") }), w, "achievements", "results-achievements");
  }
  const list: Btn[] = [{ id: "btn-retry", text: T("Retry"), style: "btn-primary", act: retry }];
  if (R.nextContent) list.push({ id: "btn-next", text: T("Next Stage"), act: nextStage });
  list.push({ id: "btn-results-menu", text: T("Menu"), act: resultsMenu });
  flow("results-btns", list, w);
}

// ------------------------------------------------------------------ scores
function scoresScreen(w: number, L: Layout): void {
  heading("h2", T("Scores"), w, "scores-h");
  const filters: [typeof app.scoreFilter, string][] = [["all", N("All Runs")], ["daily", N("Daily")], ["mine", N("Mine")]];
  flow("score-filters", filters.map(([id, label]) => ({
    id: `filter-${id}`, text: T(label), style: "btn-small", selected: app.scoreFilter === id, act: () => { app.scoreFilter = id; audio.event("ui"); },
  })), w, 12);
  para(T("Local board (casual) — global validation requires hosting."), w, "muted", "scores-note");
  let entries: Entry[] = save().leaderboard.entries.slice();
  if (app.scoreFilter === "daily") entries = entries.filter((e) => e.mode === "daily");
  if (app.scoreFilter === "mine") entries = entries.filter((e) => e.mine);
  entries.sort((a, b) => b.score - a.score);
  const compact = L.portrait || w < 520;
  const tw = Math.min(w, 640);
  if (!entries.length) {
    table("scores-table", [tw], null, [{ cells: [T("No runs yet. Go play!")] }], compact);
  } else {
    const fr = [0.08, 0.17, 0.33, 0.18, 0.24];
    table("scores-table", fr.map((f) => tw * f), ["#", T("Score"), T("Mode"), T("Distance"), T("Date")], entries.slice(0, 50).map((e, i) => ({
      cells: [String(i + 1), fmt(e.score), T(MODE_NAMES[e.mode] ?? e.mode) + (e.day ? ` ${e.day}` : ""), fmt(e.distance), dateText(e.when)],
      cls: compact ? (e.mine ? "td-small-mine" : "td-small") : e.mine ? "td-mine" : "td",
    })), compact);
  }
  backButton(w);
}
function dateText(ms: number): string {
  try { return new Date(ms).toLocaleDateString(currentLang()); } catch { return new Date(ms).toISOString().slice(0, 10); }
}
function currentLang(): string { return (globalThis as unknown as { MDI18N?: { lang: string } }).MDI18N?.lang ?? "en-US"; }

// ------------------------------------------------------------------ how to play
const KEY_GLYPHS: Record<string, string> = { "Arrow Up": "Up", "Arrow Down": "Down", "Arrow Left": "Left", "Arrow Right": "Right", Escape: "Escape" };
/** The effective keys of an action, e.g. "Left / A" (ui.js bindingLabel). */
export function keysFor(action: string): string {
  let list: string[] = [];
  try { list = bindings(action).filter((b) => b.device === "keyboard").map((b) => KEY_GLYPHS[b.label] ?? b.label); } catch { /* not yet */ }
  return [...new Set(list)].join(" / ") || "—";
}
const RULES = [
  N("<strong>Barrier</strong> (striped, low) — jump over it or change lane."),
  N("<strong>Sign</strong> (overhead panel) — slide under it or change lane."),
  N("<strong>Kiosk</strong> (full height) — change lane; jumping and sliding won't help."),
  N("<strong>Tokens</strong> — score bonus; high tokens need a jump."),
  N("Speed rises with distance. One crash ends the run."),
];
function helpScreen(w: number): void {
  heading("h2", T("How to Play"), w, "help-h");
  const items: [string, string, string][] = [
    [T("Move left"), keysFor("left"), T("Also: swipe left, tap ◀, or gamepad D-pad")],
    [T("Move right"), keysFor("right"), T("Also: swipe right, tap ▶, or gamepad D-pad")],
    [T("Jump"), keysFor("jump"), T("Also: swipe up, tap ▲, or gamepad A")],
    [T("Slide"), keysFor("slide"), T("Also: swipe down, tap ▼, or gamepad B")],
    [T("Pause"), keysFor("pause"), T("Resume is always the first option")],
  ];
  const cw = Math.min(560, w);
  const inner = cw - 34;
  ui.column("help-cards", () => items.forEach(([name, keys, alt], i) => {
    ui.column(`help-${i}`, () => {
      ui.row(`help-${i}-head`, () => {
        ui.style("strong").label(`${name}:`);
        ui.column(`help-${i}-kbd`, () => ui.style("kbd-text").id(`help-${i}-keys`).label(keys), { style: "kbd" });
      }, { spacing: 8, align: "center", width: inner });
      para(alt, inner, "small-muted", undefined, "start");
    }, { style: "help-card", spacing: 4, width: cw });
  }), { spacing: 10, width: cw });
  heading("h3", T("Rules"), w, "rules-h");
  ui.column("help-rules", () => RULES.forEach((k, i) => para(`• ${T(k).replace(/<[^>]+>/g, "")}`, cw, "body", `rule-${i}`, "start")), { spacing: 6, width: cw });
  backButton(w);
}

// ------------------------------------------------------------------ settings
const PALETTES: [string, string][] = [
  ["standard", N("Standard")], ["deuteranopia", N("Deuteranopia-safe")], ["protanopia", N("Protanopia-safe")], ["tritanopia", N("Tritanopia-safe")],
];
function fieldset(id: string, legend: string, w: number, build: (inner: number) => void): void {
  ui.column(id, () => { para(legend, w - 34, "legend", `${id}-legend`, "start"); build(w - 34); }, { style: "fieldset", spacing: 10, width: w });
}
function settingsScreen(w: number): void {
  heading("h2", T("Settings"), w, "settings-h");
  const fw = Math.min(560, w);
  const o = platform.options;
  fieldset("set-runtime", T("Audio"), fw, (iw) => {
    para(T("Sound, graphics, language, larger text, high contrast and reduced motion are in the StarHermit Options."), iw, "muted", "options-note", "start");
    flow("settings-runtime", [
      { id: "btn-options", text: T("Open Options"), act: () => openMenu() },
      { id: "btn-rebind", text: T("Key bindings"), act: () => requestRebind() },
    ], iw, 10);
  });
  fieldset("set-display", T("Display"), fw, (iw) => {
    const idx = Math.max(0, PALETTES.findIndex(([id]) => id === o.colorPalette));
    para(T("Color palette"), iw, "body", "palette-label", "start");
    const pick = ui.id("set-palette").select(T("Color palette"), idx, PALETTES.map(([, l]) => T(l)), { width: Math.min(iw, 320) } as ui.WidgetOptions);
    if (pick !== idx) later(() => { const id = PALETTES[pick]![0]; if (Save.PALETTES.includes(id)) platform.setOption("colorPalette", id); audio.event("ui"); });
  });
  fieldset("set-access", T("Accessibility & Controls"), fw, () => {
    const check = (key: "leftHanded" | "hints", text: string): void => {
      const cur = !!o[key];
      const next = ui.id(`set-${key}`).checkbox(T(text), cur);
      if (next !== cur) later(() => { platform.setOption(key, next); audio.event("ui"); });
    };
    check("leftHanded", N("Left-handed touch tray"));
    check("hints", N("Show hints"));
  });
  fieldset("set-data", T("Data"), fw, (iw) => {
    if (!app.confirmReset) {
      flow("reset-row", [{ id: "btn-reset-data", text: T("Reset local progress"), style: "btn-small-danger", act: () => { app.confirmReset = true; app.focusNext = "btn-reset-cancel"; app.openedFrame = frame().frame; } }], iw, 10);
    } else {
      para(T("Reset all local progress, scores, and achievements?"), iw, "body", "reset-confirm", "start");
      flow("reset-confirm-row", [
        { id: "btn-reset-yes", text: T("Reset"), style: "btn-small-danger", act: resetProgress },
        { id: "btn-reset-cancel", text: T("Cancel"), style: "btn-small", act: () => { app.confirmReset = false; } },
      ], iw, 10);
    }
  });
  backButton(w);
}

// ------------------------------------------------------------------ the run's HUD
function pauseBars(): void {
  ui.widget("", {
    role: "none", size: { width: 14, height: 16 },
    draw: (r, s) => {
      const c = s.highContrast ? "#ffffff" : "#eef1f8";
      const bw = r.width * 0.32;
      draw.box(r.x, r.y, bw, r.height, { background: c, radius: 1 });
      draw.box(r.x + r.width - bw, r.y, bw, r.height, { background: c, radius: 1 });
    },
  });
}
function runScreen(L: Layout): void {
  const s = app.session, c = app.content;
  if (!s || !c) return;
  const st = s.state;
  const f = frame();
  const sa = f.safeArea;
  const live = app.game === "active" && app.overlay === null;
  const top = TB + 10;
  const railPad = L.short ? 8 : 10;
  // #hud-left: the objective, its progress, the move budget
  const leftW = L.portrait ? Math.min(L.lw * 0.46, 240) : L.compact || L.short ? 230 : 290;
  const objCls = L.short ? "objective-small" : "objective";
  const pct = objectiveProgress(c, st);
  ui.place("hud-left", { anchor: "top-start", x: 10, y: top }, () => {
    ui.column("hud-left-col", () => {
      ui.style("rail-heading").id("hud-objective-label").heading(T("Objective").toUpperCase());
      para(objectiveText(c, st), leftW - 2 * (railPad + 4), objCls, "hud-objective", "start");
      ui.widget(T("Objective progress"), {
        role: "meter", size: { width: leftW - 2 * (railPad + 4), height: 6 }, value: Math.round(pct * 100), min: 0, max: 100,
        draw: (rr, ws) => {
          draw.box(rr.x, rr.y, rr.width, rr.height, { background: "#ffffff22", radius: 3 });
          if (pct > 0) draw.box(rr.x, rr.y, Math.max(rr.height, rr.width * pct), rr.height, { background: ws.highContrast ? "#ffe14d" : "#ffc94d", radius: 3 });
        },
      });
      if (st.movesLeft !== null) ui.style("moves").id("hud-moves").label(T("Moves left: {n}", { n: st.movesLeft }));
    }, { style: L.short ? "hud-rail-small" : "hud-rail", width: leftW, spacing: 6 });
  });
  // #hud-right: score, distance, tokens, speed (labels hidden on a portrait phone)
  const stats: [string, string, boolean][] = [
    [T("Score"), fmt(Rules.totalScore(st)), true], [T("Distance"), fmt(st.distance), false], [T("Tokens"), String(st.stats.coins), false],
    [T("Speed"), `${(Rules.speedAt(st.distance, st.config) * Rules.TICKS_PER_SECOND).toFixed(0)} u/s`, false],
  ];
  ui.place("hud-right", { anchor: "top-end", x: 10, y: top }, () => {
    ui.column("hud-stats", () => stats.forEach(([k, v, score], i) => {
      const id = ["hud-score", "hud-distance", "hud-coins", "hud-speed"][i]!;
      if (L.portrait) ui.style(score ? "stat-score-small" : "stat-dd-small").id(id).label(v);
      else ui.row(`${id}-row`, () => {
        ui.style("stat-dt").label(k);
        ui.spacer();
        ui.style(score ? "stat-score" : "stat-dd").id(id).label(v);
      }, { spacing: 10, width: L.short ? 150 : 170, align: "center" });
    }), { style: L.short ? "hud-rail-small" : "hud-rail", spacing: 2 });
  });
  // the pause button: top centre, above the tray on a portrait phone
  const tray = touchOnly();
  const pr = ui.place("hud-pause", L.portrait ? { anchor: "bottom-end", x: 10, y: tray ? 96 : 16 } : { anchor: "top", y: top }, () => {
    const opts: ui.ButtonOptions = { content: pauseBars };
    if (!live) opts.disabled = true;
    if (ui.style("icon-btn").id("btn-pause").button(T("Pause (Esc)"), opts) && fresh() && live) later(() => { ui.setFocus(null); pauseGame(); });
  });
  rect(pr);
  // #action-tray (touch screens): ◀ ▲ ▼ ▶, mirrored for the left-handed, at the side in a short landscape window
  if (tray) {
    let btns: [string, string, string][] = [["left", "◀", N("Move left")], ["jump", "▲", N("Jump")], ["slide", "▼", N("Slide")], ["right", "▶", N("Move right")]];
    const lefty = platform.options.leftHanded;
    if (lefty) btns = btns.slice().reverse();
    const at = L.short ? { anchor: (lefty ? "bottom-start" : "bottom-end") as ui.Anchor, x: 12, y: 12 } : { anchor: "bottom" as ui.Anchor, y: 12 };
    const tr = ui.place("tray", at, () => ui.row("action-tray", () => {
      for (const [action, glyph, name] of btns) {
        const opts: ui.ButtonOptions = { content: () => ui.label(glyph) };
        if (!live) opts.disabled = true;
        if (ui.style("tray-btn").id(`tray-${action}`).button(T(name), opts) && fresh() && live) later(() => { ui.setFocus(null); doAction(action); });
      }
    }, { spacing: 12 }));
    rect(tr);
  }
  // the countdown over a dim of the street
  if (app.countdown) {
    const top0 = topbarHeight();
    ui.place("countdown-dim", { anchor: "top-start", x: -sa.left / L.sc, y: -sa.top / L.sc }, () => {
      ui.widget("", { role: "none", size: { width: f.width / L.sc, height: f.height / L.sc }, draw: () => draw.box(0, top0, f.width, f.height - top0, "overlay") });
    });
    const size = Math.max(64, Math.min(144, L.lw * 0.18));
    ui.place("countdown", "center", () => ui.style("countdown", { text: { size } }).id("countdown-text").label(app.countdown!.text));
  }
}

// ------------------------------------------------------------------ the pause panel and "Welcome back"
function overlays(L: Layout): void {
  const o = app.overlay;
  if (!o || app.screen !== null) return;
  const w = Math.min(o === "pause" && L.short ? 520 : 360, L.lw - 32) - 58;
  const label = o === "pause" ? T("Paused") : T("Welcome back");
  const isOpen = ui.dialog(label, "", true, () => {
    const body = (): void => { ui.column(`${o}-col`, () => (o === "pause" ? pausePanel(w, L) : interruptPanel(w)), { spacing: L.short ? 6 : 10, width: w, align: "center" }); };
    const h = lastSize.get(o) ?? 0;
    const avail = L.lh - 72;
    if (h > avail) ui.scrollArea(`${o}-scroll`, { width: w + 14, height: avail }, () => {
      const r = ui.column(`${o}-wrap`, body, { width: w });
      lastSize.set(o, r.height / L.sc);
    });
    else { const r = ui.column(`${o}-wrap`, body, { width: w }); lastSize.set(o, r.height / L.sc); }
  });
  // Escape closes the panel as the old Escape resumed the run (not on the frame it opened: that press opened it).
  if (!isOpen && fresh()) later(resumeGame);
}
function pausePanel(w: number, L: Layout): void {
  heading(L.short ? "h2-small" : "h2", T("Paused"), w, "pause-h");
  const list: Btn[] = [{ id: "btn-resume", text: T("Resume"), style: "btn-primary", act: () => { audio.event("ui"); resumeGame(); } }];
  if (canRewind()) list.push({ id: "btn-rewind", text: T("Rewind 5s"), act: rewindRun });
  list.push(
    { id: "btn-pause-settings", text: T("Settings"), act: () => open("settings") },
    { id: "btn-pause-help", text: T("How to Play"), act: () => open("help") },
    { id: "btn-pause-restart", text: T("Restart"), act: restartRun },
    { id: "btn-pause-quit", text: T("End Run"), style: "btn-danger", act: quitRun },
  );
  if (L.short) {
    // six pause actions fit a short landscape window in two columns
    const cw = (w - 8) / 2;
    ui.column("pause-grid", () => {
      for (let i = 0; i < list.length; i += 2) ui.row(`pause-r${i}`, () => { for (const b of list.slice(i, i + 2)) button(b, cw); }, { spacing: 8 });
    }, { spacing: 6, width: w });
  } else stack("pause-menu", list, w);
}
function interruptPanel(w: number): void {
  heading("h2", T("Welcome back"), w, "interrupt-h");
  if (app.interrupt) para(app.interrupt(), w, "body", "interrupt-summary");
  stack("interrupt-menu", [
    { id: "btn-interrupt-resume", text: T("Resume run"), style: "btn-primary", act: resumeGame },
    { id: "btn-interrupt-abandon", text: T("Abandon run"), act: quitRun },
  ], w);
}

// ------------------------------------------------------------------ toasts
function toasts(L: Layout): void {
  if (!app.toasts.length) return;
  const w = Math.min(L.lw - 24, 480);
  ui.place("toasts", { anchor: "top", y: TB + 8 }, () => ui.column("toast-stack", () => app.toasts.forEach((t, i) => {
    ui.column(`toast-${i}`, () => para(t.text, w - 40, "toast-text", `toast-${i}-t`), { style: "toast", align: "center" });
  }), { spacing: 8, align: "center" }));
}
