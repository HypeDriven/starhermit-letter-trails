// The save document (src/store.js) and session.js over it: the old cloud
// slot's text migrates, two devices' copies merge as the browser build's
// saveconflict merge did, and session.js reads and writes through the
// document view exactly as it did through localStorage (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../src/store.js';
import * as session from '../src/session.js';

const oldSlot = JSON.stringify({
  'lt:settings': { musicVolume: 0.3, tutorialDone: true, graphics: { preset: 'high' } },
  'lt:journey': { completed: ['journey-1', 'journey-2'], lastLevel: 'journey-2' },
  'lt:achievements': { unlocked: { 'first-completion': 100 }, totalWords: 12 },
  'lt:best': { 'journey-1': 400, 'daily-2026-10-01': 900 },
  'lt:streak': { days: 2, lastDay: '2026-10-01' },
  'lt:guest': { id: 'guest-x', name: 'Guest', created: 1 },
  'unrelated': 5,
});

test('readForeign: the browser build\'s slot is the lt:* document; junk is null', () => {
  const doc = store.readForeign(oldSlot);
  assert.deepEqual(Object.keys(doc).sort(), store.CLOUD_KEYS.slice().sort());
  assert.equal(doc['lt:best']['journey-1'], 400);
  assert.equal(store.readForeign('not json'), null);
  assert.equal(store.readForeign(''), null);
  assert.equal(store.readForeign('[1,2]'), null);
});

test('normalize parses values stored as JSON text and drops other keys', () => {
  const doc = store.normalize({ 'lt:journey': '{"completed":["journey-1"]}', other: 1, 'lt:best': 'oops' });
  assert.deepEqual(doc, { 'lt:journey': { completed: ['journey-1'] } });
});

test('mergeDocs keeps what either side earned and this device\'s settings', () => {
  const remote = store.readForeign(oldSlot);
  const local = {
    'lt:settings': { tutorialDone: false },
    'lt:journey': { completed: ['journey-1', 'journey-3'], lastLevel: 'journey-3' },
    'lt:achievements': { unlocked: { 'first-completion': 50, 'century-words': 70 }, totalWords: 8 },
    'lt:best': { 'journey-1': 300, 'journey-3': 500 },
    'lt:streak': { days: 1, lastDay: '2026-10-05' },
  };
  const m = store.mergeDocs(remote, local);
  assert.deepEqual(m['lt:journey'].completed.sort(), ['journey-1', 'journey-2', 'journey-3']);
  assert.deepEqual(m['lt:achievements'].unlocked, { 'first-completion': 50, 'century-words': 70 });
  assert.equal(m['lt:achievements'].totalWords, 12);
  assert.deepEqual(m['lt:best'], { 'journey-1': 400, 'daily-2026-10-01': 900, 'journey-3': 500 });
  assert.equal(m['lt:streak'].lastDay, '2026-10-05');
  assert.equal(m['lt:settings'].tutorialDone, false);
  assert.equal(m['lt:guest'].id, 'guest-x');
});

test('mergeDocs of nothing stays empty', () => {
  assert.deepEqual(store.mergeDocs(null, {}), {});
});

test('session.js reads and writes the document through docStorage', () => {
  const doc = store.readForeign(oldSlot);
  let writes = 0;
  session.setStorage(store.docStorage(doc, () => { writes++; }));
  assert.equal(session.loadSettings().tutorialDone, true);
  assert.deepEqual(session.loadJourneyProgress().completed, ['journey-1', 'journey-2']);
  session.markJourneyLevelCompleted('journey-3');
  assert.ok(doc['lt:journey'].completed.includes('journey-3'));
  assert.equal(session.recordBestScore('journey-1', 500), true);
  assert.equal(doc['lt:best']['journey-1'], 500);
  assert.equal(session.unlockAchievement('hard-milestone'), true);
  assert.equal(session.unlockAchievement('hard-milestone'), false);
  assert.ok(writes >= 3);
  // A fresh document: defaults, then a guest profile is created once.
  const empty = {};
  session.setStorage(store.docStorage(empty, () => {}));
  assert.equal(session.loadSettings().tutorialDone, false);
  const g = session.guestProfile();
  assert.equal(session.guestProfile().id, g.id);
  assert.equal(empty['lt:guest'].name, 'Guest');
});

test('daily streak continues on consecutive days and restarts after a gap', () => {
  session.setStorage(store.docStorage({}, () => {}));
  assert.equal(session.recordDailyCompletion('2026-10-01').days, 1);
  assert.equal(session.recordDailyCompletion('2026-10-02').days, 2);
  assert.equal(session.recordDailyCompletion('2026-10-02').days, 2);
  assert.equal(session.recordDailyCompletion('2026-10-04').days, 1);
});
