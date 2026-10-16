'use strict';

// Letter Trails — DOM shell controller. Semantic HTML over the canvas for
// every menu, overlay, and status surface. UI state is separate from rules
// state; closing a panel can never affect a round.

import { twoDigit } from './util.js';
import { CATEGORIES, PRESETS, presetTier } from './gfx.js';
import * as gi18n from './gfx-i18n.js';
import { T, N, getLang } from './i18n.js';

// Word-bank keys (content.js) → display names; the words themselves are English data.
const BANK_NAMES = { ocean: N('Ocean'), forest: N('Forest'), kitchen: N('Kitchen'), space: N('Space'), music: N('Music'), garden: N('Garden') };
export const themeName = (key) => (BANK_NAMES[key] ? T(BANK_NAMES[key]) : key || '');

const $ = (id) => document.getElementById(id);

const screens = {};
let currentScreen = null;
let lastFocus = null;
let settingsReturnTo = null;

const handlers = {}; // event name -> fn, wired by main.js via on()

export function on(event, fn) { handlers[event] = fn; }
function emit(event, arg) { if (handlers[event]) handlers[event](arg); }

// ---------------------------------------------------------------------------
// Screen management + focus restoration
// ---------------------------------------------------------------------------

export function showScreen(name) {
  if (currentScreen && screens[currentScreen]) {
    lastFocus = document.activeElement;
  }
  for (const [key, el] of Object.entries(screens)) {
    el.classList.toggle('visible', key === name);
  }
  currentScreen = name;
  if (name && screens[name]) {
    const first = screens[name].querySelector('button.primary, button, [tabindex]');
    // preventScroll + reset: a low first button must not scroll the heading
    // away; every screen opens at its top.
    if (first) first.focus({ preventScroll: true });
    for (const n of [screens[name], ...screens[name].querySelectorAll('*')]) if (n.scrollTop) n.scrollTop = 0;
  } else if (lastFocus && document.contains(lastFocus)) {
    lastFocus.focus(); // restore focus after modal/screen closes
  }
}

export function getScreen() { return currentScreen; }

// ---------------------------------------------------------------------------
// Live announcements
// ---------------------------------------------------------------------------

let liveTimer = null;
export function announce(key, assertive = false, vars) {
  const msg = T(key, vars);
  const el = $(assertive ? 'live-assertive' : 'live');
  el.textContent = '';
  // Clear then set so repeated messages are re-announced.
  requestAnimationFrame(() => { el.textContent = msg; });
  if (!assertive) {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => { el.textContent = ''; }, 5000);
  }
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

export function showHud(visible) {
  $('hud').classList.toggle('visible', visible);
}

let currentChallenge = null;

function renderLimitLine(movesUsed) {
  const ch = currentChallenge;
  if (!ch) { $('hud-limit').textContent = ''; return; }
  const parts = [];
  if (ch.moveLimit) parts.push(T('Move limit: {limit} (used {used})', { limit: ch.moveLimit, used: movesUsed }));
  if (ch.timeTargetMs) parts.push(T('Time target: {time}', { time: fmtTime(ch.timeTargetMs) }));
  $('hud-limit').textContent = parts.join('. ') + '.';
}

let lastMovesUsed = 0;
export function updateMovesUsed(movesUsed) {
  lastMovesUsed = movesUsed;
  if (currentChallenge) renderLimitLine(movesUsed);
}

let objectiveArgs = null;
export function setObjective(def, state) {
  objectiveArgs = [def, state];
  lastMovesUsed = 0;
  renderObjective();
  renderWordList(state);
  updateProgress(state);
  currentChallenge = def.mechanics && def.mechanics.challenge;
  renderLimitLine(0);
}
function renderObjective() {
  if (!objectiveArgs) return;
  const [def, state] = objectiveArgs;
  $('objective').textContent = def.theme
    ? T('Find {n} words — {theme}', { n: state.words.length, theme: themeName(def.theme) })
    : T('Find {n} words', { n: state.words.length });
  $('board-desc').textContent = T('Board is {size} by {size} letters. {n} words to find. Use arrow keys to move between cells.', { size: state.size, n: state.words.length });
}

export function renderWordList(state) {
  const ul = $('word-list');
  ul.textContent = '';
  for (const w of state.words) {
    const li = document.createElement('li');
    li.textContent = w.word;
    li.className = w.found ? 'found' : '';
    ul.appendChild(li);
  }
}

