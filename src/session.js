'use strict';

// Letter Trails — session lifecycle, persistence, replay envelopes.
// Owns the state machine: boot → title → profile-ready → mode-select →
// preparing → tutorial/countdown → active ↔ paused → resolving → results →
// progression. Every transition carries an explicit reason.

import * as rules from './rules.js';
import { CONTENT_VERSION } from './content.js';
import { now, uid, utcDay } from './util.js';

export const BUILD_VERSION = '1.0.0';
export const REPLAY_SCHEMA_VERSION = 1;

const LS = {
  settings: 'lt:settings',
  journey: 'lt:journey',
  achievements: 'lt:achievements',
  best: 'lt:best',
  streak: 'lt:streak',
  guest: 'lt:guest',
};

// ---------------------------------------------------------------------------
// Persistence helpers (guarded; storage may be unavailable)
// ---------------------------------------------------------------------------

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage unavailable — session continues without persistence */ }
}

export const DEFAULT_SETTINGS = {
  musicVolume: 0.6, effectsVolume: 0.8, ambienceVolume: 0.4, voiceVolume: 0.7,
  quality: 'auto', reducedMotion: false, highContrast: false,
  colorVision: 'default', largerText: false, leftHanded: false,
  holdToConfirm: false, haptics: true, tutorialDone: false,
};

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...load(LS.settings, {}) };
}

export function saveSettings(settings) {
  save(LS.settings, settings);
}

export function loadJourneyProgress() {
  return load(LS.journey, { completed: [], lastLevel: null });
}

export function markJourneyLevelCompleted(id) {
  const p = loadJourneyProgress();
  if (!p.completed.includes(id)) p.completed.push(id);
  p.lastLevel = id;
  save(LS.journey, p);
  return p;
}

export function loadBestScores() {
  return load(LS.best, {});
}

export function recordBestScore(modeId, score) {
  const best = loadBestScores();
  if (!best[modeId] || score > best[modeId]) {
    best[modeId] = score;
    save(LS.best, best);
    return true;
  }
  return false;
}

export function loadStreak() {
  return load(LS.streak, { days: 0, lastDay: null });
}

// Records a completed daily for the given UTC day; returns updated streak.
export function recordDailyCompletion(utcDate) {
  const s = loadStreak();
  if (s.lastDay === utcDate) return s; // idempotent
  const prev = new Date(utcDate + 'T00:00:00Z');
  prev.setUTCDate(prev.getUTCDate() - 1);
  const prevStr = prev.toISOString().slice(0, 10);
  s.days = s.lastDay === prevStr ? s.days + 1 : 1;
  s.lastDay = utcDate;
  save(LS.streak, s);
  return s;
}

