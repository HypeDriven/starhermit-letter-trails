// The game's data and the StarHermit platform, on the runtime's modules:
// - the save (starhermit:storage `saves`, on the device and in the player's
//   cloud slot) is the browser build's own document: { 'lt:settings',
//   'lt:journey', 'lt:achievements', 'lt:best', 'lt:streak', 'lt:guest' },
//   exactly what it kept in localStorage and mirrored to game:<slug>.
//   src/session.js reads and writes it through a localStorage-like view
//   (src/store.js docStorage); two devices' copies merge on a conflict
//   (src/store.js mergeDocs, the browser build's saveconflict merge). The
//   slot the browser build wrote (the JS SDK's saveJSON) shows as foreign: it
//   is merged in and replaced once;
// - the browser build mirrored its settings into the account's settings KV
//   (volumes, reduced motion, high contrast, larger text, colour-vision,
//   left-handed, graphics, tutorialDone) and the language helper kept
//   ui.language there: the runtime's Options own those now, so they are
//   removed; a finished tutorial (tutorialDone) carries over into the save;
// - the player, the invite link, the platform's clock for the Daily, and
//   posting a ranked round's total through score-script.js (a practice
//   session whose socket carries { type: 'result', scores }, as the JS SDK's
//   submitScores did), then the rank and the board's top ten.
import type { JsonValue } from "starhermit:engine";
import {
  connectGame, inviteLink as fetchInviteLink, leaderboards, onPlayerChange, player, serverNow, serverTime, sessions,
  type Leaderboard,
} from "starhermit:platform";
import { saves, settings as store } from "starhermit:storage";
import { Sess, Store, type Doc } from "./game.ts";

// --- the save document ----------------------------------------------------------------------
let live: Doc = {};
let lastSavedAt = 0;
let dirty = false;
const mergedListeners = new Set<() => void>();
/** fn() after progress from the account (another device, the browser build) was merged in. */
export function onMerged(fn: () => void): void { mergedListeners.add(fn); }
function merged(): void { for (const fn of mergedListeners) fn(); }

function write(opts: { replaceForeign?: boolean } = {}): void {
  dirty = false;
  try { saves.save(live as unknown as JsonValue, { schema: 1, ...opts }); }
  catch (e) { console.warn(`save: ${String(e)}`); }
}
/** Writes the document if session.js changed it this frame (called each frame). */
export function flushDirty(): void { if (dirty) write(); }
/** Replaces the live document's keys in place (session.js keeps its view). */
function replaceDoc(next: Doc): void {
  for (const k of Object.keys(live)) delete live[k];
  Object.assign(live, next);
}
/** Merges another copy into the live document (and saves); whether anything changed. */
function adopt(other: unknown): boolean {
  const next = Store.mergeDocs(other, live);
  if (JSON.stringify(next) === JSON.stringify(Store.normalize(live))) return false;
  replaceDoc(next);
  write();
  return true;
}
saves.onConflict((local, remote) => ({ merged: Store.mergeDocs(remote.data, local?.data ?? null) as unknown as JsonValue }));
saves.onStatus((_status, state) => {
  if (state === "foreign") { migrateForeign(); return; }
  // The account's save replaced the device's (another device saved last): merge it in.
  const cur = saves.load();
  if (cur && cur.savedAt !== lastSavedAt) {
    lastSavedAt = cur.savedAt;
    if (adopt(cur.data)) merged();
  }
});
/** The browser build's cloud save: merged with this device's progress, saved over it once. */
function migrateForeign(): void {
  const old = saves.foreign();
  if (!old) return;
  const doc = Store.readForeign(old.text);
  let changed = false;
  if (doc) {
    const next = Store.mergeDocs(doc, live);
    changed = JSON.stringify(next) !== JSON.stringify(Store.normalize(live));
    replaceDoc(next);
  }
  write({ replaceForeign: true });
  if (changed) merged();
}

// The browser build's account settings KV: its game settings (src/session.js
// DEFAULT_SETTINGS keys) and the language helper's ui.language. All are the
// runtime's Options now and are removed; tutorialDone moves into the save.
export const BROWSER_KEYS = [
  "musicVolume", "effectsVolume", "ambienceVolume", "voiceVolume", "quality", "reducedMotion", "highContrast", "colorVision",
  "largerText", "leftHanded", "holdToConfirm", "haptics", "tutorialDone", "graphics", "ui.language",
];
function removeLegacy(): void {
  const keys = store.legacyKeys();
  if (!keys) return;
  if (keys.includes("tutorialDone") && store.legacy("tutorialDone") === true) {
    const s = Sess.loadSettings();
    if (!s.tutorialDone) { s.tutorialDone = true; Sess.saveSettings(s); }
  }
  for (const key of keys) if (BROWSER_KEYS.includes(key)) store.removeLegacy(key);
}