let lastProgress = null;
export function updateProgress(state) {
  lastProgress = state;
  $('progress-text').textContent = T('{found} of {total}', { found: state.foundCount, total: state.words.length });
  $('hud-score').textContent = String(state.score.total);
}

export function updateClock(elapsedMs) {
  const s = Math.floor(elapsedMs / 1000);
  $('hud-time').textContent = Math.floor(s / 60) + ':' + twoDigit(s % 60);
}

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ':' + twoDigit(s % 60);
}

// ---------------------------------------------------------------------------
// Screens content
// ---------------------------------------------------------------------------

// def.label / def.desc / rankedLabel are [key, vars] pairs (main.js) so this
// screen re-renders in another language.
const txt = (v) => (Array.isArray(v) ? T(v[0], resolveVars(v[1])) : T(v || ''));
const resolveVars = (vars) => vars && Object.fromEntries(Object.entries(vars).map(([k, x]) => [k, typeof x === 'function' ? x() : x]));
let modeArgs = null;
export function showModeSetup(def, opts) {
  modeArgs = [def, opts];
  renderModeSetup();
  showScreen('mode');
}
function renderModeSetup() {
  if (!modeArgs) return;
  const [def, { ranked, rankedLabel }] = modeArgs;
  $('mode-h').textContent = def.label ? txt(def.label) : def.id;
  $('mode-desc').textContent = def.desc ? txt(def.desc) : '';
  const dl = $('mode-facts');
  dl.textContent = '';
  const facts = [
    [N('Board'), def.size + ' × ' + def.size],
    [N('Words'), String(def.wordCount)],
    [N('Theme'), themeName(def.theme)],
    [N('Par'), T('{moves} moves, {time}', { moves: def.par.moves, time: fmtTime(def.par.timeMs) })],
    [N('Expected duration'), T('{n} min', { n: Math.max(1, Math.round(def.par.timeMs / 60000)) })],
    [N('Players'), '1'],
    [N('Ranked'), ranked ? (rankedLabel ? txt(rankedLabel) : T('Yes — validated replay submitted')) : T('No')],
  ];
  const ch = def.mechanics && def.mechanics.challenge;
  if (ch && ch.moveLimit) facts.push([N('Move limit'), String(ch.moveLimit)]);
  if (ch && ch.timeTargetMs) facts.push([N('Time target'), fmtTime(ch.timeTargetMs)]);
  for (const [k, v] of facts) {
    const dt = document.createElement('dt'); dt.textContent = T(k);
    const dd = document.createElement('dd'); dd.textContent = v;
    dl.append(dt, dd);
  }
}

let resultsArgs = null;
export function showResults(state, opts) {
  resultsArgs = [state, opts];
  renderResults();
  $('leaderboard-box').innerHTML = (opts && opts.leaderboardHtml) || '';
  $('results-lb').hidden = true;
  $('results-lb').textContent = '';
  showScreen('results');
  announce('Round finished. Total score {score}.', true, { score: state.score.total });
}
function renderResults() {
  if (!resultsArgs) return;
  const [state, { achievements = [], best = false, nextLabel = N('Next'), constraint = null }] = resultsArgs;
  $('results-h').textContent = state.status === 'complete' ? T('Board Complete!') : T('Round Over');
  const box = $('score-breakdown');
  box.textContent = '';
  const rows = [
    [T('Words ({n})', { n: state.foundCount }), state.score.wordPoints],
    [T('Clean bonuses'), state.score.cleanBonus],
    [T('Speed bonuses'), state.score.speedBonus],
    [T('Daily streak bonus'), state.score.streakBonus],
    [T('Total'), state.score.total, true],
  ];
  for (const [label, val, total] of rows) {
    const div = document.createElement('div');
    div.className = 'score-row' + (total ? ' total' : '');
    div.innerHTML = '<span></span><span></span>';
    div.children[0].textContent = label;
    div.children[1].textContent = String(val);
    box.appendChild(div);
  }
  $('results-extra').textContent =
    T('Time {time} · Invalid selections {n}', { time: fmtTime(state.elapsedMs), n: state.invalidActions }) +
    (best ? ' · ' + T('New best score!') : '') + (constraint ? ' · ' + txt(constraint) : '');
  const ach = $('achievements-earned');
  ach.textContent = '';
  for (const a of achievements) {
    const p = document.createElement('p');
    p.textContent = '🏆 ' + T('Achievement unlocked: {name} — {desc}', { name: T(a.name), desc: T(a.desc) });
    ach.appendChild(p);
  }
  $('btn-next').textContent = T(nextLabel);
}

