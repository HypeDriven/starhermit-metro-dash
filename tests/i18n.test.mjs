// Localization coverage: every English key the engine client (native/*.ts)
// and the content show is translated in every locale (en-GB → en-US, es-ES →
// es-419, fr-CA → fr-FR inherit), placeholders survive, no table keeps a key
// nothing shows, the account lines exist in every locale, and js/i18n.js
// switches locale as native/i18n.ts drives it.
// Run: node --test tests/i18n.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { loadTables, codeKeys, audit, bootI18n, LOCALES } from './i18n-common.mjs';
import { SH_STRINGS } from '../js/sh-strings.js';
import { LESSONS, CHALLENGES, ACHIEVEMENTS, JOURNEY_STAGES, THEMES } from '../js/content.js';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

export function usedKeys() {
  const keys = new Set();
  for (const f of readdirSync(new URL('native/', ROOT)).filter((n) => n.endsWith('.ts'))) codeKeys(read('native/' + f)).forEach((k) => keys.add(k));
  codeKeys(read('js/content.js')).forEach((k) => keys.add(k));
  for (const it of [...LESSONS, ...CHALLENGES]) { keys.add(it.label); keys.add(it.briefing); }
  for (const a of ACHIEVEMENTS) { keys.add(a.label); keys.add(a.desc); }
  for (const s of JOURNEY_STAGES) for (const m of s.introduces) keys.add(m);
  return [...keys].filter((k) => /[A-Za-z]/.test(k) && k !== 'Metro Dash' && k !== 'METRO DASH').sort();
}

test('every used key is translated in every locale; placeholders intact; nothing stale', () => {
  const used = usedKeys();
  assert.ok(used.length > 150, `keys found: ${used.length}`);
  void THEMES;
  assert.deepEqual(audit(loadTables(ROOT, 'js/strings.js', 'MD_STRINGS'), used), []);
});

test('the account and leaderboard lines exist in every locale with their placeholders', () => {
  const en = SH_STRINGS['en-US'];
  for (const loc of LOCALES) {
    const t = SH_STRINGS[loc];
    assert.ok(t, loc);
    for (const k of Object.keys(en)) {
      assert.ok(t[k], `${loc} ${k}`);
      assert.deepEqual((t[k].match(/\{\w+\}/g) || []).sort(), (en[k].match(/\{\w+\}/g) || []).sort(), `${loc} ${k}`);
    }
  }
});

test('the locale switches as the engine client sets it', () => {
  const { I18N } = bootI18n(ROOT, { strings: 'js/strings.js', i18n: 'js/i18n.js', global: 'MDI18N' });
  assert.equal(I18N.lang, 'en-US');
  assert.equal(I18N.setLocale('de-DE'), 'de-DE');
  assert.equal(I18N.T('Distance'), 'Strecke');
  I18N.setLocale('fr-CA');
  assert.equal(I18N.T('Score'), 'Pointage');
  assert.equal(I18N.T('Distance'), 'Distance');
  I18N.setLocale('en-GB');
  assert.equal(I18N.T('Color palette'), 'Colour palette');
  I18N.setLocale('es-ES');
  assert.equal(I18N.T('Settings'), 'Ajustes');
  assert.equal(I18N.T('Reach {n} units', { n: 900 }), 'Llega a 900 unidades');
  assert.equal(I18N.setLocale('xx'), 'en-US');
});
