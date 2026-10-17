// Graphics quality model + Graphics panel strings. Run: node --test tests/gfx.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// js/gpu-level.js is a classic script in the page (window.StarHermitGpu); evaluate it the same way here.
new Function('window', 'module', readFileSync(new URL('../js/gpu-level.js', import.meta.url), 'utf8'))(globalThis, undefined);
const {
  CATEGORIES, PRESETS, LEVELS, BUDGETS, SPARK_MAX, MOTE_MAX, budgetFor, choosePreset, describe, detectLevel, detectPreset,
  presetForLevel, migrateQuality, presetTier, resolve,
} = await import('../js/gfx.js');
const { GFX_STRINGS, pickGfxLocale } = await import('../js/gfx-strings.js');

const DESK = { cores: 8, memoryGb: 8 };
const PHONE = { mobile: true, cores: 8, memoryGb: 8 };

test('hardware level picks the Auto preset (Low 0, Balanced 4, High 10, Ultra 17)', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', DESK), 'low');
  assert.equal(detectLevel('llvmpipe (LLVM 15.0.7, 256 bits)', DESK), 0);
  assert.equal(detectPreset('', DESK), 'low', 'no WebGL');
  assert.equal(detectPreset('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', DESK), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)', DESK), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)', DESK), 'balanced');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0)', DESK), 'high');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0)', DESK), 'ultra');
  assert.equal(detectLevel('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK), 20);
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK), 'ultra');
  for (const [p, lv] of Object.entries(LEVELS)) assert.equal(presetForLevel(lv), p);
  assert.equal(presetForLevel(3), 'low');
  assert.equal(presetForLevel(16), 'high');
});

test('phones and tablets are Balanced at most; software GPUs stay Low', () => {
  assert.equal(detectPreset('Adreno (TM) 740', PHONE), 'balanced');
  assert.ok(detectLevel('Adreno (TM) 740', PHONE) <= 9);
  assert.equal(detectPreset('Apple M1', PHONE), 'balanced');
  assert.equal(detectPreset('SwiftShader', PHONE), 'low');
});

test('per-preset budgets are explicit, grow from Low to Ultra and scale with the level', () => {
  const keys = ['material', 'texture', 'buildings', 'sparks', 'motes', 'bloomRes', 'aoRes'];
  for (const p of PRESETS) for (const k of keys) assert.ok(BUDGETS[p][k] != null, `${p}.${k}`);
  for (let i = 1; i < PRESETS.length; i++) for (const k of keys) {
    if (typeof BUDGETS.low[k] === 'number') assert.ok(BUDGETS[PRESETS[i]][k] >= BUDGETS[PRESETS[i - 1]][k], `${PRESETS[i]}.${k}`);
  }
  assert.deepEqual(PRESETS.map((p) => BUDGETS[p].material), ['lambert', 'standard', 'physical', 'physical']);
  assert.deepEqual(PRESETS.map((p) => BUDGETS[p].bloomRes), [0.5, 0.5, 0.5, 1], 'half-res bloom below Ultra');
  assert.deepEqual(resolve({ preset: 'high' }, 'low', 10).budget, BUDGETS.high, 'floor level = the tuned budget');
  assert.deepEqual(resolve({ preset: 'ultra' }, 'low', 0).budget, resolve({ preset: 'ultra' }, 'ultra', 17).budget);
  assert.ok(budgetFor('balanced', 9).motes > budgetFor('balanced', 4).motes, 'counts scale up within the preset');
  assert.ok(budgetFor('ultra', 20).sparks <= SPARK_MAX && budgetFor('ultra', 20).motes <= MOTE_MAX);
  assert.equal(resolve({}, 'low', 0).budget.material, 'lambert', 'headless SwiftShader: Low, Lambert');
});

