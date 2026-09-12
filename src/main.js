'use strict';

// Letter Trails — bootstrap and game glue. Owns the input layer, the
// session state machine wiring, and the render loop.

import * as rules from './rules.js';
import * as content from './content.js';
import * as session from './session.js';
import * as render from './render.js';
import * as audio from './audio.js';
import * as platform from './platform.js';
import * as ui from './ui.js';
import { now, uid, utcDay } from './util.js';

// ---------------------------------------------------------------------------
// Capability detection
// ---------------------------------------------------------------------------

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

if (!webglAvailable()) {
  document.getElementById('compat').classList.add('visible');
  throw new Error('WebGL unavailable');
}

// ---------------------------------------------------------------------------
// Game context
// ---------------------------------------------------------------------------

const game = {
  sess: session.createSession(),
  def: null,            // content definition of current round
  state: null,          // rules state
  envelope: null,
  settings: session.loadSettings(),
  mode: null,           // 'journey' | 'daily' | 'practice' | 'challenge'
  pendingDef: null,
  tutorialIndex: -1,
  tutorialActive: false,
  selection: [],        // cells of current drag/keyboard selection
  dragOrigin: null,
  keyboardAnchor: null, // keyboard line start cell
  cursor: { r: 0, c: 0 },
  actionCounter: 0,
  lastTickAt: 0,
  movesUsed: 0,
  hintCells: null,
};

function nextActionId() { return 'a' + (++game.actionCounter) + '-' + uid(); }

// ---------------------------------------------------------------------------
// Session transitions → UI
// ---------------------------------------------------------------------------

game.sess.onTransition(({ to, reason }) => {
  if (to === 'title') {
    ui.showHud(false);
    ui.showScreen('title');
  } else if (to === 'results') {
    ui.showHud(false);
  } else if (to === 'active') {
    ui.showHud(true);
    ui.showScreen(null);
  } else if (to === 'paused') {
    ui.showScreen('pause');
    ui.announce('Paused.');
  }
});

// ---------------------------------------------------------------------------
// Round lifecycle
// ---------------------------------------------------------------------------

function startRound(def, mode) {
  game.def = def;
  game.mode = mode;
  game.state = rules.createState(def);
  game.envelope = session.beginEnvelope(def, game.state);
  game.movesUsed = 0;
  game.selection = [];
  game.keyboardAnchor = null;
  game.cursor = { r: 0, c: 0 };
  game.lastTickAt = now();
  game.hintCells = null;
  render.buildBoard(game.state, def.theme, def.seed);
  ui.setObjective(def, game.state);
  ui.updateClock(0);

  if (game.sess.phase !== 'preparing') game.sess.transition('preparing', 'start-' + mode);
  if (def.mechanics.tutorial && !game.settings.tutorialDone) {
    game.tutorialActive = true;
    game.tutorialIndex = 0;
    game.sess.transition('tutorial', 'lesson-start');
    ui.showTutorial(content.LESSONS[0], false);
  } else {
    beginCountdown();
  }
}

function beginCountdown() {
  if (game.sess.phase === 'preparing' || game.sess.phase === 'tutorial') {
    game.sess.transition('countdown', 'ready');
  }
  ui.announce('Round starting. Find all ' + game.state.words.length + ' words.');
  game.sess.transition('active', 'countdown-done');
  audio.startAmbience();
}

function issueCommand(cmd) {
  if (!game.state) return null;
  cmd.id = cmd.id || nextActionId();
  const res = rules.applyCommand(game.state, cmd);
  if (!res) return null;
  game.state = res.state;
  session.recordCommand(game.envelope, cmd, game.state);
  return res;
}

function commitSelection() {
  if (game.selection.length < 2) { cancelSelection(); return; }
  const cells = game.selection;
  const res = issueCommand({ type: 'select', cells });
  game.movesUsed++;
  ui.updateMovesUsed(game.movesUsed);
  if (res.ok) {
    audio.sfx.wordFound();
    render.commitWord(cells);
    ui.renderWordList(game.state);
    ui.updateProgress(game.state);
    const word = res.reason.slice(6);
    ui.announce('Found ' + word + '! ' + game.state.foundCount + ' of ' + game.state.words.length + ' words.');
    if (game.state.status === 'complete') {
      finishRound();
    }
  } else {
    audio.sfx.invalid();
    render.updateSelection(cells, 'invalid');
    const msg = explainReason(res.reason);
    ui.announce(msg, true);
    setTimeout(() => { render.updateSelection([], 'none'); }, 400);
  }
  game.selection = [];
  game.keyboardAnchor = null;
}

