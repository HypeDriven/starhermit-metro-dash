// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset in Settings → Graphics,
// starts the daily run from the briefing and keeps playing with the game's keyboard controls (lane
// changes, jumps, slides) — the street scrolls, the city, obstacles and coins stream past, sparks and
// motes fly and the day cycle advances. A crash goes to the results; Retry starts the next run.
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

export async function setPreset(page, preset) {
  await page.waitForSelector('#screen-title:not([hidden])', { timeout: 20000 });
  await page.click('#btn-settings');
  await page.waitForSelector('#screen-settings:not([hidden])');
  await page.locator('#gfx-section').scrollIntoViewIfNeeded();
  await page.selectOption('#set-quality', preset);
  await page.waitForFunction((p) => document.querySelector('#canvas-host canvas')?.dataset.gfxPreset === p, preset);
  await page.click('#screen-settings [data-back]');
  await page.waitForSelector('#screen-title:not([hidden])');
}

const KEYS = ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];

export async function start(page) {
  await page.click('#btn-play');
  await page.waitForSelector('#screen-setup:not([hidden])');
  await page.click('#btn-setup-start');
  await page.waitForFunction(() => window.__md.state === 'active', null, { timeout: 15000 });
  let open = true, i = 0;
  page.once('close', () => { open = false; });
  (async () => {
    while (open) {
      try {
        const st = await page.evaluate(() => window.__md.state);
        if (await page.locator('#screen-results:not([hidden])').count()) {
          await page.click('#btn-retry', { timeout: 3000 });
          await page.waitForFunction(() => window.__md.state === 'active', null, { timeout: 15000 });
        } else if (st === 'active') {
          await page.keyboard.press(KEYS[i++ % KEYS.length]);
        }
      } catch (e) { if (!open) return; if (process.env.BENCH_DEBUG) console.error(e.message); }
      await page.waitForTimeout(450).catch(() => {});
    }
  })();
  await page.waitForTimeout(1500);
}
