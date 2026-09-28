// Graphics quality model + Graphics panel strings. Run: node --test tests/gfx.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES, PRESETS, choosePreset, describe, detectPreset, migrateQuality, presetTier, resolve,
} from '../js/gfx.js';
import { GFX_STRINGS, pickGfxLocale } from '../js/gfx-strings.js';

test('detectPreset maps GPU strings to presets', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'low');
  assert.equal(detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)'), 'low');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)'), 'high');
  assert.equal(detectPreset('Apple M2 Pro'), 'high');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)'), 'balanced');
  assert.equal(detectPreset('Adreno (TM) 730'), 'balanced');
  assert.equal(detectPreset(''), 'balanced');
  // touch / mobile devices cap Auto at balanced
  assert.equal(detectPreset('Apple M1', true), 'balanced');
  assert.equal(detectPreset('SwiftShader', true), 'low');
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