function explainReason(reason) {
  const map = {
    'not-straight': 'That is not a straight line. Words hide in straight lines only.',
    'no-word-match': 'Those letters are not on the word list.',
    'already-found': 'You already found that word.',
    'too-few-cells': 'Select at least two letters.',
    'out-of-bounds': 'Selection went off the board.',
    'not-active': 'The round is not active right now.',
  };
  return map[reason] || 'Invalid selection: ' + reason;
}

function cancelSelection() {
  game.selection = [];
  game.keyboardAnchor = null;
  render.updateSelection([], 'none');
}

function finishRound() {
  game.sess.transition('resolving', 'all-words-found');
  audio.sfx.complete();
  audio.stopAmbience();

  // Daily streak claim is part of the replayable command log.
  let streakDays = 0;
  if (game.mode === 'daily') {
    const s = session.recordDailyCompletion(utcDay(platform.serverNow()).slice(0, 10));
    streakDays = s.days;
    issueCommand({ type: 'claim-streak', days: streakDays });
  }

  const earned = [];
  if (session.unlockAchievement('first-completion')) earned.push(session.ACHIEVEMENTS['first-completion']);
  if (game.def.mechanics.mastery && game.state.invalidActions === 0 &&
      session.unlockAchievement('mechanic-mastery')) earned.push(session.ACHIEVEMENTS['mechanic-mastery']);
  if (streakDays >= 3 && session.unlockAchievement('three-day-streak')) earned.push(session.ACHIEVEMENTS['three-day-streak']);
  if (game.mode === 'practice' && game.def.id === 'practice-hard' &&
      session.unlockAchievement('hard-milestone')) earned.push(session.ACHIEVEMENTS['hard-milestone']);
  const before = session.loadAchievements().totalWords;
  session.addWordsFound(game.state.foundCount);
  if (before < 100 && session.loadAchievements().totalWords >= 100) earned.push(session.ACHIEVEMENTS['century-words']);

  if (game.mode === 'journey') session.markJourneyLevelCompleted(game.def.id);
  const best = session.recordBestScore(game.def.id, game.state.score.total);
  platform.telemetry('round-end', { mode: game.mode, score: game.state.score.total, invalid: game.state.invalidActions });

  // Evaluate challenge constraints (move limit / time target) for the results.
  let constraint = '';
  const ch = game.def.mechanics && game.def.mechanics.challenge;
  if (ch && (ch.moveLimit || ch.timeTargetMs)) {
    const parts = [];
    if (ch.moveLimit) {
      const okMoves = game.movesUsed <= ch.moveLimit;
      parts.push((okMoves ? 'met' : 'missed') + ' move limit (' + game.movesUsed + '/' + ch.moveLimit + ')');
    }
    if (ch.timeTargetMs) {
      const okTime = game.state.elapsedMs <= ch.timeTargetMs;
      parts.push((okTime ? 'beat' : 'missed') + ' time target (' + Math.floor(game.state.elapsedMs / 1000) + 's/' + Math.floor(ch.timeTargetMs / 1000) + 's)');
    }
    constraint = 'Challenge ' + parts.join(', ') + '.';
  }

  if (earned.length) audio.sfx.achievement();
  game.sess.transition('results', 'round-complete');
  const nextLabel = game.mode === 'journey' ? 'Next Level' : 'Play Again';
  ui.showResults(game.state, { achievements: earned, best, nextLabel, constraint });

  // Ranked surfacing (daily + journey): on the platform the leaderboard is
  // read-only — clients can never submit scores — so only entries are read;
  // personal bests stay local and cloud-mirrored. Against the local dev
  // server the validated replay is still submitted. Failures are soft.
  if (game.mode === 'daily' || game.mode === 'journey') {
    showRankedResults();
  }
}

