'use strict';

// Letter Trails — strings for the Settings panel's General/Graphics tabs in
// every required locale. The rest of the game is English-only for now (spec
// §10); this table is chosen from navigator.language.

const EN = {
  general: 'General', graphics: 'Graphics', quality: 'Quality', auto: 'Auto (detected: {tier})',
  preset_low: 'Low', preset_balanced: 'Balanced', preset_high: 'High', preset_ultra: 'Ultra',
  renderScale: 'Render scale', fromPreset: 'From preset ({tier})',
  adaptive: 'Adaptive resolution', showFps: 'Show frame rate',
  postUnavailable: 'Post-processing is unavailable on this device, so the board renders without it.',
  cat_shadows: 'Shadows', cat_ao: 'Ambient occlusion', cat_bloom: 'Bloom', cat_grade: 'Color grade & vignette',
  cat_antialias: 'Anti-aliasing', cat_reflections: 'Reflections', cat_detail: 'Surface detail', cat_particles: 'Particles',
  tier_off: 'Off', tier_on: 'On', tier_low: 'Low', tier_medium: 'Medium', tier_high: 'High',
  tier_plain: 'Plain', tier_detailed: 'Detailed', tier_fxaa: 'FXAA', tier_smaa: 'SMAA', tier_msaa: 'MSAA',
  d_noShadows: 'no shadows', d_shadows: '{n}² shadows', d_ao: 'ambient occlusion', d_aoHigh: 'full ambient occlusion',
  d_bloom: 'bloom', d_reflections: 'reflections', d_particles: 'particles',
};

const ES = {
  general: 'General', graphics: 'Gráficos', quality: 'Calidad', auto: 'Automática (detectada: {tier})',
  preset_low: 'Baja', preset_balanced: 'Equilibrada', preset_high: 'Alta', preset_ultra: 'Ultra',
  renderScale: 'Escala de renderizado', fromPreset: 'Según el ajuste ({tier})',
  adaptive: 'Resolución adaptativa', showFps: 'Mostrar fotogramas por segundo',
  postUnavailable: 'El posprocesado no está disponible en este dispositivo, así que el tablero se muestra sin él.',
  cat_shadows: 'Sombras', cat_ao: 'Oclusión ambiental', cat_bloom: 'Resplandor', cat_grade: 'Gradación de color y viñeta',
  cat_antialias: 'Suavizado de bordes', cat_reflections: 'Reflejos', cat_detail: 'Detalle de superficies', cat_particles: 'Partículas',
  tier_off: 'Desactivado', tier_on: 'Activado', tier_low: 'Bajo', tier_medium: 'Medio', tier_high: 'Alto',
  tier_plain: 'Simple', tier_detailed: 'Detallado', tier_fxaa: 'FXAA', tier_smaa: 'SMAA', tier_msaa: 'MSAA',
  d_noShadows: 'sin sombras', d_shadows: 'sombras {n}²', d_ao: 'oclusión ambiental', d_aoHigh: 'oclusión ambiental completa',
  d_bloom: 'resplandor', d_reflections: 'reflejos', d_particles: 'partículas',
};

const FR = {
  general: 'Général', graphics: 'Graphismes', quality: 'Qualité', auto: 'Auto (détectée : {tier})',
  preset_low: 'Basse', preset_balanced: 'Équilibrée', preset_high: 'Haute', preset_ultra: 'Ultra',
  renderScale: 'Échelle de rendu', fromPreset: 'Selon le préréglage ({tier})',
  adaptive: 'Résolution adaptative', showFps: 'Afficher les images par seconde',
  postUnavailable: 'Le post-traitement n’est pas disponible sur cet appareil ; le plateau s’affiche sans.',
  cat_shadows: 'Ombres', cat_ao: 'Occlusion ambiante', cat_bloom: 'Halo lumineux', cat_grade: 'Étalonnage et vignettage',
  cat_antialias: 'Anticrénelage', cat_reflections: 'Reflets', cat_detail: 'Détail des surfaces', cat_particles: 'Particules',
  tier_off: 'Désactivé', tier_on: 'Activé', tier_low: 'Bas', tier_medium: 'Moyen', tier_high: 'Élevé',
  tier_plain: 'Simple', tier_detailed: 'Détaillé', tier_fxaa: 'FXAA', tier_smaa: 'SMAA', tier_msaa: 'MSAA',
  d_noShadows: 'sans ombres', d_shadows: 'ombres {n}²', d_ao: 'occlusion ambiante', d_aoHigh: 'occlusion ambiante complète',
  d_bloom: 'halo', d_reflections: 'reflets', d_particles: 'particules',
};

