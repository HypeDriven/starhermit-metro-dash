// StarHermit adapter (js/platform.js) over the real shared SDK with a stubbed
// fetch and launch fragment.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Platform } from '../js/platform.js';

const SDK_SRC = fs.readFileSync(new URL('../starhermit-sdk.js', import.meta.url), 'utf8');
function loadSdk() {
  const mod = { exports: {} };
  new Function('module', 'exports', 'self', SDK_SRC)(mod, mod.exports, globalThis);
  return mod.exports;
}

const USER = 'a1b2c3d4-0000-4000-8000-000000000001';
const SLUG = 'metro-dash';

function fixture(href) {
  const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64url({ alg: 'none' })}.${b64url({ sub: USER, game_scope: SLUG, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
  const u = new URL(href.replace('{jwt}', jwt));
  const win = {
    location: { href: u.href, hostname: u.hostname, pathname: u.pathname, search: u.search, hash: u.hash, origin: u.origin, assign() {} },
    history: { state: null, replaceState(_s, _t, url) { win.replaced = url; } },
  };
  const calls = [];
  let slot = null;
  let version = 0; // the slot's ETag is "v<version>"; writes are conditional on it
  const kv = { music: 0.2 };
  let controls = [];
  const res = (status, body, bytes) => ({
    ok: status >= 200 && status < 300, status,
    text: async () => (body == null ? '' : JSON.stringify(body)),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    const headers = init.headers || {};
    calls.push({ url, method, body, auth: headers.Authorization, ifMatch: headers['If-Match'] });
    if (url === `/api/v1/users/${USER}/profile`) return res(200, { nickname: 'Rail Runner', username: 'hidden' });
    if (url === `/api/v1/me/cloud-saves/${encodeURIComponent('game:' + SLUG)}/info`) {
      return res(200, slot ? { exists: true, etag: `"v${version}"` } : { exists: false });
    }
    if (url === `/api/v1/me/cloud-saves/${encodeURIComponent('game:' + SLUG)}`) {
      if (method === 'PUT') {
        const cur = slot ? `"v${version}"` : null;
        if (headers['If-Match'] && headers['If-Match'] !== cur) return res(412, { error: 'precondition failed', etag: cur });
        if (headers['If-None-Match'] === '*' && slot) return res(412, { error: 'precondition failed', etag: cur });
        slot = new Uint8Array(Buffer.from(body.dataBase64, 'base64'));
        version++;
        return res(200, { etag: `"v${version}"` });
      }
      return slot ? res(200, null, slot) : res(404);
    }
    if (url === `/api/v1/games/${SLUG}/settings`) {
      if (method === 'PATCH') Object.assign(kv, body.settings);
      return res(200, { settings: kv });
    }
    if (url === `/api/v1/games/${SLUG}/controls`) {
      if (method === 'PUT') { controls = Object.entries(body.bindings).map(([action, codes]) => ({ action, codes })); return res(200, { actions: controls }); }
      if (method === 'DELETE') { controls = []; return res(204); }
      return res(200, { actions: controls });
    }
    return res(404);
  };
  const setTimeout = (fn, ms) => { const t = globalThis.setTimeout(fn, ms); t.unref(); return t; };
  const sh = loadSdk().create({ window: win, fetch, setTimeout, clearTimeout });
  // Another device writes the slot (bumps the version behind this client's back).
  const writeElsewhere = (doc) => { slot = new Uint8Array(zipStored(JSON.stringify(doc))); version++; };
  return { sh, win, calls, kv, hostname: u.hostname, writeElsewhere };
}

/* A minimal stored (uncompressed) zip with one save.json entry, as the platform serves it. */
function zipStored(text) {
  const data = Buffer.from(text, 'utf8');
  const name = Buffer.from('save.json');
  let c = ~0;
  for (const b of data) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  const crc = (~c) >>> 0;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + data.length, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

test('hosted: token read + stripped, nickname, cloud save at game:<slug>, no dev routes', async () => {
  const f = fixture('https://metro-dash.starhermit.com/#game_token={jwt}');
  const p = new Platform({ sh: f.sh, hostname: f.hostname });
  assert.equal(p.hosted, true);
  assert.equal(p.gameKey, SLUG);
  assert.ok(!String(f.win.replaced).includes('game_token'));
  assert.equal(await p.init(), null); // no remote save yet
  assert.equal(p.nickname, 'Rail Runner');
  p.getCloudDoc = () => ({ v: 1, progression: { totalRuns: 3 } });
  p.scheduleCloudSave();
  await p.flushCloudSave();
  const put = f.calls.find((c) => c.method === 'PUT');
  assert.equal(put.url, '/api/v1/me/cloud-saves/game%3Ametro-dash');
  assert.deepEqual(await p.init(), { v: 1, progression: { totalRuns: 3 } });
  assert.equal(p.syncState, 'synced');
  assert.equal(await p.submitDaily({}, '2026-10-03'), null); // own backend only on localhost
  assert.ok(f.calls.every((c) => /^Bearer /.test(c.auth) && !c.url.includes('/time') && !c.url.includes('/daily')));
});

test('hosted: settings KV patch excludes bindings; controls saved, loaded and reset', async () => {
  const f = fixture('https://x.example/#game_token={jwt}');
  const p = new Platform({ sh: f.sh, hostname: f.hostname });
  assert.deepEqual(await p.loadSettings(), { music: 0.2 });
  p.primeSettings({ music: 0.2, hints: true, bindings: null });
  p.pushSettings({ music: 0.2, hints: false, bindings: { jump: ['KeyJ'] } });
  await p.flushSettings();
  const patch = f.calls.find((c) => c.method === 'PATCH');
  assert.equal(patch.url, `/api/v1/games/${SLUG}/settings`);
  assert.deepEqual(patch.body, { settings: { hints: false } });
  assert.equal(f.kv.hints, false);
  await p.saveBindings({ jump: ['KeyJ'], slide: ['KeyS'] });
  assert.deepEqual(await p.loadBindings({ jump: ['Space'], slide: ['ArrowDown'], pause: ['KeyP'] }),
    { jump: ['KeyJ'], slide: ['KeyS'], pause: ['KeyP'] });
  await p.resetBindings();
  assert.deepEqual(await p.loadBindings({ jump: ['Space'] }), { jump: ['Space'] });
  assert.equal(p.inviteLink(), `https://dashboard.starhermit.com/game-invite/${USER}/${SLUG}`);
});

test('standalone: zero platform fetches; sign-in only on the platform host', async () => {
  const f = fixture('https://0b9d6f2e-3c4a-4e5b-9a7c-1d2e3f405162.starhermit.com/');
  const p = new Platform({ sh: f.sh, hostname: f.hostname });
  assert.equal(p.hosted, false);
  assert.equal(await p.init(), null);
  assert.deepEqual(await p.loadSettings(), {});
  assert.deepEqual(await p.loadBindings({ jump: ['Space'] }), { jump: ['Space'] });
  p.getCloudDoc = () => ({ v: 1 });
  p.scheduleCloudSave();
  await p.flushCloudSave();
  p.primeSettings({});
  p.pushSettings({ music: 1 });
  await p.saveBindings({ jump: ['KeyJ'] });
  assert.equal(p.canSignIn(), true);
  assert.equal(p.inviteLink(), null);
  assert.deepEqual(await p.submitScore(1200), { posted: false, rank: null });
  assert.equal(f.calls.length, 0);
  const local = fixture('http://localhost:8080/');
  assert.equal(new Platform({ sh: local.sh, hostname: local.hostname }).canSignIn(), false);
});

test('hosted: submitScore posts high-score and reads the rank', async () => {
  const f = fixture('https://metro-dash.starhermit.com/#game_token={jwt}');
  const p = new Platform({ sh: f.sh, hostname: f.hostname });
  const sent = [];
  f.sh.submitScores = async (sc) => { sent.push(sc); return Object.keys(sc); };
  f.sh.leaderboard = async (key) => ({ items: key === 'high-score' ? [{ userId: p.userId, rank: 2 }] : [] });
  assert.deepEqual(await p.submitScore(3456.7), { posted: true, rank: 2 });
  assert.deepEqual(sent, [{ 'high-score': 3457 }]);
  f.sh.submitScores = async () => [];
  assert.deepEqual(await p.submitScore(1), { posted: false, rank: null });
});

test('leaderboard line strings in every locale', async () => {
  const { SH_STRINGS } = await import('../js/sh-strings.js');
  assert.equal(Object.keys(SH_STRINGS).length, 9);
  for (const [l, t] of Object.entries(SH_STRINGS)) {
    for (const k of ['lbPosting', 'lbRank', 'lbPosted', 'lbNotPosted']) assert.ok(t[k], l + ' ' + k);
    assert.ok(t.lbRank.includes('{rank}'));
  }
  assert.equal(SH_STRINGS['fr-CA'].lbPosting, 'Envoi du pointage au classement…');
});

test('hosted: a save conflict reloads the cloud mirror, merges it (onConflict) and saves again', async () => {
  const f = fixture('https://x.example/#game_token={jwt}');
  const p = new Platform({ sh: f.sh, hostname: f.hostname });
  assert.equal(await p.init(), null); // empty slot: the first write is If-None-Match: *
  let doc = { v: 1, progression: { totalRuns: 3, dailyDays: ['2026-10-15'] } };
  p.getCloudDoc = () => doc;
  p.scheduleCloudSave();
  await p.flushCloudSave();
  assert.equal(p.syncState, 'synced');
  f.writeElsewhere({ v: 1, progression: { totalRuns: 7, dailyDays: ['2026-10-16'] } }); // another device
  const merged = [];
  p.onConflict = (remote) => {
    merged.push(remote);
    doc = { v: 1, progression: { totalRuns: Math.max(3, remote.progression.totalRuns), dailyDays: ['2026-10-15', ...remote.progression.dailyDays] } };
  };
  p.scheduleCloudSave();
  await p.flushCloudSave();
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 30));
  await p.flushCloudSave();
  assert.equal(merged.length, 1);
  assert.equal(merged[0].progression.totalRuns, 7);
  const puts = f.calls.filter((c) => c.method === 'PUT' && c.url.includes('cloud-saves'));
  assert.equal(puts.at(-1).ifMatch, '"v2"');
  assert.equal(f.sh.saveConflicted(), false);
  assert.deepEqual(await p.init(), { v: 1, progression: { totalRuns: 7, dailyDays: ['2026-10-15', '2026-10-16'] } });
});