async function showRankedResults() {
  if (platform.hasToken()) {
    const info = await platform.fetchGameInfo();
    const lbId = info.ok && info.data && info.data.leaderboardId;
    if (!lbId) return; // no platform leaderboard: local records only
    const lb = await platform.fetchLeaderboardEntries(lbId, { pageSize: 10 });
    if (lb.ok && lb.data.length) {
      document.getElementById('leaderboard-box').innerHTML = renderLeaderboard(lb.data);
    }
    return;
  }
  const res = await platform.submitScore(game.envelope);
  if (res.ok) {
    const lb = await platform.fetchLeaderboard(game.mode === 'daily' ? 'daily' : 'global',
      game.mode === 'daily' ? utcDay(platform.serverNow()).slice(0, 10) : null);
    if (lb.ok && lb.data && lb.data.scores) {
      document.getElementById('leaderboard-box').innerHTML = renderLeaderboard(lb.data.scores);
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function renderLeaderboard(scores) {
  const rows = scores.slice(0, 10).map((s, i) =>
    '<div class="score-row"><span>' + (i + 1) + '. ' + escapeHtml(s.player || 'player') +
    '</span><span>' + (Number.isFinite(s.score) ? s.score : 0) + '</span></div>').join('');
  return rows ? '<h3>Leaderboard</h3>' + rows : '';
}

function leaveRound() {
  audio.sfx.uiBack();
  cancelSelection();
  audio.stopAmbience();
  if (game.sess.phase === 'paused') game.sess.transition('active', 'leave-unpause');
  if (game.sess.phase === 'active') game.sess.transition('paused', 'leave');
  game.sess.transition('mode-select', 'left-round');
  game.state = null;
  ui.showHud(false);
  ui.showScreen('title');
}

// ---------------------------------------------------------------------------
// Input — pointer / touch drag
// ---------------------------------------------------------------------------

const canvas = document.getElementById('game-canvas');
const TAP_DIST_PX = 12;
const TAP_TIME_MS = 350;
let pointerDown = null; // { id, x, y, t, cell }

function eventNdc(e) {
  const rect = canvas.getBoundingClientRect();
  return [
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -(((e.clientY - rect.top) / rect.height) * 2 - 1),
  ];
}

// Cells along the straight line from a to b if aligned, else just [a].
function lineBetween(a, b) {
  const dr = Math.sign(b.r - a.r), dc = Math.sign(b.c - a.c);
  const len = Math.max(Math.abs(b.r - a.r), Math.abs(b.c - a.c));
  if (len === 0) return [[a.r, a.c]];
  const aligned = (a.r === b.r) || (a.c === b.c) || (Math.abs(b.r - a.r) === Math.abs(b.c - a.c));
  if (!aligned) return [[a.r, a.c]];
  const cells = [];
  for (let i = 0; i <= len; i++) cells.push([a.r + dr * i, a.c + dc * i]);
  return cells;
}

canvas.addEventListener('pointerdown', (e) => {
  if (game.sess.phase !== 'active') return;
  audio.unlock();
  const [nx, ny] = eventNdc(e);
  const cell = render.screenToCell(nx, ny);
  if (!cell) return;
  canvas.setPointerCapture(e.pointerId);
  pointerDown = { id: e.pointerId, x: e.clientX, y: e.clientY, t: now(), cell };
  game.dragOrigin = cell;
  game.selection = [[cell.r, cell.c]];
  render.updateSelection(game.selection, 'pending');
  audio.sfx.tick();
});

canvas.addEventListener('pointermove', (e) => {
  if (!pointerDown || e.pointerId !== pointerDown.id) return;
  const [nx, ny] = eventNdc(e);
  const cell = render.screenToCell(nx, ny);
  if (!cell) return;
  game.selection = lineBetween(game.dragOrigin, cell);
  render.updateSelection(game.selection, 'pending');
});

function endPointer(e, cancelled) {
  if (!pointerDown || e.pointerId !== pointerDown.id) return;
  const wasTap = Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y) < TAP_DIST_PX &&
                 now() - pointerDown.t < TAP_TIME_MS;
  pointerDown = null;
  if (game.sess.phase !== 'active') { cancelSelection(); return; }
  if (cancelled) { cancelSelection(); ui.announce('Selection cancelled.'); return; }
  if (wasTap && game.selection.length === 1) { cancelSelection(); return; }
  commitSelection();
}

canvas.addEventListener('pointerup', (e) => endPointer(e, false));
canvas.addEventListener('pointercancel', (e) => endPointer(e, true));
canvas.addEventListener('lostpointercapture', (e) => {
  if (pointerDown && e.pointerId === pointerDown.id) { pointerDown = null; cancelSelection(); }
});

// ---------------------------------------------------------------------------
// Input — keyboard
// ---------------------------------------------------------------------------

document.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
  const phase = game.sess.phase;
  const key = e.key;

  if (key === 'Escape') {
    if (phase === 'active' && (game.selection.length || game.keyboardAnchor)) {
      cancelSelection(); ui.announce('Selection cancelled.');
    } else if (phase === 'active') {
      pauseGame();
    } else if (phase === 'paused') {
      resumeGame();
    }
    return;
  }
  if (phase !== 'active') return;

  const move = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[key];
  if (move) {
    e.preventDefault();
    const size = game.state.size;
    game.cursor.r = Math.min(size - 1, Math.max(0, game.cursor.r + move[0]));
    game.cursor.c = Math.min(size - 1, Math.max(0, game.cursor.c + move[1]));
    if (game.keyboardAnchor) {
      game.selection = lineBetween(game.keyboardAnchor, game.cursor);
      render.updateSelection(game.selection, 'pending');
    } else {
      render.updateSelection([[game.cursor.r, game.cursor.c]], 'pending');
    }
    audio.sfx.uiMove();
    ui.announce('Cell ' + game.state.grid[game.cursor.r][game.cursor.c] +
      ', row ' + (game.cursor.r + 1) + ', column ' + (game.cursor.c + 1) + '.');
    return;
  }
  if (key === 'Enter' || key === ' ') {
    e.preventDefault();
    if (!game.keyboardAnchor) {
      game.keyboardAnchor = { ...game.cursor };
      game.selection = [[game.cursor.r, game.cursor.c]];
      render.updateSelection(game.selection, 'pending');
      audio.sfx.select();
      ui.announce('Line start set. Move to the end and press Enter to confirm.');
    } else {
      commitSelection();
    }
    return;
  }
  if (key === 'h' || key === 'H') { giveHint(); return; }
  if (key === 'c' || key === 'C') { render.resetCamera(); ui.announce('Camera reset.'); }
});

