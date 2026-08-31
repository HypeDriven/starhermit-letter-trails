'use strict';

// Letter Trails — pure deterministic rules engine.
// No DOM, no THREE, no I/O. applyCommand never mutates its input state.

import { fnv, mulberry } from './util.js';

export const STATE_VERSION = 1;

const DIRS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

const FILL_LETTERS = 'ETAOINSHRDLUCMFWGYPBVKJXQZ';

// ---------------------------------------------------------------------------
// Board generation
// ---------------------------------------------------------------------------

function tryPlace(grid, size, word, rng) {
  const len = word.length;
  for (let attempt = 0; attempt < 200; attempt++) {
    const [dr, dc] = DIRS[Math.floor(rng() * DIRS.length)];
    const r0 = Math.floor(rng() * size);
    const c0 = Math.floor(rng() * size);
    const r1 = r0 + dr * (len - 1);
    const c1 = c0 + dc * (len - 1);
    if (r1 < 0 || r1 >= size || c1 < 0 || c1 >= size) continue;
    const cells = [];
    let ok = true;
    for (let i = 0; i < len; i++) {
      const r = r0 + dr * i, c = c0 + dc * i;
      const cur = grid[r][c];
      if (cur !== '' && cur !== word[i]) { ok = false; break; }
      cells.push([r, c]);
    }
    if (!ok) continue;
    for (let i = 0; i < len; i++) grid[cells[i][0]][cells[i][1]] = word[i];
    return cells;
  }
  return null;
}

// Deterministic board generation. Returns { grid: string[], placements }.
// All words are guaranteed placed; bounded retries keep this total.
export function generateBoard(seed, size, words) {
  if (!Number.isInteger(seed) || !Number.isInteger(size) || size < 2) {
    throw new Error('generateBoard: bad seed/size');
  }
  const clean = [...new Set(words.map((w) => String(w).toUpperCase()))]
    .filter((w) => /^[A-Z]{2,}$/.test(w) && w.length <= size)
    .sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  if (!clean.length) throw new Error('generateBoard: no placeable words');

  for (let boardAttempt = 0; boardAttempt < 64; boardAttempt++) {
    const rng = mulberry((seed ^ Math.imul(boardAttempt + 1, 0x9e3779b9)) >>> 0);
    const grid = Array.from({ length: size }, () => Array(size).fill(''));
    const placements = [];
    let allPlaced = true;
    for (const word of clean) {
      const cells = tryPlace(grid, size, word, rng);
      if (!cells) { allPlaced = false; break; }
      placements.push({ word, cells });
    }
    if (!allPlaced) continue;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c] === '') grid[r][c] = FILL_LETTERS[Math.floor(rng() * FILL_LETTERS.length)];
      }
    }
    return { grid: grid.map((row) => row.join('')), placements };
  }
  throw new Error('generateBoard: could not place all words');
}

// ---------------------------------------------------------------------------
// State lifecycle
// ---------------------------------------------------------------------------

export function createState({ seed, size, words }) {
  const { grid, placements } = generateBoard(seed >>> 0, size, words);
  return {
    version: STATE_VERSION,
    seed: seed >>> 0,
    size,
    grid,
    words: placements.map((p) => ({ word: p.word, cells: p.cells, found: false })),
    tick: 0,
    foundCount: 0,
    invalidActions: 0,
    streakClean: 0,          // consecutive invalid actions since last find
    status: 'active',        // 'active' | 'complete'
    terminalReason: null,
    score: { wordPoints: 0, cleanBonus: 0, speedBonus: 0, streakBonus: 0, total: 0 },
    elapsedMs: 0,
    streakClaimed: false,
  };
}

function clone(state) {
  return {
    ...state,
    grid: state.grid.slice(),
    words: state.words.map((w) => ({ word: w.word, cells: w.cells.map((c) => c.slice()), found: w.found })),
    score: { ...state.score },
  };
}

// ---------------------------------------------------------------------------
// Legality
// ---------------------------------------------------------------------------

function isStraightLine(cells) {
  if (cells.length < 2) return false;
  const dr = Math.sign(cells[1][0] - cells[0][0]);
  const dc = Math.sign(cells[1][1] - cells[0][1]);
  if (dr === 0 && dc === 0) return false;
  for (let i = 1; i < cells.length; i++) {
    if (cells[i][0] - cells[i - 1][0] !== dr || cells[i][1] - cells[i - 1][1] !== dc) return false;
  }
  return true;
}

function lettersAt(state, cells) {
  let s = '';
  for (const [r, c] of cells) s += state.grid[r][c];
  return s;
}

function reverse(s) { return s.split('').reverse().join(''); }

