'use strict';

// StarHermit adapter (src/platform.js) over the real shared SDK with a stubbed
// fetch and launch fragment. Each scenario imports a fresh module instance.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SDK_SRC = fs.readFileSync(new URL('../starhermit-sdk.js', import.meta.url), 'utf8');
function loadSdk() {
  const mod = { exports: {} };
  new Function('module', 'exports', 'self', SDK_SRC)(mod, mod.exports, globalThis);
  return mod.exports;
}

const USER = 'a1b2c3d4-0000-4000-8000-000000000001';
const SLUG = 'letter-trails';
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

function fixture(href) {
  const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64url({ alg: 'none' })}.${b64url({ sub: USER, game_scope: SLUG, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
  const u = new URL(href.replace('{jwt}', jwt));
  const win = {
    location: { href: u.href, hostname: u.hostname, pathname: u.pathname, search: u.search, hash: u.hash, origin: u.origin, assign() {} },
    history: { state: null, replaceState(_s, _t, url) { win.replaced = url; } },
  };
  const calls = [];
  let slot = null;
  const kv = { musicVolume: 0.1 };
  const res = (status, body, bytes) => ({
    ok: status >= 200 && status < 300, status,
    text: async () => (body == null ? '' : JSON.stringify(body)),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body, auth: (init.headers || {}).Authorization });
    if (url === `/api/v1/users/${USER}/profile`) return res(200, { nickname: 'Trail Finder', username: 'hidden' });
    if (url === `/api/v1/me/cloud-saves/${encodeURIComponent('game:' + SLUG)}`) {
      if (method === 'PUT') { slot = new Uint8Array(Buffer.from(body.dataBase64, 'base64')); return res(204); }
      return slot ? res(200, null, slot) : res(404);
    }
    if (url === `/api/v1/games/${SLUG}/settings`) {
      if (method === 'PATCH') Object.assign(kv, body.settings);
      return res(200, { settings: kv });
    }
    if (url === `/api/v1/games/${SLUG}/controls`) return res(200, { actions: [{ action: 'hint', codes: ['KeyJ'] }] });
    return res(404);
  };
  // Unref'd timers so the SDK's renewal timer never keeps the test process alive.
  const setTimeout = (fn, ms) => { const t = globalThis.setTimeout(fn, ms); t.unref(); return t; };
  globalThis.StarHermit = loadSdk().create({ window: win, fetch, setTimeout, clearTimeout });
  return { win, calls, kv };
}
let n = 0;
const fresh = () => import(`../src/platform.js?case=${++n}`);

test('hosted: token read + stripped, profile nickname, cloud save at game:<slug>', async () => {
  const { win, calls } = fixture('https://letter-trails.starhermit.com/#game_token={jwt}');
  const p = await fresh();
  assert.ok(p.parseLaunchToken());
  assert.equal(p.hasToken(), true);
  assert.equal(p.getUserId(), USER);
  assert.equal(p.getGameScope(), SLUG);
  assert.ok(!String(win.replaced).includes('game_token'));
  assert.equal(await p.fetchProfile(), 'Trail Finder');
  assert.match(calls[0].auth, /^Bearer /);

  localStorage.setItem('lt:best', JSON.stringify({ daily: 420 }));
  await p.pushCloudSave();
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.url, '/api/v1/me/cloud-saves/game%3Aletter-trails');
  localStorage.setItem('lt:best', JSON.stringify({ daily: 0 }));
  assert.equal(await p.pullCloudSave(), true);
  assert.deepEqual(JSON.parse(localStorage.getItem('lt:best')), { daily: 420 });
  assert.equal(p.getSyncStatus(), 'synced');
});

test('hosted: settings KV load + changed-key patch, bindings, invite link', async () => {
  const { calls, kv } = fixture('https://x.example/#game_token={jwt}');
  const p = await fresh();
  p.parseLaunchToken();
  assert.deepEqual(await p.loadPlatformSettings(), { musicVolume: 0.1 });
  p.primeSettings({ musicVolume: 0.1, haptics: true });
  p.pushSettings({ musicVolume: 0.1, haptics: false });
  await p.flushSettings();
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.equal(patch.url, `/api/v1/games/${SLUG}/settings`);
  assert.deepEqual(patch.body, { settings: { haptics: false } });
  assert.equal(kv.haptics, false);
  assert.deepEqual(await p.loadBindings({ hint: ['KeyH'], back: ['Escape'] }), { hint: ['KeyJ'], back: ['Escape'] });
  assert.equal(p.inviteLink(), `https://dashboard.starhermit.com/game-invite/${USER}/${SLUG}`);
});

test('standalone: no token means zero platform fetches', async () => {
  const { calls } = fixture('http://localhost:8080/index.html');
  const p = await fresh();
  assert.equal(p.parseLaunchToken(), null);
  assert.equal(p.hasToken(), false);
  assert.equal(await p.fetchProfile(), null);
  assert.equal(await p.pullCloudSave(), false);
  assert.deepEqual(await p.loadPlatformSettings(), {});
  assert.deepEqual(await p.loadBindings({ hint: ['KeyH'] }), { hint: ['KeyH'] });
  assert.equal((await p.fetchPlatformLeaderboard()).ok, false);
  p.primeSettings({});
  p.pushSettings({ haptics: false });
  p.scheduleCloudSave();
  assert.equal(p.canSignIn(), false);
  assert.equal(p.inviteLink(), null);
  assert.equal(calls.length, 0);
});

test('signed-out platform host offers sign-in without fetching', async () => {
  const { calls } = fixture('https://letter-trails.starhermit.com/');
  const p = await fresh();
  p.parseLaunchToken();
  assert.equal(p.canSignIn(), true);
  assert.equal(calls.length, 0);
});
