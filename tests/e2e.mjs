/**
 * Metro Dash — end-to-end QA playthrough (dev only, not shipped).
 *
 * Drives the real visible UI in headless Chrome against a self-contained
 * static server (the repo's server.js is the StarHermit authoritative script;
 * the game has a full offline fallback, so a plain static server suffices —
 * all /api/v1/* calls are skipped client-side when no launch token is present).
 *
 * Flow per pass: title → help → journey grid → settings → daily run briefing →
 * countdown → active play (keyboard on desktop, touch tray on mobile) →
 * pause/resume → run until crash → results breakdown → retry → pause →
 * end run → results → back to title.
 *
 * Two passes: desktop 1280x800, then a fresh context at mobile 390x844 with
 * touch. Fails loudly on any non-benign console error or pageerror.
 *
 * Run: npm run test:e2e
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOT = (stage, vp) => `/tmp/metro-dash-e2e-${stage}-${vp}.png`;

// benign GPU/swiftshader noise (from tools/production_game_audit.mjs)
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.ts': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/') path = '/index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const failures = [];
const step = async (name, fn) => {
  await fn();
  console.log(`ok - ${name}`);
};

async function playPass(vpName, contextOpts, { touch }) {
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !browserNoise.test(m.text())) errors.push(`console: ${m.text()}`);
  });

  const state = () => page.evaluate(() => window.__md?.state);
  const press = touch
    ? (action) => page.locator(`.tray-btn[data-action="${action}"]`).tap()
    : (key) => page.keyboard.press(key);

  try {
    await step(`${vpName}: load + title visible`, async () => {
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.waitForSelector('#screen-title:not([hidden])', { timeout: 10000 });
      if (await state() !== 'title') throw new Error('game did not reach title state');
      await page.screenshot({ path: SHOT('title', vpName) });
    });

    await step(`${vpName}: help screen opens and closes`, async () => {
      await page.click('#btn-help');
      await page.waitForSelector('#screen-help:not([hidden])');
      const cards = await page.locator('#help-cards .card').count();
      if (cards < 5) throw new Error(`expected help cards, got ${cards}`);
      await page.screenshot({ path: SHOT('help', vpName) });
      await page.click('#screen-help [data-back]');
      await page.waitForSelector('#screen-title:not([hidden])');
    });

    await step(`${vpName}: journey grid renders 40 stages, 1 unlocked`, async () => {
      await page.click('#btn-journey');
      await page.waitForSelector('#screen-journey:not([hidden])');
      const total = await page.locator('#journey-grid .stage-card').count();
      const unlocked = await page.locator('#journey-grid .stage-card:not(.locked)').count();
      if (total !== 40) throw new Error(`expected 40 stages, got ${total}`);
      if (unlocked !== 1) throw new Error(`expected 1 unlocked stage, got ${unlocked}`);
      await page.screenshot({ path: SHOT('journey', vpName) });
      await page.click('#screen-journey [data-back]');
    });

    await step(`${vpName}: settings open, toggle, close`, async () => {
      await page.click('#btn-settings');
      await page.waitForSelector('#screen-settings:not([hidden])');
      await page.check('#set-reduced-motion');
      await page.uncheck('#set-reduced-motion');
      await page.screenshot({ path: SHOT('settings', vpName) });
      await page.click('#screen-settings [data-back]');
      await page.waitForSelector('#screen-title:not([hidden])');
    });

    await step(`${vpName}: daily run briefing → countdown → active`, async () => {
      await page.click('#btn-play');
      await page.waitForSelector('#screen-setup:not([hidden])');
      const facts = await page.locator('#setup-facts').innerText();
      if (!/Ranked/i.test(facts)) throw new Error('briefing missing ranked status');
      await page.screenshot({ path: SHOT('briefing', vpName) });
      await page.click('#btn-setup-start');
      await page.waitForFunction(() => window.__md.state === 'countdown');
      await page.screenshot({ path: SHOT('countdown', vpName) });
      await page.waitForFunction(() => window.__md.state === 'active', null, { timeout: 10000 });
      if (await page.locator('#hud').isHidden()) throw new Error('HUD not visible in play');
    });

    await step(`${vpName}: pause and resume`, async () => {
      // pause immediately, before a crash can end the run
      if (touch) await page.click('#btn-pause');
      else await page.keyboard.press('Escape');
      await page.waitForSelector('#overlay-pause:not([hidden])');
      if ((await state()) !== 'paused') throw new Error('not paused');
      await page.screenshot({ path: SHOT('pause', vpName) });
      await page.click('#btn-resume');
      await page.waitForFunction(() => window.__md.state === 'active', null, { timeout: 10000 });
      if (await page.locator('#overlay-pause').isVisible()) throw new Error('pause overlay still visible');
    });

    await step(`${vpName}: play with ${touch ? 'touch tray' : 'keyboard'} inputs`, async () => {
      const inputs = touch
        ? ['left', 'jump', 'right', 'slide', 'jump', 'left']
        : ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'ArrowLeft'];
      for (const k of inputs) {
        if ((await state()) !== 'active') break;
        await press(k);
        await page.waitForTimeout(300);
      }
      await page.waitForTimeout(1500);
      const dist = await page.locator('#hud-distance').innerText();
      if (!/[1-9]/.test(dist)) throw new Error(`distance not accumulating: "${dist}"`);
      if ((await state()) === 'active') await page.screenshot({ path: SHOT('play', vpName) });
    });

    await step(`${vpName}: run until crash → results breakdown`, async () => {
      // stop dodging; one crash ends the run
      await page.waitForSelector('#screen-results:not([hidden])', { timeout: 60000 });
      const rows = await page.locator('#results-table tbody tr').count();
      if (rows < 3) throw new Error(`expected score breakdown rows, got ${rows}`);
      const headline = await page.locator('#results-headline').innerText();
      console.log(`  ${vpName} headline: ${headline}`);
      await page.screenshot({ path: SHOT('results', vpName) });
    });

    await step(`${vpName}: retry → pause → end run → results → menu`, async () => {
      await page.click('#btn-retry');
      await page.waitForFunction(() => window.__md.state === 'active', null, { timeout: 10000 });
      if (touch) await page.click('#btn-pause');
      else await page.keyboard.press('Escape');
      await page.waitForSelector('#overlay-pause:not([hidden])');
      await page.click('#btn-pause-quit');
      await page.waitForSelector('#screen-results:not([hidden])', { timeout: 10000 });
      await page.click('#btn-results-menu');
      await page.waitForSelector('#screen-title:not([hidden])');
      await page.screenshot({ path: SHOT('back-to-title', vpName) });
    });
  } finally {
    if (errors.length) {
      failures.push(`[${vpName}] page errors:\n  ${errors.join('\n  ')}`);
      console.log(`PAGE ERRORS (${vpName}):\n  ${errors.join('\n  ')}`);
    }
    await context.close();
  }
}

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});

try {
  await playPass('desktop', { viewport: { width: 1280, height: 800 } }, { touch: false });
  await playPass('mobile', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, { touch: true });
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error('\nE2E FAIL');
  process.exit(1);
}
console.log('\nE2E PASS — metro-dash, desktop + mobile, no page errors');