/** Reads the device's save and gives session.js its view of it (from onStart). */
export function initPlatform(): void {
  const cur = saves.load();
  lastSavedAt = cur?.savedAt ?? 0;
  live = Store.normalize(cur?.data ?? null);
  Sess.setStorage(Store.docStorage(live, () => { dirty = true; }));
  store.onLegacy(removeLegacy);
  removeLegacy();
  if (saves.state() === "foreign") migrateForeign();
  refreshPlayer();
  void serverTime().catch(() => undefined);
}

/** For the title's player line (the old sync labels): offline | saving | synced | error. */
export function syncState(): "offline" | "saving" | "synced" | "error" {
  if (!player()) return "offline";
  const st = saves.state();
  if (st === "error" || st === "read-blocked") return "error";
  if (st === "loading" || st === "foreign" || st === "uploading" || saves.status() === "pending") return "saving";
  return "synced";
}
export function flush(): void { flushDirty(); void saves.flush().catch(() => undefined); }

// --- the player and the clock ---------------------------------------------------------------
export function signedIn(): boolean { return !!player(); }
export function displayName(): string { return player()?.displayName ?? ""; }
let invite: string | null = null;
/** The invite link, fetched ahead so a button press can copy it at once. */
export function inviteLink(): string | null { return player() ? invite : null; }
function refreshPlayer(): void {
  invite = null;
  board = undefined;
  if (!player()) return;
  fetchInviteLink().then((u) => { invite = u; }, () => { invite = null; });
}
onPlayerChange(() => refreshPlayer());

/** Now in ms by the platform's clock when it has answered, else the device's (the Daily's day). */
export function nowMs(): number {
  try { return serverNow() ?? Date.now(); } catch { return Date.now(); }
}

// --- the high-score board -------------------------------------------------------------------
let board: Leaderboard | null | undefined;
async function highScoreBoard(): Promise<Leaderboard | null> {
  if (board !== undefined) return board;
  const list = await leaderboards.list();
  board = list.find((b) => b.key === "high-score") ?? null;
  return board;
}
export interface Posted { posted: boolean; rank: number | null }
export interface Row { player: string; score: number }

/** Signed in only: post a ranked round's total through score-script.js; { posted, rank }. Never rejects. */
export async function postLeaderboard(total: number): Promise<Posted> {
  const me = player();
  if (!me) return { posted: false, rank: null };
  const score = Math.max(0, Math.round(total));
  let accepted: string[] = [];
  try {
    const sessionId = await sessions.practice();
    accepted = await new Promise<string[]>((resolve) => {
      const socket = connectGame(sessionId);
      let done = false;
      const finish = (list: string[]): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.close();
        resolve(list);
      };
      const timer = setTimeout(() => finish([]), 15000);
      socket.on("open", () => { socket.sendCommand({ type: "result", scores: { "high-score": score } }); });
      socket.on("game", (data) => {
        const d = data as { type?: string; accepted?: string[] } | null;
        if (d && d.type === "result-ack") finish(Array.isArray(d.accepted) ? d.accepted : []);
      });
      socket.on("error", () => finish([]));
      socket.on("stopped", () => finish([]));
      socket.on("abandoned", () => finish([]));
    });
  } catch { return { posted: false, rank: null }; }
  if (!accepted.includes("high-score")) return { posted: false, rank: null };
  try {
    const b = await highScoreBoard();
    if (!b) return { posted: true, rank: null };
    const r = await leaderboards.entries(b.id, { pageSize: 100 });
    const mine = r.items.find((e) => e.userId === me.userId);
    return { posted: true, rank: mine ? mine.rank : null };
  } catch { return { posted: true, rank: null }; }
}

/** The high-score board's top entries with the players' display names; [] when unavailable. */
export async function topScores(pageSize = 10): Promise<Row[]> {
  try {
    const b = await highScoreBoard();
    if (!b) return [];
    const r = await leaderboards.entries(b.id, { pageSize });
    return r.items.map((e) => ({ player: e.displayName || e.username || "", score: Number.isFinite(e.score) ? e.score : 0 }));
  } catch { return []; }
}
