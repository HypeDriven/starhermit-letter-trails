'use strict';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../src/rules.js';
import * as content from '../src/content.js';

const DEF = { seed: 12345, size: 6, words: ['TIDE', 'REEF', 'WAVE', 'CORAL'] };

function freshState() {
  return rules.createState(DEF);
}

function firstLegal(state) {
  return rules.legalActions(state)[0];
}

// ---------------------------------------------------------------------------
// Board generation
// ---------------------------------------------------------------------------

test('board generation is deterministic and places all words', () => {
  const a = rules.generateBoard(DEF.seed, DEF.size, DEF.words);
  const b = rules.generateBoard(DEF.seed, DEF.size, DEF.words);
  assert.deepEqual(a, b);
  assert.equal(a.placements.length, DEF.words.length);
  for (const p of a.placements) {
    let s = '';
    for (const [r, c] of p.cells) s += a.grid[r][c];
    assert.equal(s, p.word);
  }
});

// ---------------------------------------------------------------------------
// Legal actions
// ---------------------------------------------------------------------------

test('legalActions returns one select command per unfound word', () => {
  const state = freshState();
  const actions = rules.legalActions(state);
  assert.equal(actions.length, DEF.words.length);
  for (const a of actions) {
    assert.equal(a.type, 'select');
    assert.ok(a.cells.length >= 2);
  }
});

test('legalActions is empty after completion', () => {
  let state = freshState();
  for (const a of rules.legalActions(state)) {
    state = rules.applyCommand(state, { type: 'select', cells: a.cells }).state;
  }
  assert.equal(state.status, 'complete');
  assert.deepEqual(rules.legalActions(state), []);
});

// ---------------------------------------------------------------------------
// Valid selection, forward and reverse
// ---------------------------------------------------------------------------

test('forward selection finds a word and never mutates input state', () => {
  const state = freshState();
  const before = JSON.stringify(state);
  const action = firstLegal(state);
  const res = rules.applyCommand(state, { type: 'select', cells: action.cells });
  assert.equal(res.ok, true);
  assert.equal(res.state.foundCount, 1);
  assert.equal(JSON.stringify(state), before, 'input state must be untouched');
});

test('reverse selection finds the same word', () => {
  const state = freshState();
  const action = firstLegal(state);
  const reversed = action.cells.slice().reverse();
  const res = rules.applyCommand(state, { type: 'select', cells: reversed });
  assert.equal(res.ok, true);
  assert.equal(res.state.words.find((w) => w.word === action.word).found, true);
});

// ---------------------------------------------------------------------------
// Every invalid-action reason
// ---------------------------------------------------------------------------

test('unknown-command', () => {
  const res = rules.applyCommand(freshState(), { type: 'teleport', cells: [[0, 0], [1, 1]] });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'unknown-command');
  assert.equal(res.state.invalidActions, 1);
});

test('bad-cells and too-few-cells', () => {
  const s = freshState();
  assert.equal(rules.applyCommand(s, { type: 'select', cells: 'nope' }).reason, 'bad-cells');
  assert.equal(rules.applyCommand(s, { type: 'select', cells: [[0, 0]] }).reason, 'too-few-cells');
  assert.equal(rules.applyCommand(s, { type: 'select', cells: [[0], [1, 2]] }).reason, 'bad-cells');
  assert.equal(rules.applyCommand(s, { type: 'select', cells: [[0.5, 0], [1, 1]] }).reason, 'bad-cells');
});

test('out-of-bounds', () => {
  const res = rules.applyCommand(freshState(), { type: 'select', cells: [[0, 0], [0, 99]] });
  assert.equal(res.reason, 'out-of-bounds');
});

test('not-straight', () => {
  const res = rules.applyCommand(freshState(), { type: 'select', cells: [[0, 0], [1, 0], [1, 1]] });
  assert.equal(res.reason, 'not-straight');
  // also: same cell twice
  const res2 = rules.applyCommand(freshState(), { type: 'select', cells: [[2, 2], [2, 2]] });
  assert.equal(res2.reason, 'not-straight');
});

test('no-word-match', () => {
  const state = freshState();
  // find a 2-letter straight line that matches no word
  let res = null;
  outer:
  for (let r = 0; r < state.size; r++) {
    for (let c = 0; c < state.size - 1; c++) {
      const cells = [[r, c], [r, c + 1]];
      const letters = cells.map(([rr, cc]) => state.grid[rr][cc]).join('');
      const rev = letters.split('').reverse().join('');
      if (!state.words.some((w) => w.word === letters || w.word === rev)) {
        res = rules.applyCommand(state, { type: 'select', cells });
        break outer;
      }
    }
  }
  assert.ok(res);
  assert.equal(res.reason, 'no-word-match');
});