export const STRINGS = {
  'en-US': EN,
  'en-GB': { ...EN, cat_grade: 'Colour grade & vignette' },
  'es-419': { ...ES, tier_off: 'Apagado', tier_on: 'Encendido', showFps: 'Mostrar cuadros por segundo' },
  'es-ES': ES,
  'de-DE': {
    general: 'Allgemein', graphics: 'Grafik', quality: 'Qualität', auto: 'Automatisch (erkannt: {tier})',
    preset_low: 'Niedrig', preset_balanced: 'Ausgewogen', preset_high: 'Hoch', preset_ultra: 'Ultra',
    renderScale: 'Renderskalierung', fromPreset: 'Voreinstellung ({tier})',
    adaptive: 'Adaptive Auflösung', showFps: 'Bildrate anzeigen',
    postUnavailable: 'Nachbearbeitung ist auf diesem Gerät nicht verfügbar, daher wird das Brett ohne sie dargestellt.',
    cat_shadows: 'Schatten', cat_ao: 'Umgebungsverdeckung', cat_bloom: 'Leuchteffekt', cat_grade: 'Farbkorrektur & Vignette',
    cat_antialias: 'Kantenglättung', cat_reflections: 'Spiegelungen', cat_detail: 'Oberflächendetails', cat_particles: 'Partikel',
    tier_off: 'Aus', tier_on: 'An', tier_low: 'Niedrig', tier_medium: 'Mittel', tier_high: 'Hoch',
    tier_plain: 'Schlicht', tier_detailed: 'Detailliert', tier_fxaa: 'FXAA', tier_smaa: 'SMAA', tier_msaa: 'MSAA',
    d_noShadows: 'keine Schatten', d_shadows: '{n}²-Schatten', d_ao: 'Umgebungsverdeckung', d_aoHigh: 'volle Umgebungsverdeckung',
    d_bloom: 'Leuchteffekt', d_reflections: 'Spiegelungen', d_particles: 'Partikel',
  },
  'fr-FR': FR,
  'fr-CA': { ...FR, graphics: 'Graphiques', auto: 'Auto (détectée: {tier})', showFps: 'Afficher la fréquence d’images',
    postUnavailable: 'Le post-traitement n’est pas offert sur cet appareil; le plateau s’affiche sans.' },
  'pt-BR': {
    general: 'Geral', graphics: 'Gráficos', quality: 'Qualidade', auto: 'Automática (detectada: {tier})',
    preset_low: 'Baixa', preset_balanced: 'Equilibrada', preset_high: 'Alta', preset_ultra: 'Ultra',
    renderScale: 'Escala de renderização', fromPreset: 'Da predefinição ({tier})',
    adaptive: 'Resolução adaptativa', showFps: 'Mostrar taxa de quadros',
    postUnavailable: 'O pós-processamento não está disponível neste dispositivo, então o tabuleiro é exibido sem ele.',
    cat_shadows: 'Sombras', cat_ao: 'Oclusão de ambiente', cat_bloom: 'Brilho', cat_grade: 'Gradação de cor e vinheta',
    cat_antialias: 'Suavização de serrilhado', cat_reflections: 'Reflexos', cat_detail: 'Detalhe das superfícies', cat_particles: 'Partículas',
    tier_off: 'Desligado', tier_on: 'Ligado', tier_low: 'Baixo', tier_medium: 'Médio', tier_high: 'Alto',
    tier_plain: 'Simples', tier_detailed: 'Detalhado', tier_fxaa: 'FXAA', tier_smaa: 'SMAA', tier_msaa: 'MSAA',
    d_noShadows: 'sem sombras', d_shadows: 'sombras {n}²', d_ao: 'oclusão de ambiente', d_aoHigh: 'oclusão de ambiente completa',
    d_bloom: 'brilho', d_reflections: 'reflexos', d_particles: 'partículas',
  },
  'it-IT': {
    general: 'Generale', graphics: 'Grafica', quality: 'Qualità', auto: 'Automatica (rilevata: {tier})',
    preset_low: 'Bassa', preset_balanced: 'Bilanciata', preset_high: 'Alta', preset_ultra: 'Ultra',
    renderScale: 'Scala di rendering', fromPreset: 'Dalla preimpostazione ({tier})',
    adaptive: 'Risoluzione adattiva', showFps: 'Mostra fotogrammi al secondo',
    postUnavailable: 'La post-elaborazione non è disponibile su questo dispositivo, quindi il tabellone viene mostrato senza.',
    cat_shadows: 'Ombre', cat_ao: 'Occlusione ambientale', cat_bloom: 'Bagliore', cat_grade: 'Correzione colore e vignettatura',
    cat_antialias: 'Antialiasing', cat_reflections: 'Riflessi', cat_detail: 'Dettaglio superfici', cat_particles: 'Particelle',
    tier_off: 'Disattivato', tier_on: 'Attivato', tier_low: 'Basso', tier_medium: 'Medio', tier_high: 'Alto',
    tier_plain: 'Semplice', tier_detailed: 'Dettagliato', tier_fxaa: 'FXAA', tier_smaa: 'SMAA', tier_msaa: 'MSAA',
    d_noShadows: 'senza ombre', d_shadows: 'ombre {n}²', d_ao: 'occlusione ambientale', d_aoHigh: 'occlusione ambientale completa',
    d_bloom: 'bagliore', d_reflections: 'riflessi', d_particles: 'particelle',
  },
};

export function pickLocale(lang) {
  const l = String(lang || '').replace('_', '-');
  const exact = Object.keys(STRINGS).find((k) => k.toLowerCase() === l.toLowerCase());
  if (exact) return exact;
  const base = l.slice(0, 2).toLowerCase();
  if (base === 'en') return /^en-(gb|ie|au|nz|za|in)/i.test(l) ? 'en-GB' : 'en-US';
  return { es: 'es-419', de: 'de-DE', fr: 'fr-FR', pt: 'pt-BR', it: 'it-IT' }[base] || 'en-US';
}

let table = EN;
export function setLocale(lang) { table = STRINGS[pickLocale(lang)] || EN; }

export function t(key, vars) {
  let s = table[key] ?? EN[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace('{' + k + '}', v);
  return s;
}

/** Localized fragments for gfx.describe(). */
export function describeWords() {
  return {
    noShadows: t('d_noShadows'), shadows: t('d_shadows'), ao: t('d_ao'), aoHigh: t('d_aoHigh'),
    bloom: t('d_bloom'), reflections: t('d_reflections'), particles: t('d_particles'),
  };
}
