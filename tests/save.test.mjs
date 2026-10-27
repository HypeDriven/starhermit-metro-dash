// The save document (js/save.js): the browser build's cloud mirror read as a
// foreign save, merges that lose nothing (as main.js applyCloudDoc did), the
// game's own options picked from the old settings and the legacy KV keys.
// Run: node --test tests/save.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, merge, same, readForeign, pickOptions, OPTION_KEYS, BROWSER_KEYS, DEFAULT_OPTIONS } from '../js/save.js';

const entry = (o) => ({ name: 'You', mine: true, score: 100, distance: 900, ticks: 600, invalid: 0, mode: 'journey', day: null, seed: 1, ruleset: 'v1', assists: 'hints', sessionId: 's1', when: 1, ...o });

test('the browser build\'s cloud mirror (saveJSON text) reads as a save without its settings', () => {
  const old = {
    v: 1,
    settings: { music: 0.4, colorPalette: 'tritanopia', bindings: { left: ['KeyQ'] } },
    progression: { journeyCompleted: { 'journey-01': { score: 120, ticks: 700 } }, lessonsCompleted: { 'learn-jump': true }, challengesCompleted: {},
      totalDistance: 4321, totalRuns: 7, dailyDays: ['2026-10-01'], bestDaily: { '2026-10-01': 345 } },
    achievements: { unlocked: { first_finish: '2026-10-01T10:00:00.000Z' } },
    leaderboard: { entries: [entry({})] },
  };
  const doc = readForeign(JSON.stringify(old));
  assert.equal(doc.v, 1);
  assert.equal(doc.settings, undefined);
  assert.deepEqual(doc.progression.journeyCompleted, { 'journey-01': { score: 120, ticks: 700 } });
  assert.equal(doc.progression.totalDistance, 4321);
  assert.deepEqual(doc.progression.bestDaily, { '2026-10-01': 345 });
  assert.equal(doc.achievements.unlocked.first_finish, '2026-10-01T10:00:00.000Z');
  assert.equal(doc.leaderboard.entries.length, 1);
  assert.equal(readForeign('not json'), null);
  assert.equal(readForeign(JSON.stringify({ hello: 1 })), null);
  assert.equal(readForeign(null), null);
});

test('normalize repairs broken documents', () => {
  const d = normalize({ progression: { totalDistance: 'x', dailyDays: ['b', 'a', 'a', 3], lessonsCompleted: { a: 1, b: 0 } }, leaderboard: { entries: [{ score: 'no' }, entry({})] } });
  assert.equal(d.progression.totalDistance, 0);
  assert.deepEqual(d.progression.dailyDays, ['a', 'b']);
  assert.deepEqual(d.progression.lessonsCompleted, { a: true });
  assert.equal(d.leaderboard.entries.length, 1);
  assert.deepEqual(normalize(null), normalize({}));
});

test('merging two devices keeps the best of each and loses nothing', () => {
  const a = normalize({
    progression: { journeyCompleted: { j1: { score: 100 }, j2: { score: 50 } }, lessonsCompleted: { l1: true }, challengesCompleted: { c1: { score: 300 } },
      totalDistance: 1000, totalRuns: 3, dailyDays: ['2026-10-02'], bestDaily: { '2026-10-02': 10 } },
    achievements: { unlocked: { first_finish: '2026-10-05T00:00:00.000Z' } },
    leaderboard: { entries: [entry({ sessionId: 'a' })] },
  });
  const b = normalize({
    progression: { journeyCompleted: { j1: { score: 140 }, j3: { score: 20 } }, lessonsCompleted: { l2: true }, challengesCompleted: { c1: { score: 200 } },
      totalDistance: 2000, totalRuns: 2, dailyDays: ['2026-10-01', '2026-10-02'], bestDaily: { '2026-10-02': 30, '2026-10-01': 5 } },
    achievements: { unlocked: { first_finish: '2026-10-01T00:00:00.000Z', streak_3: '2026-10-03T00:00:00.000Z' } },
    leaderboard: { entries: [entry({ sessionId: 'a' }), entry({ sessionId: 'b', score: 900 })] },
  });
  const m = merge(a, b);
  assert.deepEqual(Object.keys(m.progression.journeyCompleted).sort(), ['j1', 'j2', 'j3']);
  assert.equal(m.progression.journeyCompleted.j1.score, 140);
  assert.equal(m.progression.challengesCompleted.c1.score, 300);
  assert.deepEqual(m.progression.lessonsCompleted, { l1: true, l2: true });
  assert.equal(m.progression.totalDistance, 2000);
  assert.equal(m.progression.totalRuns, 3);
  assert.deepEqual(m.progression.dailyDays, ['2026-10-01', '2026-10-02']);
  assert.deepEqual(m.progression.bestDaily, { '2026-10-02': 30, '2026-10-01': 5 });
  assert.equal(m.achievements.unlocked.first_finish, '2026-10-01T00:00:00.000Z');
  assert.ok(m.achievements.unlocked.streak_3);
  assert.deepEqual(m.leaderboard.entries.map((e) => e.sessionId).sort(), ['a', 'b']);
  assert.ok(same(merge(m, b), m), 'merging again changes nothing');
  const r = merge(b, a);
  assert.deepEqual(r.progression.journeyCompleted, m.progression.journeyCompleted, 'order does not matter for the data');
  assert.deepEqual(r.achievements.unlocked, m.achievements.unlocked);
  assert.equal(r.leaderboard.entries.length, m.leaderboard.entries.length);
});

test('the game\'s own options from the old settings; the legacy KV keys to remove', () => {
  assert.deepEqual(OPTION_KEYS, ['colorPalette', 'leftHanded', 'hints']);
  assert.deepEqual(DEFAULT_OPTIONS, { colorPalette: 'standard', leftHanded: false, hints: true });
  assert.deepEqual(pickOptions({ colorPalette: 'protanopia', leftHanded: true, hints: false, music: 0.3 }), { colorPalette: 'protanopia', leftHanded: true, hints: false });
  assert.deepEqual(pickOptions({ colorPalette: 'purple', leftHanded: 'yes' }), {});
  for (const k of ['music', 'effects', 'ambience', 'voice', 'graphics', 'quality', 'reducedMotion', 'highContrast', 'largeText', 'colorPalette', 'leftHanded', 'hints', 'consent', 'ui.language', 'audio.options']) {
    assert.ok(BROWSER_KEYS.includes(k), k);
  }
  assert.ok(!BROWSER_KEYS.includes('bindings'));
});