test('already-found', () => {
  let state = freshState();
  const action = firstLegal(state);
  state = rules.applyCommand(state, { type: 'select', cells: action.cells }).state;
  const res = rules.applyCommand(state, { type: 'select', cells: action.cells });
  assert.equal(res.reason, 'already-found');
});

test('not-active after completion', () => {
  let state = freshState();
  for (const a of rules.legalActions(state)) {
    state = rules.applyCommand(state, { type: 'select', cells: a.cells }).state;
  }
  const res = rules.applyCommand(state, { type: 'select', cells: [[0, 0], [1, 1]] });
  assert.equal(res.reason, 'not-active');
});

test('bad-tick and bad-streak', () => {
  const s = freshState();
  assert.equal(rules.applyCommand(s, { type: 'tick', ms: -5 }).reason, 'bad-tick');
  assert.equal(rules.applyCommand(s, { type: 'tick', ms: NaN }).reason, 'bad-tick');
  assert.equal(rules.applyCommand(s, { type: 'claim-streak', days: -1 }).reason, 'bad-streak');
  assert.equal(rules.applyCommand(s, { type: 'claim-streak', days: 999 }).reason, 'bad-streak');
});

test('invalid actions reset the clean streak', () => {
  let state = freshState();
  state = rules.applyCommand(state, { type: 'teleport' }).state; // invalid
  assert.equal(state.streakClean, 1);
  const action = rules.legalActions(state)[0];
  state = rules.applyCommand(state, { type: 'select', cells: action.cells }).state;
  assert.equal(state.streakClean, 0);
  // No clean bonus awarded because the find followed an invalid action.
  assert.equal(state.score.cleanBonus, 0);
});

// ---------------------------------------------------------------------------
// Scoring components
// ---------------------------------------------------------------------------

test('scoring: word points, clean bonus, speed bonus, streak bonus', () => {
  let state = freshState();
  const a1 = rules.legalActions(state)[0];
  state = rules.applyCommand(state, { type: 'select', cells: a1.cells }).state;
  assert.equal(state.score.wordPoints, 20 * a1.word.length);
  assert.equal(state.score.cleanBonus, 50, 'clean find earns +50');
  assert.equal(state.score.speedBonus, 100, 'no elapsed time → max speed bonus');

  // 30s elapsed halves the speed bonus of the next find.
  state = rules.applyCommand(state, { type: 'tick', ms: 30000 }).state;
  const a2 = rules.legalActions(state)[0];
  state = rules.applyCommand(state, { type: 'select', cells: a2.cells }).state;
  assert.equal(state.score.speedBonus, 100 + (100 - 10));

  // Daily streak bonus claimable once.
  state = rules.applyCommand(state, { type: 'claim-streak', days: 3 }).state;
  assert.equal(state.score.streakBonus, 75);
  state = rules.applyCommand(state, { type: 'claim-streak', days: 9 }).state;
  assert.equal(state.score.streakBonus, 75, 'second claim is a no-op');

  const s = state.score;
  assert.equal(s.total, s.wordPoints + s.cleanBonus + s.speedBonus + s.streakBonus);
  for (const v of Object.values(s)) assert.ok(Number.isInteger(v));
});

// ---------------------------------------------------------------------------
// Terminal state
// ---------------------------------------------------------------------------

test('terminal when all words found with reason all-words-found', () => {
  let state = freshState();
  for (const a of rules.legalActions(state)) {
    const res = rules.applyCommand(state, { type: 'select', cells: a.cells });
    assert.ok(res.ok);
    state = res.state;
  }
  assert.equal(state.status, 'complete');
  assert.equal(state.terminalReason, 'all-words-found');
  assert.equal(state.foundCount, state.words.length);
});

// ---------------------------------------------------------------------------
// Serialization round-trip + migration
// ---------------------------------------------------------------------------

test('serialize/deserialize round-trip preserves hash', () => {
  let state = freshState();
  state = rules.applyCommand(state, { type: 'select', cells: rules.legalActions(state)[0].cells }).state;
  const restored = rules.deserialize(rules.serialize(state));
  assert.deepEqual(restored, state);
  assert.equal(rules.hashState(restored), rules.hashState(state));
});

