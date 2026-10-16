// Localization coverage: every English key the markup and code use is
// translated in every locale (en-GB → en-US, es-ES → es-419, fr-CA → fr-FR
// inherit), placeholders survive, the language follows sh-language.js and
// switches live, and the Graphics and StarHermit strings cover the nine locales.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadTables, codeKeys, htmlKeys, audit, bootI18n, LOCALES } from './i18n-common.mjs';
import { GFX_STRINGS } from '../js/gfx-strings.js';
import { SH_STRINGS } from '../js/sh-strings.js';
import { LESSONS, CHALLENGES, ACHIEVEMENTS } from '../js/content.js';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

function usedKeys() {
  const keys = new Set(htmlKeys(read('index.html')));
  for (const f of ['main', 'ui', 'platform', 'content', 'gfx-panel']) codeKeys(read(`js/${f}.js`)).forEach((k) => keys.add(k));
  return [...keys].sort();
}

test('every used key is translated in every locale; placeholders intact', () => {
  const used = usedKeys();
  assert.ok(used.length > 180, 'keys found: ' + used.length);
  assert.deepEqual(audit(loadTables(ROOT, 'js/strings.js', 'MD_STRINGS'), used), []);
});

test('every lesson, challenge and achievement text is a translation key', () => {
  const de = loadTables(ROOT, 'js/strings.js', 'MD_STRINGS')['de-DE'];
  for (const k of [...LESSONS.flatMap((l) => [l.label, l.briefing]), ...CHALLENGES.flatMap((c) => [c.label, c.briefing]), ...ACHIEVEMENTS.flatMap((a) => [a.label, a.desc])]) {
    assert.ok(de[k], 'de-DE missing ' + k);
  }
});

test('the locale follows sh-language and switches live', () => {
  const { I18N, events, doc } = bootI18n(ROOT, { strings: 'js/strings.js', i18n: 'js/i18n.js', global: 'MDI18N', languages: ['de-DE'] });
  assert.equal(I18N.lang, 'de-DE');
  assert.equal(doc.documentElement.lang, 'de-DE');
  assert.equal(I18N.T('Distance'), 'Strecke');
  I18N.language.setChoice('fr-CA');
  assert.equal(I18N.lang, 'fr-CA');
  assert.equal(events.at(-1), 'fr-CA');
  assert.equal(I18N.T('Score'), 'Pointage');
  assert.equal(I18N.T('Distance'), 'Distance');
  I18N.language.setChoice('es-ES');
  assert.equal(I18N.T('Settings'), 'Ajustes');
  assert.equal(I18N.T('Reach {n} units', { n: 900 }), 'Llega a 900 unidades');
});

test('Graphics and StarHermit strings cover all nine locales', () => {
  const shKeys = Object.keys(SH_STRINGS['en-US']);
  for (const l of LOCALES) {
    assert.ok(GFX_STRINGS[l], l);
    for (const k of shKeys) assert.ok(SH_STRINGS[l][k], `${l} ${k}`);
  }
});