test('resolve: auto uses the detected preset, explicit preset wins', () => {
  const auto = resolve({}, 'high');
  assert.equal(auto.preset, 'high');
  assert.equal(auto.auto, true);
  assert.equal(auto.shadows, presetTier('high', 'shadows'));
  const low = resolve({ preset: 'low' }, 'high');
  assert.equal(low.preset, 'low');
  assert.equal(low.auto, false);
  assert.equal(low.shadows, 'off');
  assert.equal(low.post, false, 'Low renders without a post chain');
  assert.equal(low.cap, 1);
  assert.equal(resolve({ preset: 'bogus' }, undefined).preset, 'balanced');
});

test('resolve: overrides apply per category and invalid tiers fall back', () => {
  const r = resolve({ preset: 'low', bloom: 'on', shadows: 'high', ao: 'nope' }, 'low');
  assert.equal(r.bloom, 'on');
  assert.equal(r.shadows, 'high');
  assert.equal(r.ao, 'off');
  assert.equal(r.post, true, 'bloom override turns the post chain on');
  for (const p of PRESETS) {
    const row = resolve({ preset: p }, 'low');
    for (const [cat, tiers] of Object.entries(CATEGORIES)) assert.ok(tiers.includes(row[cat]), `${p}.${cat}`);
  }
});

test('resolve: render scale is clamped to 50–200% and multiplies the preset scale', () => {
  assert.equal(resolve({ preset: 'high', render_scale: 5 }, 'low').renderScale, 2);
  assert.equal(resolve({ preset: 'high', render_scale: 0.1 }, 'low').renderScale, 0.5);
  assert.equal(resolve({ preset: 'high', render_scale: 1.5 }, 'low').scale, 1.5);
  assert.equal(resolve({ preset: 'low' }, 'low').scale, 0.85);
  assert.equal(resolve({ preset: 'high' }, 'low').adaptive, true);
  assert.equal(resolve({ preset: 'high', adaptive: false, show_fps: true }, 'low').showFps, true);
});

test('choosing a preset clears category overrides but keeps scale and toggles', () => {
  const next = choosePreset({ preset: 'low', bloom: 'on', shadows: 'high', render_scale: 1.2, show_fps: true }, 'ultra');
  assert.deepEqual(next, { preset: 'ultra', render_scale: 1.2, show_fps: true });
  assert.equal(choosePreset({ preset: 'high' }, 'auto').preset, 'auto');
});

test('legacy quality values migrate to presets', () => {
  assert.equal(migrateQuality('low'), 'low');
  assert.equal(migrateQuality('medium'), 'balanced');
  assert.equal(migrateQuality('high'), 'high');
  assert.equal(migrateQuality('auto'), 'auto');
});

test('describe summarizes cost', () => {
  const s = describe(resolve({ preset: 'high' }, 'low'), [1280, 720]);
  assert.match(s, /2048² shadows/);
  assert.match(s, /bloom/);
  assert.match(s, /SMAA/);
  assert.match(s, /1280×720 px/);
  assert.match(describe(resolve({ preset: 'low' }, 'low')), /no shadows/);
});

test('Graphics strings exist for all nine locales with every key', () => {
  const required = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
  const en = GFX_STRINGS['en-US'];
  for (const tag of required) {
    const s = GFX_STRINGS[tag];
    assert.ok(s, tag);
    for (const k of Object.keys(en)) {
      assert.ok(s[k], `${tag}.${k}`);
      if (typeof en[k] === 'object') for (const kk of Object.keys(en[k])) assert.ok(s[k][kk], `${tag}.${k}.${kk}`);
    }
    for (const cat of Object.keys(CATEGORIES)) assert.ok(s.cats[cat], `${tag} cat ${cat}`);
    for (const tiers of Object.values(CATEGORIES)) for (const t of tiers) assert.ok(s.tiers[t], `${tag} tier ${t}`);
  }
  assert.equal(pickGfxLocale(['de']), 'de-DE');
  assert.equal(pickGfxLocale(['es-MX']), 'es-419');
  assert.equal(pickGfxLocale(['es-ES']), 'es-ES');
  assert.equal(pickGfxLocale(['fr-CA']), 'fr-CA');
  assert.equal(pickGfxLocale(['en-GB']), 'en-GB');
  assert.equal(pickGfxLocale(['ja-JP']), 'en-US');
});
