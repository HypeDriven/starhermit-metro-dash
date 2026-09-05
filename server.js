// Metro Dash — authoritative script (StarHermit `server=server.js`).
// Zero-dependency Node server:
//   - static file serving for the browser distribution
//   - GET  /api/v1/time          platform time sync (round-trip adjusted client-side)
//   - POST /api/v1/daily/submit  authoritative daily replay validation + board
//   - POST /api/v1/presence      presence heartbeat (204)
//   - POST /api/v1/activity/*    activity start/end pairing (204)
//   - POST /api/v1/telemetry     anonymous funnel events (204, discarded)
// Replay validation re-runs the exact client rules engine with the submitted
// seed, config, and ordered input log; impossible or stale-version scores are
// rejected. Daily seeds are immutable per UTC day; a defective day would be
// excluded from ranking via EXCLUDED_DAYS rather than silently replaced.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateReplay, RULES_VERSION } from './js/rules.js';
import { dailyInfo, CONTENT_VERSION } from './js/content.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 8080;

const EXCLUDED_DAYS = new Set(process.env.EXCLUDED_DAYS ? process.env.EXCLUDED_DAYS.split(',') : []);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.opus': 'audio/ogg',
};

// in-memory daily boards: day -> sorted entries (restart loses them; a hosted
// deployment would back this with durable storage)
const dailyBoards = new Map();
const seenCommands = new Set(); // idempotent duplicate rejection

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('payload-too-large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function compareBoard(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (a.invalid !== b.invalid) return a.invalid - b.invalid;
  if (a.ticks !== b.ticks) return a.ticks - b.ticks;
  return String(a.sessionId).localeCompare(String(b.sessionId));
}

async function handleDailySubmit(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { error: 'malformed-body' });
  }
  const { envelope, day } = body || {};
  if (!envelope || typeof day !== 'string') return json(res, 400, { error: 'missing-fields' });
  if (envelope.rulesVersion !== RULES_VERSION) return json(res, 409, { error: 'stale-version' });
  if (EXCLUDED_DAYS.has(day)) return json(res, 422, { error: 'day-excluded-from-ranking' });

  const info = dailyInfo(new Date(day + 'T00:00:00Z'));
  if (Number.isNaN(info.seed)) return json(res, 400, { error: 'bad-day' });
  if (envelope.seed !== info.seed) return json(res, 422, { error: 'seed-mismatch' });

  // The authoritative config comes from the day's definition, not the client —
  // a forged envelope.config must not be able to inflate a score.
  envelope.config = info.config;

  // idempotency: identical submissions (same sessionId) are accepted once;
  // the key is the session identifier, never a constant for missing results
  const sessionKey = envelope.sessionId ? `${day}:${envelope.sessionId}` : null;
  if (sessionKey && seenCommands.has(sessionKey)) return json(res, 200, { ok: true, duplicate: true });

  const verdict = validateReplay(envelope);
  if (!verdict.ok) return json(res, 422, { error: 'replay-mismatch', detail: verdict });

  // plausibility: only finished runs (with a terminal reason) belong on a board
  if (!verdict.reason) return json(res, 422, { error: 'not-terminal' });
  if (verdict.tick > 30 * 60 * 30) return json(res, 422, { error: 'implausible-duration' });
  if (envelope.commands.length > verdict.tick) return json(res, 422, { error: 'implausible-input-rate' });

  const board = dailyBoards.get(day) || [];
  board.push({
    score: verdict.score, ticks: verdict.tick,
    invalid: verdict.invalid, sessionId: envelope.sessionId || 'anon',
    ruleset: `v${CONTENT_VERSION}`, when: Date.now(),
  });
  board.sort(compareBoard);
  dailyBoards.set(day, board.slice(0, 500));
  if (sessionKey) seenCommands.add(sessionKey);
  const rank = dailyBoards.get(day).findIndex((e) => e.sessionId === (envelope.sessionId || 'anon')) + 1;
  return json(res, 200, { ok: true, score: verdict.score, rank });
}

async function handleApi(req, res, path) {
  if (path === '/api/v1/time' && req.method === 'GET') {
    return json(res, 200, { now: new Date().toISOString() });
  }
  if (path === '/api/v1/daily/submit' && req.method === 'POST') return handleDailySubmit(req, res);
  if (path === '/api/v1/presence' && req.method === 'POST') return json(res, 204, {});
  if (path === '/api/v1/activity/start' && req.method === 'POST') return json(res, 204, {});
  if (path === '/api/v1/activity/end' && req.method === 'POST') return json(res, 204, {});
  if (path === '/api/v1/telemetry' && req.method === 'POST') {
    try { await readBody(req, 4096); } catch { /* discard */ }
    return json(res, 204, {});
  }
  return json(res, 404, { error: 'not-found' });
}

async function serveStatic(req, res, path) {
  let filePath = normalize(join(ROOT, path === '/' ? 'index.html' : path));
  if (!filePath.startsWith(ROOT)) return json(res, 403, { error: 'forbidden' });
  // never serve source maps, dotfiles, or anything sensitive
  if (filePath.includes('/.') || filePath.endsWith('.map')) return json(res, 404, { error: 'not-found' });
  try {
    const st = await stat(filePath);
    if (st.isDirectory()) filePath = join(filePath, 'index.html');
    const data = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(data);
  } catch {
    json(res, 404, { error: 'not-found' });
  }
}

export function createGameServer(port = PORT) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    try {
      if (path.startsWith('/api/')) await handleApi(req, res, path);
      else await serveStatic(req, res, path);
    } catch (err) {
      json(res, 500, { error: 'internal' });
      console.error(err);
    }
  });
  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`Metro Dash server listening on http://localhost:${port}`);
      resolve(server);
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  createGameServer();
}