function giveHint() {
  if (!game.state || game.sess.phase !== 'active') return;
  const legal = rules.legalActions(game.state); // hints use the same rules API
  if (!legal.length) return;
  const action = legal[Math.floor(Math.random() * legal.length)];
  game.hintCells = action.cells;
  audio.sfx.hint();
  render.updateSelection(action.cells, 'pending');
  ui.announce('Hint: the word ' + action.word + ' starts at row ' + (action.cells[0][0] + 1) +
    ', column ' + (action.cells[0][1] + 1) + '.');
  setTimeout(() => { if (!game.selection.length) render.updateSelection([], 'none'); }, 2500);
}

function pauseGame() {
  if (game.sess.phase !== 'active') return;
  flushTick();
  game.sess.transition('paused', 'user-pause');
}

function resumeGame() {
  if (game.sess.phase !== 'paused') return;
  game.sess.transition('active', 'user-resume');
  game.lastTickAt = now();
  ui.announce('Resumed.');
}

// ---------------------------------------------------------------------------
// Clock ticking (folded into the command log in 5s chunks)
// ---------------------------------------------------------------------------

function flushTick() {
  if (!game.state || game.state.status !== 'active') return;
  const t = now();
  const delta = t - game.lastTickAt;
  if (delta >= 100) {
    issueCommand({ type: 'tick', ms: delta });
    game.lastTickAt = t;
  }
}

setInterval(() => {
  if (game.sess.phase !== 'active' || document.hidden) { game.lastTickAt = now(); return; }
  const t = now();
  if (t - game.lastTickAt >= 5000) flushTick();
  if (game.state) ui.updateClock(game.state.elapsedMs + (t - game.lastTickAt));
}, 1000);

document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.sess.phase === 'active') pauseGame(); // backgrounding pauses solo play
});

// ---------------------------------------------------------------------------
// UI event wiring
// ---------------------------------------------------------------------------

const SYNC_LABELS = { synced: 'cloud synced', saving: 'saving...', error: 'sync error', offline: 'offline' };

function refreshProfileLine() {
  const name = platform.getProfileName();
  if (name) {
    ui.setProfileLine('Playing as ' + name + ' · ' + (SYNC_LABELS[platform.getSyncStatus()] || 'offline'));
    return;
  }
  const g = session.guestProfile();
  ui.setProfileLine('Playing as ' + g.name + (platform.hasToken() ? '' : ' (local guest)'));
}

function showTitle() {
  refreshProfileLine();
  if (game.sess.phase === 'boot') game.sess.transition('title', 'boot-done');
  else ui.showScreen('title');
}

