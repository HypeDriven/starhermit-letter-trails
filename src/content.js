'use strict';

// Letter Trails — versioned content: themes, word banks, journey levels,
// daily/practice/learn/challenge definitions, and the offline validator.

import { fnv, mulberry } from './util.js';
import { generateBoard } from './rules.js';

export const CONTENT_VERSION = 1;

// ---------------------------------------------------------------------------
// Visual themes (palette data only; consumed by render/ui)
// ---------------------------------------------------------------------------

export const THEMES = {
  classic: {
    name: 'Classic Desk',
    paper: '#f3ead7', ink: '#2b2b2f', tile: '#e8dcc0', tileEdge: '#b8a888',
    accent: '#b3543f', desk: '#6b4f3a', found: '#3f7a4e', marker: '#b3543f',
  },
  ocean: {
    name: 'Ocean Ledger',
    paper: '#e6f0f2', ink: '#123a4a', tile: '#d4e6ea', tileEdge: '#8fb3bd',
    accent: '#1f7a8c', desk: '#274b5a', found: '#2e8b6e', marker: '#1f7a8c',
  },
  forest: {
    name: 'Forest Press',
    paper: '#eef0e2', ink: '#22301e', tile: '#dfe4c9', tileEdge: '#a3ad7f',
    accent: '#4a7c3a', desk: '#3d4a2e', found: '#2f6b4f', marker: '#4a7c3a',
  },
  dusk: {
    name: 'Dusk Study',
    paper: '#f0e6ee', ink: '#352338', tile: '#e3d3e0', tileEdge: '#a98aa6',
    accent: '#8c4a7a', desk: '#4a3448', found: '#5a7a4a', marker: '#8c4a7a',
  },
  night: {
    name: 'Night Ink',
    paper: '#232630', ink: '#e8e6df', tile: '#2f3340', tileEdge: '#4a5060',
    accent: '#d9a441', desk: '#17181d', found: '#6fae7f', marker: '#d9a441',
  },
};

// ---------------------------------------------------------------------------
// Themed word banks (real English words, 2–8 letters)
// ---------------------------------------------------------------------------

export const WORD_BANKS = {
  ocean: ['TIDE', 'REEF', 'WAVE', 'CORAL', 'SHORE', 'SHELL', 'STORM', 'ANCHOR', 'SAILOR', 'CURRENT', 'LAGOON', 'PEARL', 'KELP', 'BUOY', 'GULL'],
  forest: ['MOSS', 'FERN', 'PINE', 'ACORN', 'BIRCH', 'TRAIL', 'GROVE', 'MEADOW', 'THICKET', 'WILLOW', 'FUNGUS', 'OWL', 'DEER', 'BARK', 'GLEN'],
  kitchen: ['WHISK', 'OVEN', 'SPICE', 'LADLE', 'SIMMER', 'PASTRY', 'SKILLET', 'RECIPE', 'BATTER', 'CRUMB', 'YEAST', 'HERB', 'PAN', 'TART', 'GRILL'],
  space: ['ORBIT', 'COMET', 'LUNAR', 'NEBULA', 'METEOR', 'ROCKET', 'GALAXY', 'PLANET', 'COSMOS', 'ECLIPSE', 'ASTEROID', 'STAR', 'VOID', 'NOVA', 'SOLAR'],
  music: ['TEMPO', 'CHORD', 'MELODY', 'RHYTHM', 'SONATA', 'OCTAVE', 'HARMONY', 'FIDDLE', 'TRUMPET', 'ENCORE', 'BALLAD', 'BASS', 'TUNE', 'HARP', 'PIANO'],
  garden: ['PETAL', 'SEED', 'BLOOM', 'THORN', 'SPROUT', 'ORCHID', 'VIOLET', 'COMPOST', 'PRUNE', 'TULIP', 'WEED', 'IVY', 'ROSE', 'LILY', 'HERB'],
};

// ---------------------------------------------------------------------------
// Journey — 40 authored levels (explicit seeds; difficulty ramps)
// ---------------------------------------------------------------------------

const BANK_KEYS = Object.keys(WORD_BANKS);

function pickWords(bankKey, seed, count, maxLen = 10) {
  const bank = WORD_BANKS[bankKey].filter((w) => w.length >= 3 && w.length <= maxLen);
  const rng = mulberry(seed ^ fnv('journey-pick:' + bankKey));
  const pool = bank.slice();
  const out = [];
  while (out.length < count && pool.length) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return out;
}

function makeJourney() {
  const levels = [];
  for (let i = 0; i < 40; i++) {
    const n = i + 1;
    const seed = (fnv('letter-trails:journey:' + n) ^ (n * 7919)) >>> 0;
    const size = n <= 8 ? 6 : n <= 20 ? 7 : n <= 32 ? 8 : 9;
    const theme = BANK_KEYS[i % BANK_KEYS.length];
    const wordCount = Math.min(4 + Math.floor(i / 4), 10);
    const mastery = n % 8 === 0;
    const level = {
      id: 'journey-' + n,
      seed,
      size,
      theme,
      wordCount,
      words: pickWords(theme, seed, wordCount, size),
      mechanics: {
        tutorial: n === 1,
        mastery,
        challenge: mastery ? { moveLimit: wordCount + 4 } : null,
      },
      par: { moves: wordCount + 3, timeMs: 60000 + size * wordCount * 8000 },
    };
    levels.push(level);
  }
  return levels;
}

export const JOURNEY = makeJourney();

// ---------------------------------------------------------------------------
// Daily challenge — seed derived from the UTC date string, immutable per day
// ---------------------------------------------------------------------------

