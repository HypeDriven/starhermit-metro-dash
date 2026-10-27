// Bakes the browser build's procedural canvas textures (js/render.js before
// the engine port: makeDetailTex — the speckled asphalt with tyre wear, patch
// repairs, lane and curb lines; the damp-patch roughness map; makeWinTex — the
// lit and dark office windows) into assets/textures/, by running that canvas
// code unchanged in Chrome (~/games/tools/gpu-chrome.mjs). Nine thousand
// speckles and hundreds of radial gradients paint far too slowly on the
// engine's canvas at start-up, so the engine client loads these images
// instead (native/render.ts). Baked at Ultra's 1024 px budget (the runtime
// holds textures to the graphics level's size). Run once; commit the images.
//   node tools/bake-textures.mjs
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
function findPlaywright() {
  const roots = [root, resolve(root, '..'), ...readdirSync(resolve(root, '..')).map((d) => resolve(root, '..', d))];
  for (const r of roots) {
    const p = join(r, 'node_modules', 'playwright-core');
    if (existsSync(p)) return createRequire(join(r, 'package.json'))('playwright-core');
  }
  throw new Error('playwright-core not found');
}
const { chromium } = findPlaywright();

// js/rng.js Rng and the old js/render.js painters, verbatim, returning data URLs.
const painters = String.raw`
class Rng {
  constructor(seed) { this.state = (seed >>> 0) || 0x9e3779b9; }
  next() {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min, max) { return min + Math.floor(this.next() * (max - min + 1)); }
  chance(p) { return this.next() < p; }
}
function makeDetailTex(size) {
  const detailRng = new Rng(0xA5F);
  const dCanvas = document.createElement('canvas');
  dCanvas.width = size; dCanvas.height = size;
  const dctx = dCanvas.getContext('2d');
  dctx.scale(size / 512, size / 512);
  dctx.fillStyle = '#48434f';
  dctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    const v = 50 + Math.floor(detailRng.next() * 40);
    dctx.fillStyle = 'rgba(' + v + ',' + (v - 4) + ',' + (v + 6) + ',0.5)';
    dctx.fillRect(detailRng.next() * 512, detailRng.next() * 512, 1 + detailRng.next() * 2, 1 + detailRng.next() * 2);
  }
  for (const cx of [43, 256, 469]) {
    const g = dctx.createLinearGradient(cx - 60, 0, cx + 60, 0);
    g.addColorStop(0, 'rgba(20,18,26,0)');
    g.addColorStop(0.5, 'rgba(20,18,26,0.22)');
    g.addColorStop(1, 'rgba(20,18,26,0)');
    dctx.fillStyle = g;
    dctx.fillRect(cx - 60, 0, 120, 512);
  }
  for (let i = 0; i < 4; i++) {
    dctx.fillStyle = 'rgba(34,32,40,0.12)';
    dctx.fillRect(detailRng.next() * 470, detailRng.next() * 470, 30 + detailRng.next() * 60, 20 + detailRng.next() * 40);
  }
  dctx.fillStyle = 'rgba(255,255,255,0.6)';
  for (const x of [170, 340]) dctx.fillRect(x - 3, 0, 6, 512);
  dctx.fillStyle = 'rgba(255,214,120,0.55)';
  for (const x of [8, 504]) dctx.fillRect(x - 3, 0, 6, 512);
  return dCanvas.toDataURL('image/webp', 0.9);
}
function makeRough() {
  const detailRng = new Rng(0xA5F ^ 0x77);
  const rCanvas = document.createElement('canvas');
  rCanvas.width = rCanvas.height = 128;
  const rctx = rCanvas.getContext('2d');
  rctx.fillStyle = '#e6e6e6';
  rctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 7; i++) {
    const x = detailRng.next() * 128, y = detailRng.next() * 128, r = 8 + detailRng.next() * 18;
    const g = rctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(70,70,70,0.9)');
    g.addColorStop(1, 'rgba(230,230,230,0)');
    rctx.fillStyle = g;
    rctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return rCanvas.toDataURL('image/png');
}
function makeWinTex(size) {
  const winCanvas = document.createElement('canvas');
  winCanvas.width = size / 2; winCanvas.height = size;
  const wctx = winCanvas.getContext('2d');
  wctx.scale(size / 256, size / 256);
  wctx.fillStyle = '#101018';
  wctx.fillRect(0, 0, 128, 256);
  const winRng = new Rng(0xB01);
  const lit = ['#ffd38a', '#ffe7b8', '#ffc27a', '#bfe0ff'];
  for (let y = 8; y < 248; y += 16) {
    const floorLit = winRng.chance(0.8);
    for (let x = 8; x < 120; x += 16) {
      wctx.fillStyle = floorLit && winRng.chance(0.5) ? lit[winRng.int(0, lit.length - 1)] : '#1c2030';
      wctx.fillRect(x, y, 10, 11);
    }
    wctx.fillStyle = '#0a0a12';
    wctx.fillRect(0, y + 13, 128, 2);
  }
  return winCanvas.toDataURL('image/png');
}
`;

const { launchChrome } = await import('/home/albert/games/tools/gpu-chrome.mjs');
const { browser, close } = await launchChrome(chromium);
const page = await browser.newPage();
await page.setContent('<!doctype html><title>bake</title>');
const out = await page.evaluate(`(() => { ${painters}; return { 'asphalt.webp': makeDetailTex(1024), 'asphalt-rough.png': makeRough(), 'windows.png': makeWinTex(1024) }; })()`);
await close();
const dir = join(root, 'assets', 'textures');
mkdirSync(dir, { recursive: true });
for (const [name, url] of Object.entries(out)) {
  writeFileSync(join(dir, name), Buffer.from(url.split(',')[1], 'base64'));
  console.log(`wrote assets/textures/${name}`);
}
process.exit(0);
