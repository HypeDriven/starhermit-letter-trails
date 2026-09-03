'use strict';

// Smoke script (not part of node --test): plays a journey level and a daily
// to completion purely through legal actions, printing state hashes.
// Run: node tests/smoke.mjs

import * as rules from '../src/rules.js';
import * as content from '../src/content.js';
import * as session from '../src/session.js';
import { fileURLToPath } from 'node:url';

// Only run when invoked directly (node --test also scans this directory).
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();

function main() {

function play(def, label) {
  let state = rules.createState(def);
  const envelope = session.beginEnvelope(def, state);
  console.log(label + ': initial hash ' + rules.hashState(state));
  let guard = 0;
  while (state.status === 'active' && guard++ < 1000) {
    const legal = rules.legalActions(state);
    if (!legal.length) throw new Error('no legal actions but not complete');
    const cmd = { type: 'select', cells: legal[0].cells, id: 'smoke-' + guard };
    const res = rules.applyCommand(state, cmd);
    if (!res.ok) throw new Error('legal action rejected: ' + res.reason);
    state = res.state;
    session.recordCommand(envelope, cmd, state);
  }
  const verdict = session.replayVerify(envelope);
  console.log(label + ': final hash ' + rules.hashState(state) +
    ' | status ' + state.status + ' (' + state.terminalReason + ')' +
    ' | score ' + state.score.total +
    ' | replay verify: ' + verdict.ok + ' (' + verdict.reason + ')');
  if (!verdict.ok) process.exitCode = 1;
}

const errors = content.validateContent();
console.log('validateContent: ' + (errors.length ? errors.join('; ') : 'OK (0 errors)'));
if (errors.length) process.exitCode = 1;

play(content.JOURNEY[0], 'journey-1');
play(content.JOURNEY[39], 'journey-40');
play(content.dailyDefinition(new Date().toISOString().slice(0, 10)), 'daily-today');
play(content.challengeDefinition('challenge-grid'), 'challenge-grid');
console.log(process.exitCode ? 'SMOKE FAILED' : 'SMOKE OK');
}