export function dailyDefinition(utcDateStr) {
  const seed = fnv('letter-trails:daily:' + utcDateStr) >>> 0;
  const theme = BANK_KEYS[seed % BANK_KEYS.length];
  const words = pickWords(theme, seed, 8, 8);
  return {
    id: 'daily-' + utcDateStr,
    seed,
    size: 8,
    theme,
    wordCount: words.length,
    words,
    mechanics: { tutorial: false, mastery: false, challenge: null },
    par: { moves: 11, timeMs: 240000 },
    contentVersion: CONTENT_VERSION,
    date: utcDateStr,
  };
}

// ---------------------------------------------------------------------------
// Practice difficulties
// ---------------------------------------------------------------------------

export const PRACTICE = {
  easy: { id: 'practice-easy', size: 6, wordCount: 5, label: 'Easy' },
  medium: { id: 'practice-medium', size: 7, wordCount: 7, label: 'Medium' },
  hard: { id: 'practice-hard', size: 9, wordCount: 10, label: 'Hard' },
};

export function practiceDefinition(difficulty, sessionSeed) {
  const p = PRACTICE[difficulty];
  if (!p) throw new Error('unknown practice difficulty: ' + difficulty);
  const seed = (sessionSeed >>> 0) || 1;
  const theme = BANK_KEYS[seed % BANK_KEYS.length];
  const words = pickWords(theme, seed, p.wordCount, p.size);
  return {
    id: p.id, seed, size: p.size, theme, wordCount: words.length, words,
    mechanics: { tutorial: false, mastery: false, challenge: null },
    par: { moves: p.wordCount + 3, timeMs: p.size * p.wordCount * 10000 },
  };
}

// ---------------------------------------------------------------------------
// Learn / tutorial lessons
// ---------------------------------------------------------------------------

export const LESSONS = [
  { id: 'learn-drag', title: 'Trace a line', text: 'Drag across letters in a straight line to spell a word from the list.', requiresAction: 'select' },
  { id: 'learn-reverse', title: 'Words run both ways', text: 'Words can hide forwards or backwards along the line.', requiresAction: 'select' },
  { id: 'learn-directions', title: 'Eight directions', text: 'Lines can be horizontal, vertical, or diagonal.', requiresAction: 'select' },
  { id: 'learn-clean', title: 'Clean streaks', text: 'Avoid stray selections — a clean run earns a bonus on every word.', requiresAction: 'select' },
];

// ---------------------------------------------------------------------------
// Challenge variants
// ---------------------------------------------------------------------------

export const CHALLENGES = [
  { id: 'challenge-moves', label: 'Move Limit', seed: fnv('lt:challenge:moves') >>> 0, size: 7, theme: 'forest', wordCount: 6, mechanics: { challenge: { moveLimit: 8 } } },
  { id: 'challenge-speed', label: 'Speed Target', seed: fnv('lt:challenge:speed') >>> 0, size: 7, theme: 'space', wordCount: 6, mechanics: { challenge: { timeTargetMs: 60000 } } },
  { id: 'challenge-grid', label: 'Tight Grid', seed: fnv('lt:challenge:grid') >>> 0, size: 9, theme: 'night', wordCount: 10, mechanics: { challenge: { moveLimit: 13, timeTargetMs: 180000 } } },
];

export function challengeDefinition(id) {
  const c = CHALLENGES.find((x) => x.id === id);
  if (!c) throw new Error('unknown challenge: ' + id);
  const bankKey = WORD_BANKS[c.theme] ? c.theme : BANK_KEYS[c.seed % BANK_KEYS.length];
  const words = pickWords(bankKey, c.seed, c.wordCount, c.size);
  return {
    id: c.id, seed: c.seed, size: c.size, theme: bankKey, wordCount: words.length, words,
    mechanics: { tutorial: false, mastery: false, challenge: c.mechanics.challenge },
    par: { moves: c.wordCount + 2, timeMs: 120000 },
  };
}

// ---------------------------------------------------------------------------
// Offline content validator
// ---------------------------------------------------------------------------

export function validateContent() {
  const errors = [];
  for (const [key, bank] of Object.entries(WORD_BANKS)) {
    if (bank.length < 12) errors.push('word bank ' + key + ' has fewer than 12 words');
    const seen = new Set();
    for (const w of bank) {
      if (!/^[A-Z]{2,10}$/.test(w)) errors.push('word bank ' + key + ': invalid word ' + w);
      if (seen.has(w)) errors.push('word bank ' + key + ': duplicate word ' + w);
      seen.add(w);
    }
  }
  const levels = JOURNEY.slice();
  for (let d = 0; d < 7; d++) {
    // Simulate seven consecutive UTC days.
    const date = new Date(Date.UTC(2026, 0, 5 + d)).toISOString().slice(0, 10);
    levels.push(dailyDefinition(date));
  }
  for (const c of CHALLENGES) levels.push(challengeDefinition(c.id));

  for (const level of levels) {
    const label = level.id;
    if (new Set(level.words).size !== level.words.length) errors.push(label + ': duplicate words');
    if (level.words.length !== level.wordCount) errors.push(label + ': wordCount mismatch');
    for (const w of level.words) {
      if (w.length > level.size) errors.push(label + ': word ' + w + ' longer than board');
    }
    try {
      const { grid, placements } = generateBoard(level.seed, level.size, level.words);
      if (placements.length !== level.words.length) errors.push(label + ': not all words placed');
      for (const p of placements) {
        let s = '';
        for (const [r, c] of p.cells) s += grid[r][c];
        if (s !== p.word) errors.push(label + ': placement letters mismatch for ' + p.word);
      }
    } catch (e) {
      errors.push(label + ': generation failed: ' + e.message);
    }
  }
  return errors;
}
