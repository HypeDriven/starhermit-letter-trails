'use strict';

// Letter Trails — DOM shell controller. Semantic HTML over the canvas for
// every menu, overlay, and status surface. UI state is separate from rules
// state; closing a panel can never affect a round.

import { twoDigit } from './util.js';

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
    if (first) first.focus();
  } else if (lastFocus && document.contains(lastFocus)) {
    lastFocus.focus(); // restore focus after modal/screen closes
  }
}

export function getScreen() { return currentScreen; }

// ---------------------------------------------------------------------------
// Live announcements
// ---------------------------------------------------------------------------

let liveTimer = null;
export function announce(msg, assertive = false) {
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
  if (ch.moveLimit) parts.push('Move limit: ' + ch.moveLimit + ' (used ' + movesUsed + ')');
  if (ch.timeTargetMs) parts.push('Time target: ' + fmtTime(ch.timeTargetMs));
  $('hud-limit').textContent = parts.join('. ') + '.';
}

export function updateMovesUsed(movesUsed) {
  if (currentChallenge) renderLimitLine(movesUsed);
}

export function setObjective(def, state) {
  $('objective').textContent = 'Find ' + state.words.length + ' words' + (def.theme ? ' — ' + def.theme : '');
  $('board-desc').textContent = 'Board is ' + state.size + ' by ' + state.size + ' letters. ' +
    state.words.length + ' words to find. Use arrow keys to move between cells.';
  renderWordList(state);
  updateProgress(state);
  currentChallenge = def.mechanics && def.mechanics.challenge;
  renderLimitLine(0);
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

export function updateProgress(state) {
  $('progress-text').textContent = state.foundCount + ' of ' + state.words.length;
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

export function showModeSetup(def, { ranked }) {
  $('mode-h').textContent = def.label || def.id;
  $('mode-desc').textContent = def.desc || '';
  const dl = $('mode-facts');
  dl.textContent = '';
  const facts = [
    ['Board', def.size + ' × ' + def.size],
    ['Words', String(def.wordCount)],
    ['Theme', def.theme],
    ['Par', def.par.moves + ' moves, ' + fmtTime(def.par.timeMs)],
    ['Expected duration', Math.max(1, Math.round(def.par.timeMs / 60000)) + ' min'],
    ['Players', '1'],
    ['Ranked', ranked ? 'Yes — validated replay submitted' : 'No'],
  ];
  const ch = def.mechanics && def.mechanics.challenge;
  if (ch && ch.moveLimit) facts.push(['Move limit', String(ch.moveLimit)]);
  if (ch && ch.timeTargetMs) facts.push(['Time target', fmtTime(ch.timeTargetMs)]);
  for (const [k, v] of facts) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    dl.append(dt, dd);
  }
  showScreen('mode');
}

export function showResults(state, { achievements = [], best = false, nextLabel = 'Next', leaderboardHtml = '', constraint = '' }) {
  $('results-h').textContent = state.status === 'complete' ? 'Board Complete!' : 'Round Over';
  const box = $('score-breakdown');
  box.textContent = '';
  const rows = [
    ['Words (' + state.foundCount + ')', state.score.wordPoints],
    ['Clean bonuses', state.score.cleanBonus],
    ['Speed bonuses', state.score.speedBonus],
    ['Daily streak bonus', state.score.streakBonus],
    ['Total', state.score.total],
  ];
  for (const [label, val] of rows) {
    const div = document.createElement('div');
    div.className = 'score-row' + (label === 'Total' ? ' total' : '');
    div.innerHTML = '<span></span><span></span>';
    div.children[0].textContent = label;
    div.children[1].textContent = String(val);
    box.appendChild(div);
  }
  $('results-extra').textContent =
    'Time ' + fmtTime(state.elapsedMs) + ' · Invalid selections ' + state.invalidActions +
    (best ? ' · New best score!' : '') + (constraint ? ' · ' + constraint : '');
  const ach = $('achievements-earned');
  ach.textContent = '';
  for (const a of achievements) {
    const p = document.createElement('p');
    p.textContent = '🏆 Achievement unlocked: ' + a.name + ' — ' + a.desc;
    ach.appendChild(p);
  }
  $('leaderboard-box').innerHTML = leaderboardHtml;
  $('btn-next').textContent = nextLabel;
  showScreen('results');
  announce('Round finished. Total score ' + state.score.total + '.', true);
}

export function renderJourneyGrid(levels, completed, onPick) {
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
    b.setAttribute('aria-label', 'Level ' + n + (lv.mechanics.mastery ? ' (mastery)' : '') + (done ? ', completed' : unlocked ? '' : ', locked'));
    if (unlocked) b.addEventListener('click', () => onPick(lv));
    grid.appendChild(b);
  });
}

export function renderChallengeList(challenges, onPick) {
  const box = $('challenge-list');
  box.textContent = '';
  for (const c of challenges) {
    const b = document.createElement('button');
    const parts = [];
    if (c.mechanics.challenge.moveLimit) parts.push('move limit ' + c.mechanics.challenge.moveLimit);
    if (c.mechanics.challenge.timeTargetMs) parts.push('target ' + fmtTime(c.mechanics.challenge.timeTargetMs));
    b.textContent = c.label + ' — ' + parts.join(', ');
    b.addEventListener('click', () => onPick(c));
    box.appendChild(b);
  }
}

export function showTutorial(step, isLast) {
  $('tutorial-h').textContent = step.title;
  $('tutorial-text').textContent = step.text;
  $('btn-tutorial-next').textContent = isLast ? 'Start Playing' : 'Got it';
  showScreen('tutorial');
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function openSettings(settings, returnTo) {
  settingsReturnTo = returnTo || currentScreen;
  $('set-music').value = settings.musicVolume;
  $('set-effects').value = settings.effectsVolume;
  $('set-ambience').value = settings.ambienceVolume;
  $('set-quality').value = settings.quality;
  $('set-reduced-motion').checked = settings.reducedMotion;
  $('set-high-contrast').checked = settings.highContrast;
  $('set-colorvision').value = settings.colorVision;
  $('set-larger-text').checked = settings.largerText;
  $('set-left-handed').checked = settings.leftHanded;
  showScreen('settings');
}

export function readSettingsForm(settings) {
  settings.musicVolume = parseFloat($('set-music').value);
  settings.effectsVolume = parseFloat($('set-effects').value);
  settings.ambienceVolume = parseFloat($('set-ambience').value);
  settings.quality = $('set-quality').value;
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
  $('tray-words').addEventListener('click', () => {
    $('rail-left').classList.toggle('open');
    $('rail-right').classList.remove('open');
  });
  $('tray-status').addEventListener('click', () => {
    $('rail-right').classList.toggle('open');
    $('rail-left').classList.remove('open');
  });
  // Live settings changes.
  for (const id of ['set-music', 'set-effects', 'set-ambience', 'set-quality', 'set-reduced-motion',
    'set-high-contrast', 'set-colorvision', 'set-larger-text', 'set-left-handed']) {
    $(id).addEventListener('change', () => emit('settings-change'));
    $(id).addEventListener('input', () => emit('settings-input'));
  }
}

export function closeSettings() {
  showScreen(settingsReturnTo && screens[settingsReturnTo] ? settingsReturnTo : settingsReturnTo);
}

export function setProfileLine(text) { $('profile-line').textContent = text; }