// Legal select commands — the same API hints and tutorials use.
export function legalActions(state) {
  if (state.status !== 'active') return [];
  return state.words
    .filter((w) => !w.found)
    .map((w) => ({ type: 'select', cells: w.cells.map((c) => c.slice()), word: w.word }));
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export const REASONS = {
  UNKNOWN_COMMAND: 'unknown-command',
  NOT_ACTIVE: 'not-active',
  BAD_CELLS: 'bad-cells',
  TOO_FEW_CELLS: 'too-few-cells',
  OUT_OF_BOUNDS: 'out-of-bounds',
  NOT_STRAIGHT: 'not-straight',
  NO_WORD_MATCH: 'no-word-match',
  ALREADY_FOUND: 'already-found',
  BAD_TICK: 'bad-tick',
  BAD_STREAK: 'bad-streak',
};

function invalid(state, reason) {
  const next = clone(state);
  next.tick += 1;
  next.invalidActions += 1;
  next.streakClean += 1;
  return { state: next, ok: false, reason };
}

function finalize(next) {
  const s = next.score;
  s.total = s.wordPoints + s.cleanBonus + s.speedBonus + s.streakBonus;
  if (next.foundCount === next.words.length) {
    next.status = 'complete';
    next.terminalReason = 'all-words-found';
  }
  return next;
}

function applySelect(state, cmd) {
  if (state.status !== 'active') return invalid(state, REASONS.NOT_ACTIVE);
  const cells = cmd.cells;
  if (!Array.isArray(cells)) return invalid(state, REASONS.BAD_CELLS);
  if (cells.length < 2) return invalid(state, REASONS.TOO_FEW_CELLS);
  if (cells.length > state.size * state.size) return invalid(state, REASONS.BAD_CELLS);
  for (const cell of cells) {
    if (!Array.isArray(cell) || cell.length !== 2 ||
        !Number.isInteger(cell[0]) || !Number.isInteger(cell[1])) {
      return invalid(state, REASONS.BAD_CELLS);
    }
    if (cell[0] < 0 || cell[0] >= state.size || cell[1] < 0 || cell[1] >= state.size) {
      return invalid(state, REASONS.OUT_OF_BOUNDS);
    }
  }
  if (!isStraightLine(cells)) return invalid(state, REASONS.NOT_STRAIGHT);

  const letters = lettersAt(state, cells);
  const reversed = reverse(letters);
  const match = state.words.find((w) => w.word === letters || w.word === reversed);
  if (!match) return invalid(state, REASONS.NO_WORD_MATCH);
  if (match.found) return invalid(state, REASONS.ALREADY_FOUND);

  const next = clone(state);
  const target = next.words.find((w) => w.word === match.word);
  target.found = true;
  next.tick += 1;
  next.foundCount += 1;

  // Scoring (integers only).
  next.score.wordPoints += 20 * match.word.length;
  if (next.streakClean === 0) next.score.cleanBonus += 50;
  next.streakClean = 0;
  // Speed bonus: decays with elapsed time, floor 0, max 100 per word.
  next.score.speedBonus += Math.max(0, 100 - Math.floor(next.elapsedMs / 3000));

  return { state: finalize(next), ok: true, reason: 'found:' + match.word };
}

export function applyCommand(state, cmd) {
  if (!state || !cmd || typeof cmd !== 'object') return invalid(state, REASONS.UNKNOWN_COMMAND);
  switch (cmd.type) {
    case 'select':
      return applySelect(state, cmd);
    case 'tick': {
      // Advances the authoritative elapsed clock (monotonic, bounded per call).
      if (state.status !== 'active') return { state, ok: true, reason: 'idle' };
      if (!Number.isFinite(cmd.ms) || cmd.ms < 0 || cmd.ms > 600000) {
        return invalid(state, REASONS.BAD_TICK);
      }
      const next = clone(state);
      next.tick += 1;
      next.elapsedMs += Math.floor(cmd.ms);
      return { state: next, ok: true, reason: 'ticked' };
    }
    case 'claim-streak': {
      // Daily-streak bonus, claimable once per session (replayable).
      if (!Number.isInteger(cmd.days) || cmd.days < 0 || cmd.days > 366) {
        return invalid(state, REASONS.BAD_STREAK);
      }
      const next = clone(state);
      next.tick += 1;
      if (!next.streakClaimed) {
        next.streakClaimed = true;
        next.score.streakBonus = cmd.days * 25;
      }
      return { state: finalize(next), ok: true, reason: 'streak:' + cmd.days };
    }
    default:
      return invalid(state, REASONS.UNKNOWN_COMMAND);
  }
}

// ---------------------------------------------------------------------------
// Hashing & serialization
// ---------------------------------------------------------------------------

function canonical(state) {
  return JSON.stringify({
    v: state.version,
    seed: state.seed,
    size: state.size,
    grid: state.grid,
    words: state.words.map((w) => [w.word, w.cells, w.found]),
    tick: state.tick,
    found: state.foundCount,
    invalid: state.invalidActions,
    clean: state.streakClean,
    status: state.status,
    reason: state.terminalReason,
    score: state.score,
    ms: state.elapsedMs,
    streakClaimed: state.streakClaimed,
  });
}

export function hashState(state) {
  return fnv(canonical(state));
}

export function serialize(state) {
  return JSON.stringify(state);
}

const MIGRATIONS = {
  // 0 -> 1: migration hook; backfills streakClaimed.
  0: (s) => ({ ...s, version: 1, streakClaimed: !!s.streakClaimed }),
};

export function deserialize(json) {
  let state = typeof json === 'string' ? JSON.parse(json) : json;
  if (!state || typeof state !== 'object' || !Number.isInteger(state.version)) {
    throw new Error('deserialize: not a Letter Trails state');
  }
  while (state.version < STATE_VERSION) {
    const mig = MIGRATIONS[state.version];
    if (!mig) throw new Error('deserialize: no migration from version ' + state.version);
    state = mig(state);
  }
  if (state.version > STATE_VERSION) {
    throw new Error('deserialize: state version ' + state.version + ' newer than supported ' + STATE_VERSION);
  }
  return state;
}
