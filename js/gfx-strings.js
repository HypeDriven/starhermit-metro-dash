// Localized strings for the Graphics settings section (the rest of the game is
// English-only; see spec §10). Locale comes from navigator.languages.

const EN = {
  legend: 'Graphics',
  quality: 'Quality',
  auto: 'Auto (detected: {tier})',
  renderScale: 'Render scale',
  fromPreset: 'From preset ({tier})',
  adaptive: 'Adaptive resolution',
  showFps: 'Show frame rate',
  postFailed: 'Post-processing is unavailable on this device — rendering without effects.',
  unavailable: '3D graphics unavailable — the compatibility renderer ignores these options.',
  presets: { low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra' },
  cats: {
    shadows: 'Shadows', ao: 'Ambient occlusion', bloom: 'Bloom', grade: 'Color grade',
    antialias: 'Anti-aliasing', reflections: 'Reflections', particles: 'Particles', detail: 'City detail',
  },
  tiers: {
    off: 'Off', on: 'On', low: 'Low', medium: 'Medium', high: 'High',
    fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Plain', detailed: 'Detailed',
  },
  words: {
    noShadows: 'no shadows', shadows: 'shadows', ao: 'ambient occlusion', aoHigh: 'full ambient occlusion',
    bloom: 'bloom', reflections: 'reflections', noAA: 'no anti-aliasing',
  },
};

const ES = {
  legend: 'Gráficos',
  quality: 'Calidad',
  auto: 'Automática (detectada: {tier})',
  renderScale: 'Escala de renderizado',
  fromPreset: 'Del ajuste ({tier})',
  adaptive: 'Resolución adaptativa',
  showFps: 'Mostrar fotogramas por segundo',
  postFailed: 'El posprocesado no está disponible en este dispositivo: se muestra sin efectos.',
  unavailable: 'Gráficos 3D no disponibles: el renderizador de compatibilidad ignora estas opciones.',
  presets: { low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra' },
  cats: {
    shadows: 'Sombras', ao: 'Oclusión ambiental', bloom: 'Resplandor', grade: 'Corrección de color',
    antialias: 'Antialiasing', reflections: 'Reflejos', particles: 'Partículas', detail: 'Detalle de la ciudad',
  },
  tiers: {
    off: 'No', on: 'Sí', low: 'Bajas', medium: 'Medias', high: 'Altas',
    fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simple', detailed: 'Detallado',
  },
  words: {
    noShadows: 'sin sombras', shadows: 'sombras', ao: 'oclusión ambiental', aoHigh: 'oclusión ambiental completa',
    bloom: 'resplandor', reflections: 'reflejos', noAA: 'sin antialiasing',
  },
};

const FR = {
  legend: 'Graphismes',
  quality: 'Qualité',
  auto: 'Auto (détectée : {tier})',
  renderScale: 'Échelle de rendu',
  fromPreset: 'Selon le préréglage ({tier})',
  adaptive: 'Résolution adaptative',
  showFps: 'Afficher les images par seconde',
  postFailed: 'Le post-traitement n’est pas disponible sur cet appareil : rendu sans effets.',
  unavailable: 'Graphismes 3D indisponibles : le moteur de compatibilité ignore ces options.',
  presets: { low: 'Basse', balanced: 'Équilibrée', high: 'Haute', ultra: 'Ultra' },
  cats: {
    shadows: 'Ombres', ao: 'Occlusion ambiante', bloom: 'Flou lumineux', grade: 'Étalonnage',
    antialias: 'Anticrénelage', reflections: 'Reflets', particles: 'Particules', detail: 'Détails de la ville',
  },
  tiers: {
    off: 'Non', on: 'Oui', low: 'Basses', medium: 'Moyennes', high: 'Hautes',
    fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simple', detailed: 'Détaillé',
  },
  words: {
    noShadows: 'sans ombres', shadows: 'ombres', ao: 'occlusion ambiante', aoHigh: 'occlusion ambiante complète',
    bloom: 'flou lumineux', reflections: 'reflets', noAA: 'sans anticrénelage',
  },
};

export const GFX_STRINGS = {
  'en-US': EN,
  'en-GB': {
    ...EN,
    cats: { ...EN.cats, grade: 'Colour grade' },
  },
  'es-419': ES,
  'es-ES': {
    ...ES,
    showFps: 'Mostrar imágenes por segundo',
    cats: { ...ES.cats, antialias: 'Suavizado de bordes' },
    words: { ...ES.words, noAA: 'sin suavizado de bordes' },
  },
  'de-DE': {
    legend: 'Grafik',
    quality: 'Qualität',
    auto: 'Automatisch (erkannt: {tier})',
    renderScale: 'Renderskalierung',
    fromPreset: 'Aus Voreinstellung ({tier})',
    adaptive: 'Adaptive Auflösung',
    showFps: 'Bildrate anzeigen',
    postFailed: 'Nachbearbeitung ist auf diesem Gerät nicht verfügbar – Darstellung ohne Effekte.',
    unavailable: '3D-Grafik nicht verfügbar – der Kompatibilitätsmodus ignoriert diese Optionen.',
    presets: { low: 'Niedrig', balanced: 'Ausgewogen', high: 'Hoch', ultra: 'Ultra' },
    cats: {
      shadows: 'Schatten', ao: 'Umgebungsverdeckung', bloom: 'Leuchteffekt', grade: 'Farbkorrektur',
      antialias: 'Kantenglättung', reflections: 'Spiegelungen', particles: 'Partikel', detail: 'Stadtdetails',
    },
    tiers: {
      off: 'Aus', on: 'An', low: 'Niedrig', medium: 'Mittel', high: 'Hoch',
      fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Einfach', detailed: 'Detailliert',
    },
    words: {
      noShadows: 'keine Schatten', shadows: 'Schatten', ao: 'Umgebungsverdeckung', aoHigh: 'volle Umgebungsverdeckung',
      bloom: 'Leuchteffekt', reflections: 'Spiegelungen', noAA: 'keine Kantenglättung',
    },
  },
  'fr-FR': FR,
  'fr-CA': {
    ...FR,
    showFps: 'Afficher la fréquence d’images',
    cats: { ...FR.cats, bloom: 'Halo lumineux' },
    words: { ...FR.words, bloom: 'halo lumineux' },
  },
  'pt-BR': {
    legend: 'Gráficos',
    quality: 'Qualidade',
    auto: 'Automática (detectada: {tier})',
    renderScale: 'Escala de renderização',
    fromPreset: 'Da predefinição ({tier})',
    adaptive: 'Resolução adaptável',
    showFps: 'Mostrar taxa de quadros',
    postFailed: 'O pós-processamento não está disponível neste dispositivo — renderizando sem efeitos.',
    unavailable: 'Gráficos 3D indisponíveis — o renderizador de compatibilidade ignora estas opções.',
    presets: { low: 'Baixa', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra' },
    cats: {
      shadows: 'Sombras', ao: 'Oclusão ambiente', bloom: 'Brilho', grade: 'Correção de cor',
      antialias: 'Suavização de serrilhado', reflections: 'Reflexos', particles: 'Partículas', detail: 'Detalhes da cidade',
    },
    tiers: {
      off: 'Desligado', on: 'Ligado', low: 'Baixas', medium: 'Médias', high: 'Altas',
      fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simples', detailed: 'Detalhado',
    },
    words: {
      noShadows: 'sem sombras', shadows: 'sombras', ao: 'oclusão ambiente', aoHigh: 'oclusão ambiente completa',
      bloom: 'brilho', reflections: 'reflexos', noAA: 'sem suavização',
    },
  },
  'it-IT': {
    legend: 'Grafica',
    quality: 'Qualità',
    auto: 'Automatica (rilevata: {tier})',
    renderScale: 'Scala di rendering',
    fromPreset: 'Dal preset ({tier})',
    adaptive: 'Risoluzione adattiva',
    showFps: 'Mostra frequenza fotogrammi',
    postFailed: 'La post-elaborazione non è disponibile su questo dispositivo: rendering senza effetti.',
    unavailable: 'Grafica 3D non disponibile: il renderer di compatibilità ignora queste opzioni.',
    presets: { low: 'Bassa', balanced: 'Bilanciata', high: 'Alta', ultra: 'Ultra' },
    cats: {
      shadows: 'Ombre', ao: 'Occlusione ambientale', bloom: 'Bagliore', grade: 'Correzione colore',
      antialias: 'Anti-aliasing', reflections: 'Riflessi', particles: 'Particelle', detail: 'Dettagli città',
    },
    tiers: {
      off: 'No', on: 'Sì', low: 'Basse', medium: 'Medie', high: 'Alte',
      fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Semplice', detailed: 'Dettagliato',
    },
    words: {
      noShadows: 'senza ombre', shadows: 'ombre', ao: 'occlusione ambientale', aoHigh: 'occlusione ambientale completa',
      bloom: 'bagliore', reflections: 'riflessi', noAA: 'senza anti-aliasing',
    },
  },
};

const LANG_DEFAULT = { en: 'en-US', es: 'es-419', fr: 'fr-FR', de: 'de-DE', pt: 'pt-BR', it: 'it-IT' };

/** Best supported locale tag for a list of BCP-47 preferences. */
export function pickGfxLocale(prefs) {
  for (const raw of prefs || []) {
    const tag = String(raw || '');
    const exact = Object.keys(GFX_STRINGS).find((k) => k.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
    const lang = tag.split('-')[0].toLowerCase();
    if (lang === 'es' && /^es-(419|MX|AR|CO|CL|PE|US)/i.test(tag)) return 'es-419';
    if (LANG_DEFAULT[lang]) return LANG_DEFAULT[lang];
  }
  return 'en-US';
}

export function gfxStrings(prefs) {
  return GFX_STRINGS[pickGfxLocale(prefs)];
}
