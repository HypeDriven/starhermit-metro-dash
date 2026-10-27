/* Metro Dash — localization core (classic script; global MDI18N).
 *
 * Nine locales: en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT.
 * English source strings are the keys; js/strings.js holds the tables
 * (en-GB, es-ES and fr-CA carry only their differences from en-US, es-419
 * and fr-FR). The engine client (native/i18n.ts) picks the locale from the
 * runtime's interface language (Options › Language, else the account's or
 * the device's) and calls setLocale; every string drawn is looked up with T()
 * each frame, so a change shows at once. js/lang.js (the game modules' T)
 * reads this global; outside the engine (Node tests) English keys come back.
 */
(function (root) {
  'use strict';

  var LOCALES = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
  var PARENT = { 'en-GB': 'en-US', 'es-ES': 'es-419', 'fr-CA': 'fr-FR' };
  var hasOwn = Object.prototype.hasOwnProperty;
  var lang = 'en-US';

  function lookup(key) {
    var tables = root.MD_STRINGS || {};
    for (var l = lang; l; l = PARENT[l]) {
      var t = tables[l];
      if (t && hasOwn.call(t, key)) return t[key];
    }
    return key;
  }

  /** Translate an English source string; {name} placeholders filled from vars. */
  function T(key, vars) {
    var s = lookup(String(key));
    if (vars) s = s.replace(/\{(\w+)\}/g, function (m, k) { return hasOwn.call(vars, k) ? String(vars[k]) : m; });
    return s;
  }

  function setLocale(next) {
    lang = LOCALES.indexOf(next) >= 0 ? next : 'en-US';
    return lang;
  }

  root.MDI18N = {
    T: T,
    setLocale: setLocale,
    get lang() { return lang; },
    locales: LOCALES,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