const RANKED_LABEL = () => (platform.hasToken() ? 'Yes — read-only leaderboard' : 'Yes — validated replay submitted');

ui.on('play', () => {
  // Short path to play: resume journey at the next unlocked level.
  const progress = session.loadJourneyProgress();
  const idx = content.JOURNEY.findIndex((lv) => !progress.completed.includes(lv.id));
  const lv = content.JOURNEY[idx === -1 ? content.JOURNEY.length - 1 : idx];
  game.pendingDef = { ...lv, label: 'Journey — Level ' + (content.JOURNEY.indexOf(lv) + 1), desc: 'Find every themed word on the board.' };
  game.pendingMode = 'journey';
  ui.showModeSetup(game.pendingDef, { ranked: true, rankedLabel: RANKED_LABEL() });
  if (game.sess.phase === 'title') game.sess.transition('mode-select', 'choose-mode');
});

ui.on('daily', () => {
  const day = utcDay(platform.serverNow()).slice(0, 10);
  const def = content.dailyDefinition(day);
  game.pendingDef = { ...def, label: 'Daily Challenge — ' + day, desc: 'One shared board for everyone today. Ranked.' };
  game.pendingMode = 'daily';
  ui.showModeSetup(game.pendingDef, { ranked: true, rankedLabel: RANKED_LABEL() });
  if (game.sess.phase === 'title') game.sess.transition('mode-select', 'choose-daily');
});

ui.on('journey', () => {
  if (game.sess.phase === 'title') game.sess.transition('mode-select', 'choose-journey');
  const progress = session.loadJourneyProgress();
  ui.renderJourneyGrid(content.JOURNEY, progress.completed, (lv) => {
    game.pendingDef = { ...lv, label: 'Journey — Level ' + (content.JOURNEY.indexOf(lv) + 1), desc: 'Find every themed word on the board.' };
    game.pendingMode = 'journey';
    ui.showModeSetup(game.pendingDef, { ranked: true, rankedLabel: RANKED_LABEL() });
  });
  ui.showScreen('journey');
});

ui.on('practice', () => {
  if (game.sess.phase === 'title') game.sess.transition('mode-select', 'choose-practice');
  ui.showScreen('practice');
});

ui.on('practice-pick', (diff) => {
  const def = content.practiceDefinition(diff, Math.floor(Math.random() * 0x7fffffff));
  game.pendingDef = { ...def, label: 'Practice — ' + content.PRACTICE[diff].label, desc: 'Unranked practice board.' };
  game.pendingMode = 'practice';
  ui.showModeSetup(game.pendingDef, { ranked: false });
});

ui.on('challenge', () => {
  if (game.sess.phase === 'title') game.sess.transition('mode-select', 'choose-challenge');
  ui.renderChallengeList(content.CHALLENGES, (c) => {
    const def = content.challengeDefinition(c.id);
    game.pendingDef = { ...def, label: 'Challenge — ' + c.label, desc: 'Beat the constraint to master this board.' };
    game.pendingMode = 'challenge';
    ui.showModeSetup(game.pendingDef, { ranked: false });
  });
  ui.showScreen('challenge');
});

ui.on('help', () => ui.showScreen('help'));
ui.on('pause-help', () => ui.showScreen('help'));
ui.on('help-close', () => { audio.sfx.uiBack(); return ui.showScreen(game.sess.phase === 'paused' ? 'pause' : 'title'); });
ui.on('settings', () => { ui.openSettings(game.settings, 'title'); });
ui.on('pause-settings', () => { ui.openSettings(game.settings, 'pause'); });

ui.on('settings-input', () => {
  ui.readSettingsForm(game.settings);
  applySettings(false);
});
ui.on('settings-change', () => {
  ui.readSettingsForm(game.settings);
  applySettings(true);
});

function applySettings(persist) {
  audio.setVolume('music', game.settings.musicVolume);
  audio.setVolume('effects', game.settings.effectsVolume);
  audio.setVolume('ambience', game.settings.ambienceVolume);
  const q = game.settings.quality === 'auto'
    ? (Math.min(window.innerWidth, window.innerHeight) < 700 ? 'low' : 'medium')
    : game.settings.quality;
  render.setQuality(q);
  render.setReducedMotion(game.settings.reducedMotion);
  ui.applyAccessibilityClasses(game.settings);
  if (persist) {
    session.saveSettings(game.settings);
    platform.telemetry('settings-change', { keys: 'user-adjusted' });
  }
}