let journeyArgs = null;
export function renderJourneyGrid(levels, completed, onPick) {
  journeyArgs = [levels, completed, onPick];
  const grid = $('journey-grid');
  grid.textContent = '';
  levels.forEach((lv, i) => {
    const b = document.createElement('button');
    const n = i + 1;
    const done = completed.includes(lv.id);
    const unlocked = i === 0 || completed.includes(levels[i - 1].id) || done;
    b.textContent = (lv.mechanics.mastery ? '★' : '') + n;
    b.className = done ? 'done' : '';
    b.disabled = !unlocked;
    const key = lv.mechanics.mastery
      ? (done ? N('Level {n} (mastery), completed') : unlocked ? N('Level {n} (mastery)') : N('Level {n} (mastery), locked'))
      : (done ? N('Level {n}, completed') : unlocked ? N('Level {n}') : N('Level {n}, locked'));
    b.setAttribute('aria-label', T(key, { n }));
    if (unlocked) b.addEventListener('click', () => onPick(lv));
    grid.appendChild(b);
  });
}

let challengeArgs = null;
export function renderChallengeList(challenges, onPick) {
  challengeArgs = [challenges, onPick];
  const box = $('challenge-list');
  box.textContent = '';
  for (const c of challenges) {
    const b = document.createElement('button');
    const parts = [];
    if (c.mechanics.challenge.moveLimit) parts.push(T('move limit {n}', { n: c.mechanics.challenge.moveLimit }));
    if (c.mechanics.challenge.timeTargetMs) parts.push(T('target {time}', { time: fmtTime(c.mechanics.challenge.timeTargetMs) }));
    b.textContent = T(c.label) + ' — ' + parts.join(', ');
    b.addEventListener('click', () => onPick(c));
    box.appendChild(b);
  }
}

