'use strict';

// Letter Trails — StarHermit platform integration: fragment launch token
// (read once, stripped), Bearer on every call, 45-min token refresh, profile
// nickname, cloud-save mirror (zip+base64, remote-preferred), read-only
// leaderboards. The own-server /api/v1/time|daily|scores|events surface is
// local-dev only, gated by the time probe so an unhosted build stays silent.
// localStorage is always the offline cache. Never persists tokens.

import { uid } from './util.js';

let launchToken = null;   // memory only
let userId = null;        // JWT sub
let gameScope = null;     // JWT game_scope (slug); never hard-coded
let profileName = null;   // platform nickname once fetched
let online = true;
let clockOffsetMs = 0;    // dev-server clock skew; platform mode uses local time
let devServer = false;    // own server.js answered the /api/v1/time probe
let refreshTimer = null;
let telemetryQueue = [];
let lastTelemetryAt = 0;
const TELEMETRY_THROTTLE_MS = 1500;
const QUEUE_KEY = 'lt:telemetry-queue';

try {
  telemetryQueue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
} catch { telemetryQueue = []; }

// ---------------------------------------------------------------------------
// Launch — fragment token read once + stripped; ?token= kept for local dev
// ---------------------------------------------------------------------------

function decodePayload() {
  if (!launchToken) return null;
  const parts = launchToken.split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

export function parseLaunchToken(hash = window.location.hash, search = window.location.search) {
  let token = null;
  if (hash) {
    const frag = new URLSearchParams(hash.replace(/^#/, ''));
    token = frag.get('game_token');
    if (token) {
      try {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      } catch { /* history unavailable — the token still works */ }
    }
  }
  if (!token) {
    // Local dev fallback only; the platform always sends the fragment.
    token = new URLSearchParams(search).get('token');
  }
  launchToken = token;
  const payload = decodePayload();
  userId = (payload && payload.sub) || null;
  gameScope = (payload && payload.game_scope) || null;
  return launchToken;
}

export function hasToken() { return !!launchToken; }
export function isHosted() { return !!launchToken; } // hosted mode = platform launch
export function getGameScope() { return gameScope; }
export function getUserId() { return userId; }

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

// ---------------------------------------------------------------------------
// Profile — nickname only, never usernames, never /api/v1/me
// ---------------------------------------------------------------------------

const nicknameCache = new Map();

export async function fetchProfile() {
  const sub = getUserId();
  if (!sub) return null;
  // Fallback identity until the profile answers; display NICKNAME only.
  profileName = 'Player ' + String(sub).slice(0, 8);
  const res = await api('/api/v1/users/' + encodeURIComponent(sub) + '/profile', { retries: 1 });
  if (res.ok && res.data && res.data.nickname) {
    profileName = String(res.data.nickname).slice(0, 40);
  }
  return profileName;
}

export function getProfileName() { return profileName; }

async function nicknameFor(id) {
  if (!id) return 'player';
  if (nicknameCache.has(id)) return nicknameCache.get(id);
  let name = 'Player ' + String(id).slice(0, 8);
  const res = await api('/api/v1/users/' + encodeURIComponent(id) + '/profile', { retries: 0 });
  if (res.ok && res.data && res.data.nickname) name = String(res.data.nickname).slice(0, 40);
  nicknameCache.set(id, name);
  return name;
}

// ---------------------------------------------------------------------------
// Token refresh — scoped tokens re-mint; swap in the new token
// ---------------------------------------------------------------------------

const REFRESH_INTERVAL_MS = 45 * 60 * 1000;
const REFRESH_RETRY_MS = 60 * 1000;

async function refreshLaunchToken() {
  const slug = getGameScope();
  if (!launchToken || !slug) return;
  const res = await api('/api/v1/games/' + encodeURIComponent(slug) + '/launch-token', { method: 'POST', retries: 0 });
  if (res.ok && res.data && res.data.token) {
    launchToken = res.data.token;
    const payload = decodePayload();
    if (payload && payload.sub) userId = payload.sub;
    scheduleTokenRefresh(REFRESH_INTERVAL_MS);
  } else {
    scheduleTokenRefresh(REFRESH_RETRY_MS); // retry soon
  }
}

function scheduleTokenRefresh(delay) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshLaunchToken, delay);
}

export function startTokenRefresh() {
  if (launchToken && getGameScope()) scheduleTokenRefresh(REFRESH_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// Server time (local dev only) for daily boundary countdowns
// ---------------------------------------------------------------------------

// Dev-only probe: the platform has no time route, so platform mode keeps the
// local clock. When the own dev server answers, its round-trip-adjusted
// offset drives the daily boundary; when nothing answers, no other dev route
// is requested and the game runs fully local and silent.
export async function syncTime() {
  if (launchToken) return true; // platform mode: local clock, no probe
  const t0 = Date.now();
  const res = await api('/api/v1/time', { retries: 1 });
  if (!res.ok || !res.data || !Number.isFinite(res.data.now)) {
    devServer = false;
    return false;
  }
  const t1 = Date.now();
  clockOffsetMs = res.data.now - (t0 + (t1 - t0) / 2);
  devServer = true;
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

// ---------------------------------------------------------------------------
// Leaderboards — read-only on the platform; validated replay submit is a
// local-dev-only feature against server.js. Personal bests stay local.
// ---------------------------------------------------------------------------

export async function fetchGameInfo() {
  const slug = getGameScope();
  if (!launchToken || !slug) return { ok: false, status: 0, error: 'not-hosted' };
  return api('/api/v1/games/' + encodeURIComponent(slug));
}

export async function fetchLeaderboardEntries(leaderboardId, { friendsOnly = false, page = 0, pageSize = 10 } = {}) {
  if (!launchToken) return { ok: false, status: 0, error: 'not-hosted', data: [] };
  const q = '?friendsOnly=' + (friendsOnly ? '1' : '0') +
    '&page=' + page + '&pageSize=' + pageSize;
  const res = await api('/api/v1/leaderboards/' + encodeURIComponent(leaderboardId) + '/entries' + q);
  if (!res.ok) return { ok: false, status: res.status, error: res.error, data: [] };
  const list = Array.isArray(res.data) ? res.data
    : (res.data && Array.isArray(res.data.entries)) ? res.data.entries : [];
  const rows = [];
  for (const e of list) {
    const id = e.userId || e.user_id || e.playerId || null;
    const score = Number.isFinite(e.score) ? e.score : (Number.isFinite(e.value) ? e.value : 0);
    rows.push({ player: await nicknameFor(id), score });
  }
  return { ok: true, status: res.status, data: rows };
}

// Local-dev-only validated replay submission against server.js.
export async function submitScore(envelope) {
  if (launchToken || !devServer) return { ok: false, status: 0, error: 'not-hosted' };
  return api('/api/v1/scores', { method: 'POST', body: envelope });
}

// Local-dev-only leaderboard read against server.js.
export async function fetchLeaderboard(board = 'global', date = null) {
  if (launchToken || !devServer) return { ok: false, status: 0, error: 'not-hosted', data: { scores: [] } };
  const q = '?board=' + encodeURIComponent(board) + (date ? '&date=' + encodeURIComponent(date) : '');
  return api('/api/v1/scores' + q);
}

// ---------------------------------------------------------------------------
// Cloud save — one slot, zip+base64; localStorage stays the offline cache
// ---------------------------------------------------------------------------

// Minimal ZIP writer/reader (stored entries only, no compression).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(name, dataBytes) {
  const enc = new TextEncoder();
  const nameB = enc.encode(name);
  const crc = crc32(dataBytes);
  const out = [];
  const u16 = (v) => out.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v) => out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0);
  u32(crc); u32(dataBytes.length); u32(dataBytes.length);
  u16(nameB.length); u16(0);
  const head = new Uint8Array(out);
  const cd = [];
  const c16 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff);
  const c32 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  c32(0x02014b50); c16(20); c16(20); c16(0); c16(0); c16(0); c16(0);
  c32(crc); c32(dataBytes.length); c32(dataBytes.length);
  c16(nameB.length); c16(0); c16(0); c16(0); c16(0); c32(0); c32(0); // attrs + local-header offset
  const cdHead = new Uint8Array(cd);
  const cdOff = head.length + nameB.length + dataBytes.length;
  const parts = [head, nameB, dataBytes, cdHead, nameB];
  const eocd = [];
  const e32 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  const e16 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff);
  e32(0x06054b50); e16(0); e16(0); e16(1); e16(1);
  e32(cdHead.length + nameB.length); e32(cdOff); e16(0);
  parts.push(new Uint8Array(eocd));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  return buf;
}
function unzipFirstEntry(zipBytes) {
  // Stored single-entry reader: scan local headers for compression 0.
  const dv = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  let off = 0;
  while (off + 30 <= zipBytes.length && dv.getUint32(off, true) === 0x04034b50) {
    const method = dv.getUint16(off + 8, true);
    const size = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const dataOff = off + 30 + nameLen + extraLen;
    if (method !== 0) throw new Error('unsupported zip entry');
    return zipBytes.slice(dataOff, dataOff + size);
  }
  throw new Error('bad zip');
}
function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function base64ToBytes(b64) {
  const s = atob(b64);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

// Exported for the zip strict-reader validation harness.
export const _zip = { zipStore, unzipFirstEntry, bytesToBase64, base64ToBytes };

const CLOUD_KEYS = ['lt:settings', 'lt:journey', 'lt:achievements', 'lt:best', 'lt:streak', 'lt:guest'];
const SAVE_DEBOUNCE_MS = 2000;
const PUSH_RETRY_COOLDOWN_MS = 30 * 1000;
const SAVE_NAME = 'letter-trails-save.json';

let syncStatus = 'offline'; // offline | saving | synced | error
let syncedFp = null;        // fingerprint last known to match the remote slot
let saveTimer = null;
let pushRetryAfter = 0;
const syncListeners = new Set();

export function getSyncStatus() { return syncStatus; }
export function onSyncStatus(fn) { syncListeners.add(fn); return () => syncListeners.delete(fn); }
function setSyncStatus(s) {
  syncStatus = s;
  for (const fn of syncListeners) fn(s);
}

function cloudFingerprint() {
  let s = '';
  for (const k of CLOUD_KEYS) s += (localStorage.getItem(k) || '') + '|';
  return s;
}

function collectCloudDoc() {
  const doc = {};
  for (const k of CLOUD_KEYS) {
    const raw = localStorage.getItem(k);
    if (raw == null) continue;
    try { doc[k] = JSON.parse(raw); } catch { doc[k] = raw; }
  }
  return doc;
}

function applyCloudDoc(doc) {
  for (const k of CLOUD_KEYS) {
    if (doc[k] === undefined) continue;
    try {
      localStorage.setItem(k, typeof doc[k] === 'string' ? doc[k] : JSON.stringify(doc[k]));
    } catch { /* storage unavailable — session continues */ }
  }
}

export async function pullCloudSave() {
  const slug = getGameScope();
  if (!launchToken || !slug) return false;
  try {
    const res = await fetch('/api/v1/me/cloud-saves/' + encodeURIComponent(slug), {
      headers: { Authorization: 'Bearer ' + launchToken },
    });
    if (res.status === 404) { // no remote save yet: local becomes the seed
      syncedFp = cloudFingerprint();
      setSyncStatus('synced');
      return false;
    }
    if (!res.ok) {
      setSyncStatus(isOnline() ? 'error' : 'offline');
      return false;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const doc = JSON.parse(new TextDecoder().decode(unzipFirstEntry(bytes)));
    applyCloudDoc(doc);
    syncedFp = cloudFingerprint();
    setSyncStatus('synced');
    return true;
  } catch (e) {
    setSyncStatus(isOnline() ? 'error' : 'offline');
    return false;
  }
}

export async function pushCloudSave() {
  const slug = getGameScope();
  if (!launchToken || !slug) return false;
  const fp = cloudFingerprint();
  if (fp === syncedFp) return true; // nothing new
  setSyncStatus('saving');
  try {
    const data = new TextEncoder().encode(JSON.stringify(collectCloudDoc()));
    if (data.length > 9 * 1024 * 1024) { // slot limit is 10 MB
      setSyncStatus('error');
      return false;
    }
    const res = await api('/api/v1/me/cloud-saves/' + encodeURIComponent(slug), {
      method: 'PUT',
      body: { dataBase64: bytesToBase64(zipStore(SAVE_NAME, data)) },
    });
    if (res.ok) {
      syncedFp = fp;
      setSyncStatus('synced');
      return true;
    }
    pushRetryAfter = Date.now() + PUSH_RETRY_COOLDOWN_MS;
    setSyncStatus(isOnline() ? 'error' : 'offline');
    return false;
  } catch (e) {
    pushRetryAfter = Date.now() + PUSH_RETRY_COOLDOWN_MS;
    setSyncStatus('offline');
    return false;
  }
}

export function scheduleCloudSave() {
  if (!launchToken) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; pushCloudSave(); }, SAVE_DEBOUNCE_MS);
}

// Watches the offline cache and mirrors changes (~2 s debounce, pagehide and
// visibility flush). Call once after the initial pull resolves.
export function startCloudSync() {
  if (!launchToken) return;
  syncedFp = syncedFp === null ? cloudFingerprint() : syncedFp;
  setInterval(() => {
    if (Date.now() < pushRetryAfter) return;
    if (cloudFingerprint() !== syncedFp && !saveTimer) scheduleCloudSave();
  }, SAVE_DEBOUNCE_MS);
  const flush = () => {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    pushCloudSave();
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
}

// ---------------------------------------------------------------------------
// Telemetry — anonymous funnel events, throttled, queued offline.
// Local dev only: the platform has no events route reachable by launch tokens.
// ---------------------------------------------------------------------------

const sessionAnonId = 'a-' + uid();

export function telemetry(event, data = {}) {
  if (launchToken) return; // hosted mode: no platform telemetry endpoint
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
  if (launchToken || !devServer) {
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