ui.on('settings-close', () => {
  ui.readSettingsForm(game.settings);
  applySettings(true);
  ui.showScreen(game.sess.phase === 'paused' ? 'pause' : 'title');
});

ui.on('replay-tutorial', () => {
  game.settings.tutorialDone = false;
  session.saveSettings(game.settings);
  ui.showScreen(game.sess.phase === 'paused' ? 'pause' : 'title');
  ui.announce('Tutorial will play at the start of your next Journey level 1.');
});

ui.on('mode-start', () => {
  if (!game.pendingDef) return;
  startRound(game.pendingDef, game.pendingMode);
});

ui.on('back-title', () => {
  audio.sfx.uiBack();
  if (game.sess.phase === 'results' || game.sess.phase === 'progression') {
    game.sess.transition('mode-select', 'results-done');
  }
  game.state = null;
  ui.showHud(false);
  ui.showScreen('title');
});

ui.on('pause', pauseGame);
ui.on('resume', resumeGame);
ui.on('leave', leaveRound);
ui.on('hint', giveHint);
ui.on('camera-reset', () => { render.resetCamera(); ui.announce('Camera reset.'); });

ui.on('retry', () => {
  platform.telemetry('retry', { mode: game.mode });
  game.sess.transition('preparing', 'retry');
  startRound(game.def, game.mode);
});

ui.on('next', () => {
  if (game.mode === 'journey') {
    const idx = content.JOURNEY.indexOf(content.JOURNEY.find((l) => l.id === game.def.id));
    const next = content.JOURNEY[Math.min(idx + 1, content.JOURNEY.length - 1)];
    game.sess.transition('preparing', 'next-level');
    game.pendingDef = { ...next, label: 'Journey — Level ' + (content.JOURNEY.indexOf(next) + 1), desc: 'Find every themed word on the board.' };
    startRound(game.pendingDef, 'journey');
  } else {
    game.sess.transition('preparing', 'play-again');
    if (game.mode === 'practice') {
      const diff = game.def.id.replace('practice-', '');
      game.def = content.practiceDefinition(diff, Math.floor(Math.random() * 0x7fffffff));
    }
    startRound(game.def, game.mode);
  }
});

ui.on('tutorial-next', () => {
  game.tutorialIndex++;
  platform.telemetry('tutorial-step', { step: game.tutorialIndex });
  if (game.tutorialIndex < content.LESSONS.length) {
    ui.showTutorial(content.LESSONS[game.tutorialIndex], game.tutorialIndex === content.LESSONS.length - 1);
  } else {
    game.settings.tutorialDone = true;
    session.saveSettings(game.settings);
    beginCountdown();
  }
});

ui.on('tutorial-skip', () => {
  game.settings.tutorialDone = true;
  session.saveSettings(game.settings);
  beginCountdown();
});

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

let lastFrame = performance.now();
function loop(t) {
  const dt = Math.min((t - lastFrame) / 1000, 0.1);
  lastFrame = t;
  render.render(dt);
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function boot() {
  platform.parseLaunchToken();
  ui.init();
  render.init(canvas, { reducedMotion: game.settings.reducedMotion });
  applySettings(false);
  window.addEventListener('resize', () => render.onResize());
  window.addEventListener('orientationchange', () => setTimeout(() => render.onResize(), 100));
  platform.onSyncStatus(refreshProfileLine);
  if (platform.hasToken()) {
    // Platform launch: restore the cloud mirror first (remote wins), then
    // start mirroring local changes back and keep the token fresh.
    platform.fetchProfile().then(refreshProfileLine);
    platform.pullCloudSave().then((pulled) => {
      if (pulled) {
        game.settings = session.loadSettings();
        applySettings(false);
      }
      platform.startCloudSync();
      refreshProfileLine();
    });
    platform.startTokenRefresh();
  } else {
    // Local dev / offline: the own-server time probe gates the dev-only
    // routes so an unhosted build never 404s into the console.
    platform.syncTime().then((ok) => { if (!ok) platform.telemetry('error', { category: 'time-sync' }); });
    platform.flushTelemetry();
  }
  platform.telemetry('start', { screen: window.innerWidth + 'x' + window.innerHeight });
  showTitle();
  requestAnimationFrame(loop);
}

boot();
