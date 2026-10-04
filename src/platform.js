'use strict';

// Letter Trails — StarHermit platform integration over the shared SDK
// (window.StarHermit from starhermit-sdk.js): launch token + renewal, sign-in,
// profile nickname, game:<slug> cloud-save mirror, settings KV, key bindings,
// invite link and read-only leaderboards. No own-server route is ever called:
// standalone (no launch token) makes no network request at all, and the
// daily boundary uses the device clock. localStorage is always the offline
// cache. Never persists tokens.

const SH = () => globalThis.StarHermit || null;
let profileName = null;   // platform nickname once fetched

// ---------------------------------------------------------------------------
// Launch — the SDK reads #game_token= / #access_token= once and strips it
// ---------------------------------------------------------------------------

const authListeners = new Set();
let initialized = false;
export function parseLaunchToken() {
  const sh = SH();
  if (!sh) return null;
  if (!initialized) {
    initialized = true;
    sh.init();
    sh.on('saved', (ok) => setSyncStatus(ok ? 'synced' : 'error'));
    sh.on('auth', (a) => {
      if (!a.signedIn) { profileName = null; setSyncStatus('offline'); }
      for (const fn of authListeners) { try { fn(a); } catch { /* ignore */ } }
    });
  }
  return sh.token;
}
export function onAuth(fn) { authListeners.add(fn); }

export function hasToken() { const sh = SH(); return !!(sh && sh.signedIn); }
export function isHosted() { return hasToken(); } // hosted mode = platform launch
export function getGameScope() { const sh = SH(); return sh ? sh.slug : null; }
export function getUserId() { const sh = SH(); return sh ? sh.userId : null; }
export function onPlatformHost() { return /\.starhermit\.com$/.test((globalThis.location && location.hostname) || ''); }
export function canSignIn() { const sh = SH(); return !!sh && sh.canSignIn(); }
export function signIn() { const sh = SH(); return !!sh && sh.signIn(); }
export function inviteLink() { return hasToken() ? SH().inviteLink() : null; }
export function loadBindings(defaults) { return hasToken() ? SH().loadBindings(defaults) : Promise.resolve(defaults); }

// ---------------------------------------------------------------------------
// Profile — nickname only, never usernames, never /api/v1/me
// ---------------------------------------------------------------------------

export async function fetchProfile() {
  if (!hasToken()) return null;
  const p = await SH().profile();
  profileName = p ? String(p.displayName).slice(0, 40) : 'Player ' + String(getUserId()).slice(0, 6);
  return profileName;
}

export function getProfileName() { return profileName; }

async function nicknameFor(id) {
  if (!id) return 'player';
  const p = await SH().profile(id);
  return p ? String(p.displayName).slice(0, 40) : 'Player ' + String(id).slice(0, 6);
}

// Renewal is owned by the SDK (re-mint before expiry, sign-out when refused).
export function startTokenRefresh() {}

// ---------------------------------------------------------------------------
// Leaderboards — read-only on the platform; personal bests stay local.
// ---------------------------------------------------------------------------

// The game's first platform board (read-only), names resolved via profiles.
export async function fetchPlatformLeaderboard({ pageSize = 10 } = {}) {
  if (!hasToken()) return { ok: false, error: 'not-hosted', data: [] };
  const lb = await SH().leaderboard(null, { pageSize });
  if (!lb || !lb.board) return { ok: false, error: 'no-board', data: [] };
  const rows = [];
  for (const e of lb.items || []) {
    const score = Number.isFinite(e.score) ? e.score : (Number.isFinite(e.value) ? e.value : 0);
    rows.push({ player: await nicknameFor(e.userId || null), score });
  }
  return { ok: true, data: rows };
}

// ---------------------------------------------------------------------------
// Cloud save — the game:<slug> slot; localStorage stays the offline cache
// ---------------------------------------------------------------------------

const CLOUD_KEYS = ['lt:settings', 'lt:journey', 'lt:achievements', 'lt:best', 'lt:streak', 'lt:guest'];
const SAVE_DEBOUNCE_MS = 2000;

let syncStatus = 'offline'; // offline | saving | synced | error
let syncedFp = null;        // fingerprint last handed to the SDK
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

// Remote-first load: a cloud doc replaces the cached keys.
export async function pullCloudSave() {
  if (!hasToken()) return false;
  setSyncStatus('saving');
  const doc = await SH().loadJSON();
  if (doc && typeof doc === 'object') applyCloudDoc(doc);
  syncedFp = cloudFingerprint();
  setSyncStatus('synced');
  return !!doc;
}

// Hand the current doc to the SDK's debounced writer when it changed.
export function scheduleCloudSave() {
  if (!hasToken()) return;
  const fp = cloudFingerprint();
  if (fp === syncedFp) return;
  syncedFp = fp;
  setSyncStatus('saving');
  SH().saveJSON(collectCloudDoc(), SAVE_DEBOUNCE_MS);
}
export function pushCloudSave() {
  if (!hasToken()) return Promise.resolve(false);
  scheduleCloudSave();
  return SH().flushSave(true);
}

// Watches the offline cache and mirrors changes (~2 s debounce, keepalive
// flush on pagehide / hidden tab). Call once after the initial pull resolves.
export function startCloudSync() {
  if (!hasToken()) return;
  setInterval(scheduleCloudSave, SAVE_DEBOUNCE_MS);
  const flush = () => { if (hasToken()) { pushCloudSave(); flushSettings(); } };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
}

// ---------------------------------------------------------------------------
// Settings KV — per-player preferences mirrored key by key
// ---------------------------------------------------------------------------

const SETTINGS_DEBOUNCE_MS = 1500;
let lastSettings = null;
let pendingPatch = null;
let settingsTimer = null;

export async function loadPlatformSettings() {
  return hasToken() ? (await SH().getSettings()) || {} : {};
}
export function primeSettings(settings) { lastSettings = JSON.stringify(settings); }
export function pushSettings(settings) {
  if (!hasToken() || lastSettings === null) return;
  const json = JSON.stringify(settings);
  if (json === lastSettings) return;
  const prev = JSON.parse(lastSettings);
  lastSettings = json;
  pendingPatch = pendingPatch || {};
  for (const k of Object.keys(settings)) {
    if (JSON.stringify(settings[k]) !== JSON.stringify(prev[k])) pendingPatch[k] = settings[k];
  }
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(flushSettings, SETTINGS_DEBOUNCE_MS);
}
export function flushSettings() {
  clearTimeout(settingsTimer);
  settingsTimer = null;
  if (!pendingPatch || !hasToken()) return Promise.resolve(null);
  const patch = pendingPatch;
  pendingPatch = null;
  return SH().patchSettings(patch);
}
