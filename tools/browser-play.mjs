// Plays the web package in Chrome on the machine's GPU (~/games/tools/
// gpu-chrome.mjs; GPU_ADAPTER=software for headless SwiftShader), the loader
// index.html that `npm run package` writes: at a desktop viewport, a phone
// (DPR 3) and a phone held sideways (DPR 3). On the desktop Enter on the
// focused Play Daily Run opens the briefing and Enter on Start starts it,
// after the countdown the arrow keys and Space move, jump and slide, Escape
// pauses and resumes, and the run is left to crash into the results; on the
// phones a finger taps Play Daily Run and Start (found through the page's
// accessibility mirror of the engine's UI), the tray's Move left and Jump,
// swipes on the street (CDP touch), the HUD's Pause and the panel's End Run,
// which shows the results. Screenshots of each step go to --shots. Fails on
// console errors or warnings, the runtime's error screen, or a view that never
// reaches the results.
//   node tools/browser-play.mjs [GAME_DIR] [--shots OUT_DIR]
// Serves GAME_DIR on loopback (never tests/, tools/ or dot-names), the engine
// itself from wiki.starhermit.com as the loader pins it. playwright-core is
// resolved from GAME_DIR's node_modules or any sibling game's.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const args = process.argv.slice(2);
const dir = resolve(args[0] && !args[0].startsWith('--') ? args[0] : '.');
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const shots = opt('--shots', null);

function findPlaywright() {
  const roots = [dir, resolve(dir, '..'), ...readdirSync(resolve(dir, '..')).map((d) => resolve(dir, '..', d))];
  for (const r of roots) {
    const p = join(r, 'node_modules', 'playwright-core');
    if (existsSync(p)) return createRequire(join(r, 'package.json'))('playwright-core');
  }
  throw new Error('playwright-core not found');
}
const { chromium } = findPlaywright();

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.ts': 'text/plain',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
  // The platform's clock (platform.serverTime / serverNow), as the game host answers it.
  if (path === 'api/v1/time') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ serverTime: Date.now(), serverTimeIso: new Date().toISOString() })); return; }
  const parts = path.split('/');
  if (parts.some((p) => p.startsWith('.') || p === '..') || ['tests', 'tools', 'node_modules'].includes(parts[0])) { res.writeHead(404).end(); return; }
  const file = join(dir, path);
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const { launchChrome } = await import('/home/albert/games/tools/gpu-chrome.mjs');
const { browser, gpu, close } = await launchChrome(chromium);
console.log(`# chrome on ${gpu}`);
let failed = false;

const views = [
  { name: 'desktop', viewport: { width: 1366, height: 768 } },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  { name: 'landscape', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
];
for (const v of views) {
  const ctx = await browser.newContext({ viewport: v.viewport, isMobile: v.isMobile, hasTouch: v.hasTouch, deviceScaleFactor: v.deviceScaleFactor });
  const page = await ctx.newPage();
  const cdp = v.hasTouch ? await ctx.newCDPSession(page) : null;
  const problems = [];
  const environment = /^No available adapters\.$|GL Driver Message/;
  page.on('console', (m) => {
    const platformRoute = /\/api\//.test(m.location()?.url ?? '');
    if ((m.type() === 'error' || m.type() === 'warning') && !environment.test(m.text()) && !platformRoute) problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400 && !/\/api\//.test(r.url())) problems.push(`http ${r.status()}: ${r.url()}`); });
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  const started = await page.waitForFunction(() => ['running', 'error'].includes(document.documentElement.dataset.starhermit), null, { timeout: 90000 }).then(() => true, () => false);
  // The first key press can be lost while the runtime starts up.
  await page.waitForTimeout(4000);
  const W = v.viewport.width, H = v.viewport.height;
  const shot = async (name) => { if (shots) { mkdirSync(shots, { recursive: true }); await page.screenshot({ path: join(shots, `${v.name}-${name}.png`) }); } };
  const key = async (k) => { await page.keyboard.down(k); await page.waitForTimeout(90); await page.keyboard.up(k); await page.waitForTimeout(150); };
  const find = (name) => page.getByRole('button', { name, exact: true }).first();
  const touchAt = async (x, y) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await page.waitForTimeout(90);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(200);
  };
  const tap = async (name) => {
    const el = find(name);
    await el.waitFor({ timeout: 20000 });
    const b = await el.boundingBox();
    await touchAt(b.x + b.width / 2, b.y + b.height / 2);
  };
  const swipe = async (x1, y1, x2, y2) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1, id: 1 }] });
    for (let i = 1; i <= 4; i++) {
      await page.waitForTimeout(30);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + ((x2 - x1) * i) / 4, y: y1 + ((y2 - y1) * i) / 4, id: 1 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(200);
  };
  let reached = false;
  try {
    await shot('title');
    if (!cdp) {
      await key('Enter');
      await find('Start').waitFor({ timeout: 20000 });
      await shot('briefing');
      await key('Enter');
    } else {
      const play = page.getByRole('button', { name: /^Play Daily Run/ }).first();
      await play.waitFor({ timeout: 20000 });
      const pb = await play.boundingBox();
      await touchAt(pb.x + pb.width / 2, pb.y + pb.height / 2);
      await shot('briefing');
      await tap('Start');
    }
    await page.waitForTimeout(1200);
    await shot('countdown');
    await page.waitForTimeout(2200);
    if (!cdp) {
      await key('ArrowLeft'); await key('Space'); await page.waitForTimeout(500);
      await shot('run');
      await key('Escape'); await page.waitForTimeout(500);
      await shot('paused');
      await key('Escape');
      await find('Retry').waitFor({ timeout: 90000 });
    } else {
      await tap('Move left');
      await tap('Jump');
      await swipe(W * 0.5, H * 0.55, W * 0.85, H * 0.55);
      await swipe(W * 0.5, H * 0.6, W * 0.5, H * 0.75);
      await page.waitForTimeout(300);
      await shot('run');
      await tap('Pause (Esc)');
      await page.waitForTimeout(500);
      await shot('paused');
      await tap('End Run');
      await find('Retry').waitFor({ timeout: 30000 });
    }
    await page.waitForTimeout(1500);
    await shot('results');
    reached = true;
  } catch (e) { problems.push(`play: ${String(e.message || e).split('\n')[0]}`); await shot('failed'); }
  const state = await page.evaluate(() => document.documentElement.dataset.starhermit ?? '');
  const ok = started && state === 'running' && problems.length === 0 && reached;
  failed ||= !ok;
  console.log(`${ok ? 'ok' : 'not ok'} - ${v.name} played: started=${started} state=${state || '-'} results=${reached}`);
  for (const p of problems) console.log(`  ${p}`);
  await ctx.close();
}
await close();
server.close();
process.exit(failed ? 1 : 0);
