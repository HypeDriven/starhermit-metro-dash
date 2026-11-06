// Localization coverage: every English key the engine client (native/*.ts)
// and the content show is translated in every locale (en-GB → en-US, es-ES →
// es-419, fr-CA → fr-FR inherit), placeholders survive, no table keeps a key
// nothing shows, and the tables chain as the engine reads them.
// Run: node --test tests/i18n.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { codeKeys, audit } from './i18n-common.mjs';
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
  return [...keys].filter((k) => /[A-Za-z]/.test(k) && k !== 'Metro Dash' && k !== 'METRO DASH' && !k.startsWith('starhermit.')).sort();
}

test('every used key is translated in every locale; placeholders intact; nothing stale', () => {
  const used = usedKeys();
  assert.ok(used.length > 150, `keys found: ${used.length}`);
  void THEMES;
  assert.deepEqual(audit(JSON.parse(read('assets/strings.json')), used), []);
});

test('the tables chain as the engine reads them (en-GB, es-ES, fr-CA carry only their differences)', () => {
  const tables = JSON.parse(read('assets/strings.json'));
  const CHAIN = { 'en-GB': 'en-US', 'es-ES': 'es-419', 'fr-CA': 'fr-FR' };
  const tr = (loc, k) => tables[loc][k] ?? (CHAIN[loc] ? tr(CHAIN[loc], k) : k);
  assert.equal(tr('de-DE', 'Distance'), 'Strecke');
  assert.equal(tr('fr-CA', 'Score'), 'Pointage');
  assert.equal(tr('fr-CA', 'Distance'), 'Distance');
  assert.equal(tr('en-GB', 'Color palette'), 'Colour palette');
  assert.equal(tr('es-ES', 'Settings'), 'Ajustes');
  assert.equal(tr('es-ES', 'Reach {n} units').replace('{n}', '900'), 'Llega a 900 unidades');
});
