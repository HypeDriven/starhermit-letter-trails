'use strict';

// Letter Trails — static file server + JSON API.
// Serves the distribution offline, validates score replays authoritatively
// by re-simulating commands through src/rules.js.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(ROOT, 'data');
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.opus': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

let rules = null;   // lazily imported ESM rules engine
let sessionMod = null;
async function loadRules() {
  if (!rules) {
    rules = await import(pathToFileURL(path.join(ROOT, 'src/rules.js')).href);
    sessionMod = await import(pathToFileURL(path.join(ROOT, 'src/session.js')).href);
  }
  return { rules, session: sessionMod };
}

function sendJson(res, code, obj) {
  const body = obj === undefined ? '' : JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) { reject(new Error('payload-too-large')); req.destroy(); return; }
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Static file serving with path-traversal confinement.
function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.normalize(path.join(ROOT, rel.replace(/^\/+/, '')));
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    return sendJson(res, 403, { error: 'forbidden' });
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return sendJson(res, 404, { error: 'not-found' });
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

function loadScores() {
  try {
    return JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveScores(scores) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = SCORES_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(scores, null, 1));
  fs.renameSync(tmp, SCORES_FILE);
}

// Tie-break order: completion, fewer invalid actions, lower elapsed, stable id.
function scoreCompare(a, b) {
  const doneA = a.completed ? 0 : 1, doneB = b.completed ? 0 : 1;
  if (doneA !== doneB) return doneA - doneB;
  if (b.score !== a.score) return b.score - a.score;
  if (a.invalidActions !== b.invalidActions) return a.invalidActions - b.invalidActions;
  if (a.elapsedMs !== b.elapsedMs) return a.elapsedMs - b.elapsedMs;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

async function handleApi(req, res, urlPath, query) {
  if (req.method === 'GET' && urlPath === '/api/v1/time') {
    return sendJson(res, 200, { now: Date.now() });
  }

  if (req.method === 'GET' && urlPath === '/api/v1/daily') {
    const { session } = await loadRules();
    const content = await import(pathToFileURL(path.join(ROOT, 'src/content.js')).href);
    const day = session.utcDay(Date.now()).slice(0, 10);
    const def = content.dailyDefinition(day);
    return sendJson(res, 200, {
      date: day, seed: def.seed, size: def.size, theme: def.theme,
      wordCount: def.wordCount, contentVersion: def.contentVersion,
    });
  }

  if (req.method === 'POST' && urlPath === '/api/v1/scores') {
    let envelope;
    try {
      envelope = JSON.parse(await readBody(req));
    } catch (e) {
      return sendJson(res, 400, { error: 'bad-json: ' + e.message });
    }
    if (!envelope || typeof envelope !== 'object') {
      return sendJson(res, 400, { error: 'missing-envelope' });
    }
    const { session } = await loadRules();
    // Stale-version rejection before doing any work.
    if (envelope.schemaVersion !== session.REPLAY_SCHEMA_VERSION) {
      return sendJson(res, 400, { error: 'stale-schema-version' });
    }
    if (envelope.buildVersion !== session.BUILD_VERSION) {
      return sendJson(res, 400, { error: 'stale-build-version' });
    }
    // Authoritative validation: re-simulate the whole replay.
    const verdict = session.replayVerify(envelope);
    if (!verdict.ok) {
      return sendJson(res, 422, { error: 'replay-invalid: ' + verdict.reason });
    }
    const final = verdict.finalState;
    const scores = loadScores();
    const id = 'sc-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
    const record = {
      id,
      player: (envelope.player && String(envelope.player).slice(0, 40)) || 'guest',
      board: envelope.modeId && String(envelope.modeId).startsWith('daily-') ? 'daily' : 'global',
      modeId: String(envelope.modeId || 'unknown').slice(0, 60),
      seed: envelope.seed >>> 0,
      contentVersion: envelope.contentVersion || 1,
      buildVersion: envelope.buildVersion,
      score: final.score.total | 0,
      completed: final.status === 'complete',
      invalidActions: final.invalidActions | 0,
      elapsedMs: final.elapsedMs | 0,
      durationMs: final.elapsedMs | 0,
      submittedAt: Date.now(),
    };
    // Plausibility: score cannot exceed theoretical word points + bonuses.
    const maxWordPoints = final.words.reduce((s, w) => s + 20 * w.length, 0);
    const maxTotal = maxWordPoints + final.words.length * 150 + 366 * 25;
    if (record.score < 0 || record.score > maxTotal) {
      return sendJson(res, 422, { error: 'implausible-score' });
    }
    scores.push(record);
    saveScores(scores.slice(-5000));
    return sendJson(res, 200, { ok: true, id, score: record.score });
  }

  if (req.method === 'GET' && urlPath === '/api/v1/scores') {
    const board = query.get('board') || 'global';
    const date = query.get('date');
    let scores = loadScores();
    if (board === 'daily') {
      scores = scores.filter((s) => s.board === 'daily' && (!date || s.modeId === 'daily-' + date));
    } else if (board === 'global') {
      scores = scores.filter((s) => s.board === 'global');
    }
    scores.sort(scoreCompare);
    return sendJson(res, 200, { board, date, scores: scores.slice(0, 100) });
  }

  if (req.method === 'POST' && urlPath === '/api/v1/events') {
    try {
      const body = JSON.parse(await readBody(req));
      if (!body || !Array.isArray(body.events) || body.events.length > 100) {
        return sendJson(res, 400, { error: 'bad-events' });
      }
      // Telemetry is accepted and dropped (no persistent store by design).
    } catch {
      return sendJson(res, 400, { error: 'bad-json' });
    }
    res.writeHead(204);
    return res.end();
  }

  return sendJson(res, 404, { error: 'unknown-api-route' });
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    const urlPath = decodeURIComponent(u.pathname);
    if (urlPath.startsWith('/api/')) {
      return await handleApi(req, res, urlPath, u.searchParams);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, { error: 'method-not-allowed' });
    }
    serveStatic(req, res, urlPath);
  } catch (e) {
    sendJson(res, 500, { error: 'internal: ' + e.message });
  }
});

server.listen(PORT, () => console.log('Letter Trails server on http://localhost:' + PORT));
