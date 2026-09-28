// Graphics section of the Settings screen: quality preset, render scale,
// per-category overrides, adaptive resolution, frame-rate readout and a cost
// summary. Every control has a stable id and a data-gfx attribute for tests.

import { CATEGORIES, PRESETS, choosePreset, describe, migrateQuality, presetTier } from './gfx.js';
import { gfxStrings } from './gfx-strings.js';

const fmt = (s, tier) => s.replace('{tier}', tier);

export function createGraphicsPanel({ root, settings, getRenderer, onChange }) {
  const t = gfxStrings(typeof navigator !== 'undefined' ? navigator.languages || [navigator.language] : []);
  const saved = () => settings.graphics || { preset: migrateQuality(settings.quality) };
  const presetName = (p) => t.presets[p] || p;
  const tierName = (tier) => t.tiers[tier] || tier;

  root.textContent = '';
  const legend = document.createElement('legend');
  legend.textContent = t.legend;
  root.append(legend);

  function row(labelText, control, extra) {
    const label = document.createElement('label');
    const span = document.createElement('span');
    span.textContent = labelText;
    label.append(span);
    if (extra) span.append(' ', extra);
    label.append(control);
    root.append(label);
    return label;
  }
  function select(id, key) {
    const el = document.createElement('select');
    el.id = id;
    el.dataset.gfx = key;
    return el;
  }
  function option(el, value, text) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    el.append(o);
    return o;
  }

  // Quality preset (keeps the historical #set-quality id)
  const presetSel = select('set-quality', 'preset');
  const autoOpt = option(presetSel, 'auto', t.auto);
  for (const p of PRESETS) option(presetSel, p, presetName(p));
  row(t.quality, presetSel);

  // Render scale
  const scale = document.createElement('input');
  scale.type = 'range';
  scale.id = 'gfx-scale';
  scale.dataset.gfx = 'render_scale';
  scale.min = '50'; scale.max = '200'; scale.step = '5';
  const scaleOut = document.createElement('output');
  scaleOut.id = 'gfx-scale-value';
  scaleOut.htmlFor = 'gfx-scale';
  row(t.renderScale, scale, scaleOut).classList.add('gfx-scale-row');

  // Per-category overrides
  const catSel = {};
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    const el = select('gfx-' + cat, cat);
    option(el, 'preset', '');
    for (const tier of tiers) option(el, tier, tierName(tier));
    catSel[cat] = el;
    row(t.cats[cat], el);
  }

  function checkbox(id, key, text) {
    const label = document.createElement('label');
    label.className = 'check-row';
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.id = id;
    el.dataset.gfx = key;
    label.append(el, ' ', text);
    root.append(label);
    return el;
  }
  const adaptive = checkbox('gfx-adaptive', 'adaptive', t.adaptive);
  const showFps = checkbox('gfx-fps', 'show_fps', t.showFps);

  const summary = document.createElement('p');
  summary.id = 'gfx-summary';
  summary.className = 'muted gfx-summary';
  summary.setAttribute('aria-live', 'polite');
  const note = document.createElement('p');
  note.id = 'gfx-note';
  note.className = 'warning';
  note.hidden = true;
  root.append(summary, note);

  function commit(next) {
    settings.graphics = next;
    onChange();
    fill();
  }

  presetSel.addEventListener('change', () => commit(choosePreset(saved(), presetSel.value)));
  scale.addEventListener('input', () => {
    scaleOut.value = scale.value + '%';
    settings.graphics = { ...saved(), render_scale: Number(scale.value) / 100 };
    onChange();
    refresh();
  });
  for (const [cat, el] of Object.entries(catSel)) {
    el.addEventListener('change', () => {
      const next = { ...saved() };
      if (el.value === 'preset') delete next[cat];
      else next[cat] = el.value;
      commit(next);
    });
  }
  adaptive.addEventListener('change', () => commit({ ...saved(), adaptive: adaptive.checked }));
  showFps.addEventListener('change', () => commit({ ...saved(), show_fps: showFps.checked }));

  /** Sync every control with the saved settings and the renderer's resolved state. */
  function fill() {
    const s = saved();
    const info = getRenderer()?.graphicsInfo?.() || null;
    const detected = info ? info.detected : 'balanced';
    const preset = info ? info.resolved.preset : (PRESETS.includes(s.preset) ? s.preset : detected);
    autoOpt.textContent = fmt(t.auto, presetName(detected));
    presetSel.value = PRESETS.includes(s.preset) ? s.preset : 'auto';
    const pct = Math.round((Number(s.render_scale) || 1) * 100);
    scale.value = String(pct);
    scaleOut.value = pct + '%';
    for (const [cat, el] of Object.entries(catSel)) {
      el.options[0].textContent = fmt(t.fromPreset, tierName(presetTier(preset, cat)));
      el.value = CATEGORIES[cat].includes(s[cat]) ? s[cat] : 'preset';
    }
    adaptive.checked = s.adaptive !== false;
    showFps.checked = !!s.show_fps;
    refresh();
  }

  /** Update the summary line (cheap; called while the screen is open). */
  function refresh() {
    const info = getRenderer()?.graphicsInfo?.() || null;
    if (!info) {
      summary.textContent = '';
      note.textContent = t.unavailable;
      note.hidden = false;
      return;
    }
    const cost = describe(info.resolved, info.pixels, t.words);
    summary.textContent = `${info.gpu} · ${presetName(info.resolved.preset)} · ${cost}`;
    root.dataset.gfxPreset = info.resolved.preset;
    note.textContent = t.postFailed;
    note.hidden = !info.postFailed;
  }

  return { fill, refresh };
}