test('migration from version 0 backfills and upgrades', () => {
  const state = freshState();
  const legacy = JSON.parse(rules.serialize(state));
  legacy.version = 0;
  delete legacy.streakClaimed;
  const migrated = rules.deserialize(JSON.stringify(legacy));
  assert.equal(migrated.version, rules.STATE_VERSION);
  assert.equal(migrated.streakClaimed, false);
});

test('deserialize rejects garbage and newer versions', () => {
  assert.throws(() => rules.deserialize('{"nope":1}'));
  assert.throws(() => rules.deserialize('42'));
  const state = freshState();
  const future = JSON.parse(rules.serialize(state));
  future.version = rules.STATE_VERSION + 1;
  assert.throws(() => rules.deserialize(JSON.stringify(future)));
});

// ---------------------------------------------------------------------------
// Determinism property test
// ---------------------------------------------------------------------------

test('same seed + commands → identical state hashes across runs', () => {
  const run = () => {
    let state = freshState();
    const hashes = [rules.hashState(state)];
    state = rules.applyCommand(state, { type: 'tick', ms: 7000 }).state;
    hashes.push(rules.hashState(state));
    state = rules.applyCommand(state, { type: 'teleport' }).state;
    hashes.push(rules.hashState(state));
    for (const a of rules.legalActions(state)) {
      state = rules.applyCommand(state, { type: 'select', cells: a.cells }).state;
      hashes.push(rules.hashState(state));
    }
    return hashes;
  };
  assert.deepEqual(run(), run());
});

test('different seeds produce different boards', () => {
  const a = rules.createState({ seed: 1, size: 6, words: DEF.words });
  const b = rules.createState({ seed: 2, size: 6, words: DEF.words });
  assert.notEqual(rules.hashState(a), rules.hashState(b));
});

// ---------------------------------------------------------------------------
// Content validator: journey + simulated dailies
// ---------------------------------------------------------------------------

test('validateContent passes all journey levels and 7 simulated dailies', () => {
  const errors = content.validateContent();
  assert.deepEqual(errors, []);
});

test('content shape: 5 themes, 6 banks of ≥12 words, ≥40 journey levels', () => {
  assert.equal(Object.keys(content.THEMES).length, 5);
  assert.ok(Object.keys(content.WORD_BANKS).length >= 6);
  for (const bank of Object.values(content.WORD_BANKS)) assert.ok(bank.length >= 12);
  assert.ok(content.JOURNEY.length >= 40);
});

test('daily definition is deterministic per UTC date', () => {
  const a = content.dailyDefinition('2026-08-30');
  const b = content.dailyDefinition('2026-08-30');
  const c = content.dailyDefinition('2026-08-31');
  assert.deepEqual(a, b);
  assert.notEqual(a.seed, c.seed);
});

// ---------------------------------------------------------------------------
// Fuzz malformed commands: no throws, no hangs
// ---------------------------------------------------------------------------

test('fuzz malformed commands never throws or hangs', () => {
  let state = freshState();
  const junk = [
    null, undefined, 42, 'select', {}, { type: null }, { type: 42 },
    { type: 'select' }, { type: 'select', cells: [] },
    { type: 'select', cells: [[0, 0], [0, 1], null] },
    { type: 'select', cells: [[[0], 0], [1, 1]] },
    { type: 'select', cells: [[-1, 0], [0, 0]] },
    { type: 'select', cells: new Array(200).fill([0, 0]) },
    { type: 'tick' }, { type: 'tick', ms: Infinity }, { type: 'tick', ms: 'fast' },
    { type: 'claim-streak' }, { type: 'claim-streak', days: 1.5 },
  ];
  // deterministic pseudo-random command stream
  let x = 0x12345678;
  const rnd = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
  for (let i = 0; i < 500; i++) {
    const pick = rnd();
    let cmd;
    if (pick < 0.4) cmd = junk[Math.floor(rnd() * junk.length)];
    else if (pick < 0.7) {
      cmd = { type: 'select', cells: [[Math.floor(rnd() * 8) - 1, Math.floor(rnd() * 8) - 1], [Math.floor(rnd() * 8) - 1, Math.floor(rnd() * 8) - 1]] };
    } else if (pick < 0.9) {
      cmd = { type: 'tick', ms: Math.floor(rnd() * 2000) };
    } else {
      const legal = rules.legalActions(state);
      cmd = legal.length ? { type: 'select', cells: legal[0].cells } : { type: 'noop' };
    }
    const res = rules.applyCommand(state, cmd);
    assert.ok(res && res.state, 'must always return a result');
    state = res.state;
  }
});