let tutorialArgs = null;
export function showTutorial(step, isLast) {
  tutorialArgs = [step, isLast];
  renderTutorial();
  showScreen('tutorial');
}
function renderTutorial() {
  if (!tutorialArgs) return;
  const [step, isLast] = tutorialArgs;
  $('tutorial-h').textContent = T(step.title);
  $('tutorial-text').textContent = T(step.text);
  $('btn-tutorial-next').textContent = isLast ? T('Start Playing') : T('Got it');
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function openSettings(settings, returnTo) {
  settingsReturnTo = returnTo || currentScreen;
  $('set-music').value = settings.musicVolume;
  $('set-effects').value = settings.effectsVolume;
  $('set-ambience').value = settings.ambienceVolume;
  $('set-reduced-motion').checked = settings.reducedMotion;
  $('set-high-contrast').checked = settings.highContrast;
  $('set-colorvision').value = settings.colorVision;
  $('set-larger-text').checked = settings.largerText;
  $('set-left-handed').checked = settings.leftHanded;
  selectSettingsTab('general');
  showScreen('settings');
  emit('graphics-refresh');
}

export function readSettingsForm(settings) {
  settings.musicVolume = parseFloat($('set-music').value);
  settings.effectsVolume = parseFloat($('set-effects').value);
  settings.ambienceVolume = parseFloat($('set-ambience').value);
  settings.reducedMotion = $('set-reduced-motion').checked;
  settings.highContrast = $('set-high-contrast').checked;
  settings.colorVision = $('set-colorvision').value;
  settings.largerText = $('set-larger-text').checked;
  settings.leftHanded = $('set-left-handed').checked;
  return settings;
}

export function applyAccessibilityClasses(settings) {
  document.body.classList.toggle('larger-text', settings.largerText);
  document.body.classList.toggle('high-contrast', settings.highContrast);
  document.body.classList.toggle('left-handed', settings.leftHanded);
}

// ---------------------------------------------------------------------------
// Wire static buttons once
// ---------------------------------------------------------------------------

export function init() {
  for (const name of ['title', 'mode', 'journey', 'practice', 'challenge', 'pause', 'settings', 'results', 'help', 'tutorial']) {
    screens[name] = $('screen-' + name);
  }
  const wire = (id, event) => $(id).addEventListener('click', () => emit(event));
  wire('btn-play', 'play');
  wire('btn-daily', 'daily');
  wire('btn-journey', 'journey');
  wire('btn-practice', 'practice');
  wire('btn-challenge', 'challenge');
  wire('btn-help', 'help');
  wire('btn-settings', 'settings');
  wire('btn-signin', 'signin');
  wire('btn-invite', 'invite');
  wire('btn-mode-start', 'mode-start');
  wire('btn-mode-back', 'back-title');
  wire('btn-journey-back', 'back-title');
  wire('btn-practice-back', 'back-title');
  wire('btn-challenge-back', 'back-title');
  wire('btn-pause', 'pause');
  wire('tray-pause', 'pause');
  wire('btn-hint', 'hint');
  wire('tray-hint', 'hint');
  wire('btn-camera', 'camera-reset');
  wire('btn-resume', 'resume');
  wire('btn-pause-settings', 'pause-settings');
  wire('btn-pause-help', 'pause-help');
  wire('btn-leave', 'leave');
  wire('btn-retry', 'retry');
  wire('btn-next', 'next');
  wire('btn-results-menu', 'back-title');
  wire('btn-help-close', 'help-close');
  wire('btn-settings-close', 'settings-close');
  wire('btn-replay-tutorial', 'replay-tutorial');
  wire('btn-tutorial-next', 'tutorial-next');
  wire('btn-tutorial-skip', 'tutorial-skip');
  document.querySelectorAll('#screen-practice [data-diff]').forEach((b) => {
    b.addEventListener('click', () => emit('practice-pick', b.dataset.diff));
  });
  // Drawer toggles (compact layouts).
  const setDrawer = (side, open) => {
    $('rail-left').classList.toggle('open', side === 'left' && open);
    $('rail-right').classList.toggle('open', side === 'right' && open);
    const anyOpen = $('rail-left').classList.contains('open') || $('rail-right').classList.contains('open');
    $('drawer-scrim').hidden = !anyOpen;
    $('tray-words').setAttribute('aria-expanded', String($('rail-left').classList.contains('open')));
    $('tray-status').setAttribute('aria-expanded', String($('rail-right').classList.contains('open')));
  };
  $('tray-words').addEventListener('click', () => setDrawer('left', !$('rail-left').classList.contains('open')));
  $('tray-status').addEventListener('click', () => setDrawer('right', !$('rail-right').classList.contains('open')));
  // explicit close controls and tap-outside dismissal
  $('rail-left-close').addEventListener('click', () => setDrawer('left', false));
  $('rail-right-close').addEventListener('click', () => setDrawer('right', false));
  $('drawer-scrim').addEventListener('click', () => setDrawer('left', false));
  // Live settings changes.
  for (const id of ['set-music', 'set-effects', 'set-ambience', 'set-reduced-motion',
    'set-high-contrast', 'set-colorvision', 'set-larger-text', 'set-left-handed']) {
    $(id).addEventListener('change', () => emit('settings-change'));
    $(id).addEventListener('input', () => emit('settings-input'));
  }
  initGraphicsPanel();
}

export function closeSettings() {
  showScreen(settingsReturnTo && screens[settingsReturnTo] ? settingsReturnTo : settingsReturnTo);
}

export function setProfileLine(text) { $('profile-line').textContent = text; }

/**
 * The game language changed: data-i18n markup is already re-applied; re-render
 * what code built (graphics labels, HUD, open screens). Never touches the round.
 */
export function relocalize() {
  relabelGraphics();
  renderObjective();
  if (lastProgress) updateProgress(lastProgress);
  if (currentChallenge) renderLimitLine(lastMovesUsed);
  if (currentScreen === 'mode') renderModeSetup();
  if (currentScreen === 'results') renderResults();
  if (currentScreen === 'tutorial') renderTutorial();
  if (currentScreen === 'journey' && journeyArgs) renderJourneyGrid(...journeyArgs);
  if (currentScreen === 'challenge' && challengeArgs) renderChallengeList(...challengeArgs);
}

// Short confirmation toast (its own polite live region).
let toastTimer = null;
export function toast(msg) {
  const el = $('sh-toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

// ---------------------------------------------------------------------------
// Settings tabs + Graphics panel
// ---------------------------------------------------------------------------

const TABS = ['general', 'graphics'];

export function selectSettingsTab(name, focus = false) {
  for (const tab of TABS) {
    const on = tab === name;
    const btn = $('tab-' + tab);
    btn.setAttribute('aria-selected', String(on));
    btn.tabIndex = on ? 0 : -1;
    $('settings-' + tab).hidden = !on;
    if (on && focus) btn.focus();
  }
  if (name === 'graphics') emit('graphics-refresh');
}

// Graphics strings (gfx-i18n.js) follow the game language; relabel in place.
const catLabels = [];
function relabelGraphics() {
  gi18n.setLocale(getLang());
  document.querySelectorAll('[data-i18n-gfx]').forEach((el) => { el.textContent = gi18n.t(el.dataset.i18nGfx); });
  for (const { span, sel, cat } of catLabels) {
    span.textContent = gi18n.t('cat_' + cat);
    for (const o of sel.options) if (o.value !== 'preset') o.textContent = gi18n.t('tier_' + o.value);
  }
  emit('graphics-refresh');
}

function initGraphicsPanel() {
  gi18n.setLocale(getLang());
  document.querySelectorAll('[data-i18n-gfx]').forEach((el) => { el.textContent = gi18n.t(el.dataset.i18nGfx); });
  // Tabs: click, and arrow/Home/End keys between them.
  for (const tab of TABS) {
    const btn = $('tab-' + tab);
    btn.addEventListener('click', () => selectSettingsTab(tab));
    btn.addEventListener('keydown', (e) => {
      const i = TABS.indexOf(tab);
      const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
      if (j === undefined) return;
      e.preventDefault();
      selectSettingsTab(TABS[(j + TABS.length) % TABS.length], true);
    });
  }
  // One select per category, first option "From preset (…)".
  const box = $('gfx-cats');
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    const label = document.createElement('label');
    label.className = 'setting';
    const span = document.createElement('span');
    span.textContent = gi18n.t('cat_' + cat);
    const sel = document.createElement('select');
    sel.id = 'gfx-' + cat;
    sel.dataset.gfx = cat;
    const def = document.createElement('option');
    def.value = 'preset';
    sel.append(def);
    for (const tier of tiers) {
      const o = document.createElement('option');
      o.value = tier;
      o.textContent = gi18n.t('tier_' + tier);
      sel.append(o);
    }
    sel.addEventListener('change', () => emit('graphics-change', { [cat]: sel.value === 'preset' ? null : sel.value }));
    label.append(span, ' ', sel);
    box.append(label);
    catLabels.push({ span, sel, cat });
  }
  const preset = $('set-quality');
  for (const p of ['auto', ...PRESETS]) {
    const o = document.createElement('option');
    o.value = p;
    preset.append(o);
  }
  preset.addEventListener('change', () => emit('graphics-preset', preset.value));
  const scale = $('gfx-scale');
  scale.addEventListener('input', () => { $('gfx-scale-val').textContent = scale.value + '%'; });
  scale.addEventListener('change', () => emit('graphics-change', { render_scale: Number(scale.value) / 100 }));
  $('gfx-adaptive').addEventListener('change', () => emit('graphics-change', { adaptive: $('gfx-adaptive').checked }));
  $('gfx-show-fps').addEventListener('change', () => emit('graphics-change', { show_fps: $('gfx-show-fps').checked }));
  // Keep the summary (pixel size, adaptive scale) fresh while the tab is open.
  setInterval(() => { if (currentScreen === 'settings' && !$('settings-graphics').hidden) emit('graphics-refresh'); }, 1000);
}

/** Reflect saved graphics settings and the renderer's resolved state in the panel. */
export function refreshGraphicsPanel(saved, info) {
  const s = saved || {};
  const r = info.resolved;
  const preset = $('set-quality');
  preset.options[0].textContent = gi18n.t('auto', { tier: gi18n.t('preset_' + info.detected) });
  for (let i = 1; i < preset.options.length; i++) preset.options[i].textContent = gi18n.t('preset_' + preset.options[i].value);
  preset.value = PRESETS.includes(s.preset) ? s.preset : 'auto';
  for (const cat of Object.keys(CATEGORIES)) {
    const sel = $('gfx-' + cat);
    sel.options[0].textContent = gi18n.t('fromPreset', { tier: gi18n.t('tier_' + presetTier(r.preset, cat)) });
    sel.value = CATEGORIES[cat].includes(s[cat]) ? s[cat] : 'preset';
  }
  const pct = Math.round((Number(s.render_scale) || 1) * 100);
  if (document.activeElement !== $('gfx-scale')) {
    $('gfx-scale').value = String(pct);
    $('gfx-scale-val').textContent = pct + '%';
  }
  $('gfx-adaptive').checked = r.adaptive;
  $('gfx-show-fps').checked = r.showFps;
  $('gfx-summary').textContent = info.gpu + ' · ' + info.summary;
  $('gfx-post-note').hidden = !info.postFailed;
}

export function describeWords() { return gi18n.describeWords(); }
