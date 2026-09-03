'use strict';

// Letter Trails — host/platform integration: launch token, same-origin API,
// server-time sync, guest profile, score submit, leaderboard, telemetry.
// Degrades gracefully offline (queued telemetry, local-only play).
// Never persists tokens.

import { uid } from './util.js';

let launchToken = null;   // memory only
let clockOffsetMs = 0;    // serverNow - clientNow, round-trip adjusted
let online = true;
let hosted = false;       // set by the one-time /api/v1/time probe; when false,
                          // no other API route may be requested (they do not
                          // exist on every host, and a 404 is a console error)
let telemetryQueue = [];
let lastTelemetryAt = 0;
const TELEMETRY_THROTTLE_MS = 1500;
const QUEUE_KEY = 'lt:telemetry-queue';

try {
  telemetryQueue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
} catch { telemetryQueue = []; }

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

export function parseLaunchToken(search = window.location.search) {
  const params = new URLSearchParams(search);
  launchToken = params.get('token'); // may be null → guest/local mode
  return launchToken;
}

export function getGameScope() {
  // Game scope comes from the launch token payload, never a hard-coded slug.
  if (!launchToken) return null;
  const parts = launchToken.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.scope || payload.game || null;
  } catch {
    return null;
  }
}

export function hasToken() { return !!launchToken; }

// ---------------------------------------------------------------------------
// API core with structured errors + retry/backoff
// ---------------------------------------------------------------------------

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export async function api(path, { method = 'GET', body = null, retries = 2 } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      const res = await fetch(path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(launchToken ? { Authorization: 'Bearer ' + launchToken } : {}),
        },
        body: body ? JSON.stringify(body) : null,
      });
      let data = null;
      if (res.status !== 204) {
        data = await res.json().catch(() => null);
      }
      if (res.ok) { online = true; return { ok: true, status: res.status, data }; }
      const err = (data && data.error) || 'http-' + res.status;
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        attempt++;
        await sleep(250 * Math.pow(2, attempt));
        continue;
      }
      return { ok: false, status: res.status, error: err };
    } catch (e) {
      online = false;
      if (attempt < retries) {
        attempt++;
        await sleep(250 * Math.pow(2, attempt));
        continue;
      }
      return { ok: false, status: 0, error: 'offline: ' + e.message };
    }
  }
}

export function isOnline() { return online; }
export function isHosted() { return hosted; }

// ---------------------------------------------------------------------------
// Server time (round-trip-adjusted) for daily boundary countdowns
// ---------------------------------------------------------------------------

// The one probe every host is guaranteed to answer. Its result gates every
// other API call: without it the game runs fully local and silent.
export async function syncTime() {
  const t0 = Date.now();
  const res = await api('/api/v1/time', { retries: 1 });
  if (!res.ok || !res.data || !Number.isFinite(res.data.now)) {
    hosted = false;
    return false;
  }
  const t1 = Date.now();
  clockOffsetMs = res.data.now - (t0 + (t1 - t0) / 2);
  hosted = true;
  return true;
}

export function serverNow() { return Date.now() + clockOffsetMs; }

// ms until the next UTC daily boundary (03:00 rollover per util.utcDay).
export function msUntilDailyBoundary() {
  const nowMs = serverNow();
  const d = new Date(nowMs);
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 3, 0, 0));
  if (next.getTime() <= nowMs) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - nowMs;
}

export async function fetchDaily() {
  if (!hosted) return { ok: false, status: 0, error: 'not-hosted' };
  return api('/api/v1/daily');
}

// ---------------------------------------------------------------------------
// Scores & leaderboards
// ---------------------------------------------------------------------------

export async function submitScore(envelope) {
  if (!hosted) return { ok: false, status: 0, error: 'not-hosted' };
  return api('/api/v1/scores', { method: 'POST', body: envelope });
}

export async function fetchLeaderboard(board = 'global', date = null) {
  if (!hosted) return { ok: false, status: 0, error: 'not-hosted', data: { scores: [] } };
  const q = '?board=' + encodeURIComponent(board) + (date ? '&date=' + encodeURIComponent(date) : '');
  return api('/api/v1/scores' + q);
}

// ---------------------------------------------------------------------------
// Telemetry — anonymous funnel events, throttled, queued offline
// ---------------------------------------------------------------------------

const sessionAnonId = 'a-' + uid();

export function telemetry(event, data = {}) {
  const allowed = ['start', 'tutorial-step', 'round-end', 'retry', 'settings-change', 'error'];
  if (!allowed.includes(event)) return;
  const t = Date.now();
  if (t - lastTelemetryAt < TELEMETRY_THROTTLE_MS && event !== 'round-end' && event !== 'error') return;
  lastTelemetryAt = t;
  telemetryQueue.push({ event, data, at: t, anon: sessionAnonId });
  flushTelemetry();
}

export async function flushTelemetry() {
  if (!telemetryQueue.length) return;
  if (!hosted) {
    // Host has no events route: keep the queue bounded locally, send nothing.
    telemetryQueue = telemetryQueue.slice(-50);
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(telemetryQueue)); } catch { /* ignore */ }
    return;
  }
  const batch = telemetryQueue;
  const res = await api('/api/v1/events', { method: 'POST', body: { events: batch }, retries: 0 });
  if (res.ok || res.status === 204) {
    telemetryQueue = [];
    try { localStorage.removeItem(QUEUE_KEY); } catch { /* ignore */ }
  } else {
    // Offline / rejected: keep a bounded queue locally for later.
    telemetryQueue = batch.slice(-50);
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(telemetryQueue)); } catch { /* ignore */ }
  }
}