export function guestProfile() {
  let g = load(LS.guest, null);
  if (!g) {
    g = { id: 'guest-' + uid(), name: 'Guest', created: now() };
    save(LS.guest, g);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Achievements — stable lowercase keys, idempotent unlock
// ---------------------------------------------------------------------------

export const ACHIEVEMENTS = {
  'first-completion': { name: 'First Trail', desc: 'Complete your first board.' },
  'mechanic-mastery': { name: 'Clean Hand', desc: 'Complete a mastery level with no invalid actions.' },
  'three-day-streak': { name: 'Steady Hand', desc: 'Complete the daily challenge 3 days in a row.' },
  'hard-milestone': { name: 'Deep Ink', desc: 'Complete a hard practice board.' },
  'century-words': { name: 'Century of Words', desc: 'Find 100 words in total.' },
};

export function loadAchievements() {
  return load(LS.achievements, { unlocked: {}, totalWords: 0 });
}

export function unlockAchievement(key) {
  if (!ACHIEVEMENTS[key]) return false;
  const a = loadAchievements();
  if (a.unlocked[key]) return false; // idempotent
  a.unlocked[key] = now();
  save(LS.achievements, a);
  return true;
}

export function addWordsFound(n) {
  const a = loadAchievements();
  a.totalWords = (a.totalWords || 0) + n;
  save(LS.achievements, a);
  if (a.totalWords >= 100) unlockAchievement('century-words');
  return a.totalWords;
}

// ---------------------------------------------------------------------------
// Session state machine
// ---------------------------------------------------------------------------

export const PHASES = [
  'boot', 'title', 'profile-ready', 'mode-select', 'preparing',
  'tutorial', 'countdown', 'active', 'paused', 'resolving', 'results', 'progression',
];

const ALLOWED = {
  boot: ['title'],
  title: ['profile-ready', 'mode-select'],
  'profile-ready': ['mode-select'],
  'mode-select': ['preparing', 'title'],
  preparing: ['tutorial', 'countdown', 'mode-select'],
  tutorial: ['countdown', 'mode-select'],
  countdown: ['active', 'mode-select'],
  active: ['paused', 'resolving'],
  paused: ['active', 'mode-select'],
  resolving: ['results', 'active'],
  results: ['progression', 'mode-select', 'preparing'],
  progression: ['mode-select', 'preparing', 'title'],
};

export function createSession() {
  const listeners = new Set();
  const session = {
    phase: 'boot',
    reason: 'init',
    sessionId: 's-' + uid(),
    definition: null,     // content def for the round
    state: null,          // rules state snapshot
    envelope: null,       // replay envelope being built
    modeId: null,
    onTransition(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    transition(to, reason) {
      if (!ALLOWED[session.phase] || !ALLOWED[session.phase].includes(to)) {
        throw new Error('illegal transition ' + session.phase + ' -> ' + to);
      }
      const from = session.phase;
      session.phase = to;
      session.reason = reason;
      for (const fn of listeners) fn({ from, to, reason });
    },
  };
  return session;
}

// ---------------------------------------------------------------------------
// Replay envelope
// ---------------------------------------------------------------------------

export function beginEnvelope(definition, initialState) {
  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    buildVersion: BUILD_VERSION,
    contentVersion: CONTENT_VERSION,
    seed: definition.seed,
    size: definition.size,
    words: definition.words,
    modeId: definition.id,
    initialHash: rules.hashState(initialState),
    startedAt: now(),
    commands: [],
    stateHashes: [rules.hashState(initialState)],
    terminalResult: null,
  };
}

export function recordCommand(envelope, cmd, state) {
  envelope.commands.push(cmd);
  envelope.stateHashes.push(rules.hashState(state));
  if (state.status !== 'active') {
    envelope.terminalResult = {
      status: state.status,
      reason: state.terminalReason,
      score: state.score,
      elapsedMs: state.elapsedMs,
      invalidActions: state.invalidActions,
    };
  }
}

// Re-simulates an envelope through the rules engine and verifies the hash
// chain. Returns { ok, reason, finalState }.
export function replayVerify(envelope) {
  try {
    if (!envelope || envelope.schemaVersion !== REPLAY_SCHEMA_VERSION) {
      return { ok: false, reason: 'bad-schema' };
    }
    let state = rules.createState({ seed: envelope.seed, size: envelope.size, words: envelope.words });
    if (rules.hashState(state) !== envelope.initialHash) {
      return { ok: false, reason: 'initial-hash-mismatch' };
    }
    const seenIds = new Set();
    for (let i = 0; i < envelope.commands.length; i++) {
      const cmd = envelope.commands[i];
      if (cmd && cmd.id) {
        if (seenIds.has(cmd.id)) return { ok: false, reason: 'duplicate-command-id' };
        seenIds.add(cmd.id);
      }
      const res = rules.applyCommand(state, cmd);
      state = res.state;
      const expected = envelope.stateHashes[i + 1];
      if (expected !== undefined && rules.hashState(state) !== expected) {
        return { ok: false, reason: 'hash-mismatch-at-' + i };
      }
    }
    const term = envelope.terminalResult;
    if (term) {
      if (state.status !== term.status) return { ok: false, reason: 'terminal-status-mismatch' };
      const want = term.score && term.score.total;
      if (want !== undefined && state.score.total !== want) {
        return { ok: false, reason: 'terminal-score-mismatch' };
      }
    }
    return { ok: true, reason: 'verified', finalState: state };
  } catch (e) {
    return { ok: false, reason: 'replay-error: ' + e.message };
  }
}

export { utcDay };
