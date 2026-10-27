// Letter Trails on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The rules (src/rules.js), content
// (src/content.js), the session's phase machine, local progress,
// achievements and replay envelope (src/session.js) and the save document
// (src/store.js) are the browser build's, unchanged in what they decide; this
// module is what src/main.js did around them — the round lifecycle (mode
// setup → tutorial lessons → active ⇄ paused → results), the selection from
// pointer drags, touch drags and the cursor keys (arrows + Enter, as before),
// hints, the clock folded into the command log in 5 s chunks, the results
// with achievements, local bests, the Journey unlock, the daily streak and
// posting ranked rounds (Daily, Journey) to the high-score board, and the
// lifecycle (a hidden window pauses the round, as visibilitychange did).
// Screens, rails and tray are drawn by screens.ts (starhermit:ui), the board
// by render.ts (starhermit:scene).
//
// Time is the runtime's fixed steps: the round's clock advances 1/60 s per
// fixed step while it is active, so pauses, a hidden window and slow frames
// never cost time and play scripts replay exactly.
import "./i18n.ts";
import { clipboard, frame, onFixedUpdate, onPreferencesChange, onRender, onResume, onStart, onSuspend, onUpdate, preferences, setFixedRate } from "starhermit:engine";
import { onAction, onPointerButton, onPointerMove, onTouch } from "starhermit:input";
import * as ui from "starhermit:ui";
import { onSessionEnded, requestSignIn } from "starhermit:platform";
import { Content, Rules, Sess, Util, type Achievement, type Cell, type Command, type Def, type Settings, type State } from "./game.ts";
import * as audio from "./audio.ts";
import { M, N, S, T, type Msg } from "./i18n.ts";
import * as platform from "./platform.ts";
import { lookFor } from "./quality.ts";
import * as render from "./render.ts";
import { drawScreens } from "./screens.ts";
import { applyContrast, initStyles } from "./style.ts";

export type Screen = "title" | "mode" | "journey" | "practice" | "challenge" | "help" | "settings" | "game";
export type Overlay = "pause" | "results" | "tutorial" | null;
export interface ModeDef extends Def { label: Msg; desc: Msg }
export interface Results {
  state: State; achievements: Achievement[]; best: boolean; nextLabel: string; constraint: (() => string) | null;
}

export const app = {
  screen: "title" as Screen,
  overlay: null as Overlay,
  /** Where How to Play and Settings go back to (the title or the pause menu). */
  under: "title" as "title" | "pause",
  /** Frame the screen or overlay opened on (the press that opened it must not also act on it). */
  openedFrame: 0,
  focusNext: null as string | null,
  sess: null as unknown as ReturnType<typeof Sess.createSession>,
  settings: null as unknown as Settings,
  def: null as ModeDef | null,
  state: null as State | null,
  envelope: null as unknown,
  mode: null as "journey" | "daily" | "practice" | "challenge" | null,
  pendingDef: null as ModeDef | null,
  pendingMode: null as "journey" | "daily" | "practice" | "challenge" | null,
  pendingRanked: false,
  tutorialIndex: -1,
  selection: [] as Cell[],
  cursor: { r: 0, c: 0 },
  keyboardAnchor: null as { r: number; c: number } | null,
  movesUsed: 0,
  /** Clock time not yet folded into the command log (ms). */
  pendingMs: 0,
  results: null as Results | null,
  lb: null as platform.Posted | "posting" | null,
  lbRows: null as platform.Row[] | null,
  /** Compact layouts: the open drawer. */
  drawer: null as "words" | "status" | null,
  live: null as { msg: Msg; until: number } | null,
  toast: null as { text: string; until: number } | null,
};
let actionCounter = 0;
const now = (): number => frame().time;

// ------------------------------------------------------------------ helpers
/** ui.js announce(): polite text also shows in the live line for 5 s; assertive is for screen readers only. */
export function announce(msg: Msg, assertive = false): void {
  const text = M(msg);
  ui.announce(text.slice(0, 500), { politeness: assertive ? "assertive" : "polite" });
  if (!assertive) app.live = { msg, until: now() + 5 };
}
export function toast(text: string): void {
  app.toast = { text, until: now() + 3.2 };
  ui.announce(text, { politeness: "polite" });
}
/** Timers on the game's clock (the old setTimeout calls). */
const timers: { at: number; fn: () => void }[] = [];
function after(seconds: number, fn: () => void): void { timers.push({ at: now() + seconds, fn }); }

export function show(screen: Screen, focus: string | null = null): void {
  app.screen = screen;
  app.openedFrame = frame().frame;
  app.focusNext = focus;
  app.drawer = null;
  ui.setFocus(null);
}
function setOverlay(o: Overlay, focus: string | null): void {
  app.overlay = o;
  app.openedFrame = frame().frame;
  app.focusNext = focus;
  app.drawer = null;
  ui.setFocus(null);
}
const phase = (): string => app.sess.phase;
export function active(): boolean { return app.screen === "game" && app.overlay === null && phase() === "active"; }

// ------------------------------------------------------------------ round lifecycle
function startRound(def: ModeDef, mode: NonNullable<typeof app.mode>): void {
  app.def = def;
  app.mode = mode;
  app.state = Rules.createState(def);
  app.envelope = Sess.beginEnvelope(def, app.state);
  app.movesUsed = 0;
  app.selection = [];
  app.keyboardAnchor = null;
  app.cursor = { r: 0, c: 0 };
  app.pendingMs = 0;
  app.results = null;
  app.lb = null;
  app.lbRows = null;
  render.buildBoard(app.state, def.theme, def.seed);
  render.setActive(true);
  show("game");
  if (phase() !== "preparing") app.sess.transition("preparing", `start-${mode}`);
  if (def.mechanics.tutorial && !app.settings.tutorialDone) {
    app.tutorialIndex = 0;
    app.sess.transition("tutorial", "lesson-start");
    setOverlay("tutorial", "btn-tutorial-next");
  } else {
    beginCountdown();
  }
}

function beginCountdown(): void {
  if (phase() === "preparing" || phase() === "tutorial") app.sess.transition("countdown", "ready");
  app.sess.transition("active", "countdown-done");
  setOverlay(null, null);
  announce([N("Round starting. Find all {n} words."), { n: app.state!.words.length }]);
  const st = app.state!;
  ui.announce(T(N("Board is {size} by {size} letters. {n} words to find. Use arrow keys to move between cells."), { size: st.size, n: st.words.length }), { politeness: "polite" });
  audio.setAmbience(true);
}

function issueCommand(cmd: Command): ReturnType<typeof Rules.applyCommand> | null {
  if (!app.state) return null;
  cmd.id = cmd.id || `a${++actionCounter}-${Math.floor(Math.random() * 0xffffff).toString(16)}`;
  const res = Rules.applyCommand(app.state, cmd);
  if (!res) return null;
  app.state = res.state;
  Sess.recordCommand(app.envelope, cmd, app.state);
  return res;
}

const REASONS: Record<string, string> = {
  "not-straight": N("That is not a straight line. Words hide in straight lines only."),
  "no-word-match": N("Those letters are not on the word list."),
  "already-found": N("You already found that word."),
  "too-few-cells": N("Select at least two letters."),
  "out-of-bounds": N("Selection went off the board."),
  "not-active": N("The round is not active right now."),
};
function commitSelection(): void {
  if (app.selection.length < 2) { cancelSelection(); return; }
  const cells = app.selection;
  const res = issueCommand({ type: "select", cells })!;
  app.movesUsed++;
  if (res.ok) {
    audio.play("wordFound");
    render.commitWord(cells);
    const word = res.reason.slice(6);
    announce([N("Found {word}! {found} of {total} words."), { word, found: app.state!.foundCount, total: app.state!.words.length }]);
    if (app.state!.status === "complete") finishRound();
  } else {
    audio.play("invalid");
    render.updateSelection(cells, "invalid");
    const key = REASONS[res.reason];
    announce(key ? [key] : [N("Invalid selection: {reason}"), { reason: res.reason }], true);
    after(0.4, () => { if (!app.selection.length) render.updateSelection([], "none"); });
  }
  app.selection = [];
  app.keyboardAnchor = null;
}
function cancelSelection(): void {
  app.selection = [];
  app.keyboardAnchor = null;
  render.updateSelection([], "none");
}

/** Cells along the straight line from a to b if aligned, else just [a]. */
function lineBetween(a: { r: number; c: number }, b: { r: number; c: number }): Cell[] {
  const dr = Math.sign(b.r - a.r), dc = Math.sign(b.c - a.c);
  const len = Math.max(Math.abs(b.r - a.r), Math.abs(b.c - a.c));
  if (len === 0) return [[a.r, a.c]];
  const aligned = a.r === b.r || a.c === b.c || Math.abs(b.r - a.r) === Math.abs(b.c - a.c);
  if (!aligned) return [[a.r, a.c]];
  const cells: Cell[] = [];
  for (let i = 0; i <= len; i++) cells.push([a.r + dr * i, a.c + dc * i]);
  return cells;
}

function finishRound(): void {
  app.sess.transition("resolving", "all-words-found");
  audio.play("complete");
  audio.setAmbience(false);
  const st = app.state!, def = app.def!;
  // Daily streak claim is part of the replayable command log.
  let streakDays = 0;
  if (app.mode === "daily") {
    const s = Sess.recordDailyCompletion(Util.utcDay(platform.nowMs()).slice(0, 10));
    streakDays = s.days;
    issueCommand({ type: "claim-streak", days: streakDays });
  }
  const A = Sess.ACHIEVEMENTS;
  const earned: Achievement[] = [];
  if (Sess.unlockAchievement("first-completion")) earned.push(A["first-completion"]!);
  if (def.mechanics.mastery && app.state!.invalidActions === 0 && Sess.unlockAchievement("mechanic-mastery")) earned.push(A["mechanic-mastery"]!);
  if (streakDays >= 3 && Sess.unlockAchievement("three-day-streak")) earned.push(A["three-day-streak"]!);
  if (app.mode === "practice" && def.id === "practice-hard" && Sess.unlockAchievement("hard-milestone")) earned.push(A["hard-milestone"]!);
  const before = Sess.loadAchievements().totalWords;
  Sess.addWordsFound(st.foundCount);
  if (before < 100 && Sess.loadAchievements().totalWords >= 100) earned.push(A["century-words"]!);
  if (app.mode === "journey") Sess.markJourneyLevelCompleted(def.id);
  const best = Sess.recordBestScore(def.id, app.state!.score.total);

  // Challenge constraints (move limit / time target), re-rendered in the current language.
  let constraint: (() => string) | null = null;
  const ch = def.mechanics.challenge;
  if (ch && (ch.moveLimit || ch.timeTargetMs)) {
    const parts: (() => string)[] = [];
    const used = app.movesUsed, elapsed = app.state!.elapsedMs;
    if (ch.moveLimit) {
      const v = { used, limit: ch.moveLimit };
      const key = used <= ch.moveLimit ? N("met move limit ({used}/{limit})") : N("missed move limit ({used}/{limit})");
      parts.push(() => T(key, v));
    }
    if (ch.timeTargetMs) {
      const v = { s: Math.floor(elapsed / 1000), target: Math.floor(ch.timeTargetMs / 1000) };
      const key = elapsed <= ch.timeTargetMs ? N("beat time target ({s}s/{target}s)") : N("missed time target ({s}s/{target}s)");
      parts.push(() => T(key, v));
    }
    constraint = () => T(N("Challenge: {parts}."), { parts: parts.map((f) => f()).join(", ") });
  }
  if (earned.length) audio.play("achievement");
  app.sess.transition("results", "round-complete");
  platform.flush();
  app.results = { state: app.state!, achievements: earned, best, nextLabel: app.mode === "journey" ? N("Next Level") : N("Play Again"), constraint };
  setOverlay("results", "btn-retry");
  announce([N("Round finished. Total score {score}."), { score: app.state!.score.total }], true);
  // Ranked rounds (Daily, Journey) signed in: post the total to the high-score board, show the rank, then the top 10.
  if ((app.mode === "daily" || app.mode === "journey") && platform.signedIn()) {
    const mine = app.state!;
    app.lb = "posting";
    void platform.postLeaderboard(mine.score.total).then(async (r) => {
      if (app.state !== mine) return;
      app.lb = r;
      const rows = await platform.topScores(10);
      if (app.state === mine && rows.length) app.lbRows = rows;
    });
  }
}
export function leaderboardLine(): string | null {
  const r = app.lb;
  if (!r) return null;
  if (r === "posting") return S("lbPosting");
  return !r.posted ? S("lbNotPosted") : r.rank ? S("lbRank", { rank: r.rank }) : S("lbPosted");
}

export function leaveRound(): void {
  audio.play("uiBack");
  cancelSelection();
  audio.setAmbience(false);
  if (phase() === "paused") app.sess.transition("active", "leave-unpause");
  if (phase() === "active") app.sess.transition("paused", "leave");
  app.sess.transition("mode-select", "left-round");
  goTitle();
}
/** Results' Menu (and leaving): back to the title. */
export function backToTitle(): void {
  if (phase() === "results" || phase() === "progression") app.sess.transition("mode-select", "results-done");
  goTitle();
}
function goTitle(): void {
  app.state = null;
  app.overlay = null;
  app.results = null;
  render.setActive(false);
  show("title", "btn-play");
}

export function pauseGame(): void {
  if (!active()) return;
  flushTick(true);
  app.sess.transition("paused", "user-pause");
  audio.setAmbience(false);
  setOverlay("pause", "btn-resume");
  announce([N("Paused.")]);
}
export function resumeGame(): void {
  if (phase() !== "paused") return;
  app.sess.transition("active", "user-resume");
  audio.setAmbience(true);
  setOverlay(null, null);
  announce([N("Resumed.")]);
}

export function giveHint(): void {
  if (!app.state || !active()) return;
  const legal = Rules.legalActions(app.state); // hints use the same rules API
  if (!legal.length) return;
  const action = legal[Math.floor(Math.random() * legal.length)]!;
  audio.play("hint");
  render.updateSelection(action.cells, "pending");
  announce([N("Hint: the word {word} starts at row {r}, column {c}."), { word: action.word, r: action.cells[0]![0] + 1, c: action.cells[0]![1] + 1 }]);
  after(2.5, () => { if (!app.selection.length) render.updateSelection([], "none"); });
}
export function resetCamera(): void { render.resetCamera(); announce([N("Camera reset.")]); }

// ------------------------------------------------------------------ the clock (folded into the command log in 5 s chunks)
function flushTick(force: boolean): void {
  if (!app.state || app.state.status !== "active") return;
  if (app.pendingMs >= (force ? 100 : 5000)) {
    issueCommand({ type: "tick", ms: Math.round(app.pendingMs) });
    app.pendingMs = 0;
  }
}
export function clockMs(): number { return app.state ? app.state.elapsedMs + app.pendingMs : 0; }

// ------------------------------------------------------------------ menus (src/main.js ui.on handlers)
const RANKED_LABEL = (): Msg => [platform.signedIn() ? N("Yes — posted to the leaderboard") : N("Yes — personal best kept on this device")];
const JOURNEY_DESC: Msg = [N("Find every themed word on the board.")];
const journeyLabel = (lv: Def): Msg => [N("Journey — Level {n}"), { n: Content.JOURNEY.indexOf(lv) + 1 }];
function setup(def: ModeDef, mode: NonNullable<typeof app.mode>, ranked: boolean): void {
  app.pendingDef = def;
  app.pendingMode = mode;
  app.pendingRanked = ranked;
  if (phase() === "title") app.sess.transition("mode-select", `choose-${mode}`);
  show("mode", "btn-mode-start");
}
export function rankedLabel(): Msg | null { return app.pendingRanked ? RANKED_LABEL() : null; }
export function play(): void {
  // Short path to play: resume the Journey at the next unlocked level.
  const progress = Sess.loadJourneyProgress();
  const idx = Content.JOURNEY.findIndex((lv) => !progress.completed.includes(lv.id));
  const lv = Content.JOURNEY[idx === -1 ? Content.JOURNEY.length - 1 : idx]!;
  setup({ ...lv, label: journeyLabel(lv), desc: JOURNEY_DESC }, "journey", true);
}
export function daily(): void {
  const day = Util.utcDay(platform.nowMs()).slice(0, 10);
  const def = Content.dailyDefinition(day);
  setup({ ...def, label: [N("Daily Challenge — {day}"), { day }], desc: [N("One shared board for everyone today. Ranked.")] }, "daily", true);
}
export function openJourney(): void {
  if (phase() === "title") app.sess.transition("mode-select", "choose-journey");
  show("journey", "level-1");
}
export function pickLevel(lv: Def): void { setup({ ...lv, label: journeyLabel(lv), desc: JOURNEY_DESC }, "journey", true); }
export function openPractice(): void {
  if (phase() === "title") app.sess.transition("mode-select", "choose-practice");
  show("practice", "btn-practice-easy");
}
export function pickPractice(diff: string): void {
  const def = Content.practiceDefinition(diff, Math.floor(Math.random() * 0x7fffffff));
  setup({ ...def, label: [N("Practice — {difficulty}"), { difficulty: () => T(Content.PRACTICE[diff]!.label) }], desc: [N("Unranked practice board.")] }, "practice", false);
}
export function openChallenges(): void {
  if (phase() === "title") app.sess.transition("mode-select", "choose-challenge");
  show("challenge", "btn-challenge-0");
}
export function pickChallenge(id: string): void {
  const c = Content.CHALLENGES.find((x) => x.id === id)!;
  const def = Content.challengeDefinition(id);
  setup({ ...def, label: [N("Challenge — {name}"), { name: () => T(c.label) }], desc: [N("Beat the constraint to master this board.")] }, "challenge", false);
}
export function modeStart(): void { if (app.pendingDef && app.pendingMode) startRound(app.pendingDef, app.pendingMode); }
/** The setup screens' Back: the title (the old back-title handler). */
export function menuBack(): void {
  audio.play("uiBack");
  show("title", "btn-play");
}
export function openPage(page: "help" | "settings"): void {
  app.under = app.screen === "game" ? "pause" : "title";
  show(page, page === "help" ? "btn-help-close" : "btn-settings-close");
}
export function closePage(): void {
  audio.play("uiBack");
  if (app.under === "pause" && app.state) { show("game"); setOverlay("pause", "btn-resume"); return; }
  show("title", "btn-play");
}
export function replayTutorial(): void {
  app.settings.tutorialDone = false;
  Sess.saveSettings(app.settings);
  closePage();
  announce([N("Tutorial will play at the start of your next Journey level 1.")]);
}
export function retry(): void {
  app.sess.transition("preparing", "retry");
  startRound(app.def!, app.mode!);
}
export function next(): void {
  if (app.mode === "journey") {
    const idx = Content.JOURNEY.findIndex((l) => l.id === app.def!.id);
    const lv = Content.JOURNEY[Math.min(idx + 1, Content.JOURNEY.length - 1)]!;
    app.sess.transition("preparing", "next-level");
    startRound({ ...lv, label: journeyLabel(lv), desc: JOURNEY_DESC }, "journey");
  } else {
    app.sess.transition("preparing", "play-again");
    let def = app.def!;
    if (app.mode === "practice") {
      const diff = def.id.replace("practice-", "");
      def = { ...Content.practiceDefinition(diff, Math.floor(Math.random() * 0x7fffffff)), label: def.label, desc: def.desc };
    }
    startRound(def, app.mode!);
  }
}
export function tutorialNext(): void {
  app.tutorialIndex++;
  if (app.tutorialIndex < Content.LESSONS.length) { app.openedFrame = frame().frame; return; }
  app.settings.tutorialDone = true;
  Sess.saveSettings(app.settings);
  beginCountdown();
}
export function tutorialSkip(): void {
  app.settings.tutorialDone = true;
  Sess.saveSettings(app.settings);
  beginCountdown();
}
export function copyInvite(): void {
  const link = platform.inviteLink();
  if (!link) return;
  try { clipboard.writeText(link); toast(S("copied")); } catch { toast(S("copyFailed")); }
}
export function signIn(): void { void requestSignIn().catch(() => undefined); }

// ------------------------------------------------------------------ input: the cursor keys
function moveCursor(dr: number, dc: number): void {
  const st = app.state!;
  app.cursor.r = Math.min(st.size - 1, Math.max(0, app.cursor.r + dr));
  app.cursor.c = Math.min(st.size - 1, Math.max(0, app.cursor.c + dc));
  if (app.keyboardAnchor) {
    app.selection = lineBetween(app.keyboardAnchor, app.cursor);
    render.updateSelection(app.selection, "pending");
  } else {
    render.updateSelection([[app.cursor.r, app.cursor.c]], "pending");
  }
  audio.play("uiMove");
  announce([N("Cell {letter}, row {r}, column {c}."), { letter: st.grid[app.cursor.r]![app.cursor.c]!, r: app.cursor.r + 1, c: app.cursor.c + 1 }]);
}
const MOVES: Record<string, [number, number]> = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
onAction((e) => {
  if (!e.pressed) return;
  const fresh = frame().frame !== app.openedFrame;
  if (ui.capturingKeys()) return;
  if (app.screen === "help" || app.screen === "settings") {
    if (e.action === "back" && fresh) closePage();
    return;
  }
  if (app.screen !== "game") return;
  if (e.action === "back") {
    if (!fresh) return;
    if (active() && (app.selection.length || app.keyboardAnchor)) { cancelSelection(); announce([N("Selection cancelled.")]); }
    else if (active()) pauseGame();
    else if (app.overlay === "pause") resumeGame();
    return;
  }
  if (!active()) return;
  // Board keys must not also walk or activate the UI focus over the rails.
  if (ui.focused() && (MOVES[e.action] || e.action === "select")) return;
  const move = MOVES[e.action];
  if (move) { moveCursor(move[0], move[1]); return; }
  if (e.action === "select") {
    if (!app.keyboardAnchor) {
      app.keyboardAnchor = { ...app.cursor };
      app.selection = [[app.cursor.r, app.cursor.c]];
      render.updateSelection(app.selection, "pending");
      audio.play("select");
      announce([N("Line start set. Move to the end and press Enter to confirm.")]);
    } else commitSelection();
    return;
  }
  if (e.action === "hint") { giveHint(); return; }
  if (e.action === "camera") resetCamera();
});

// ------------------------------------------------------------------ input: pointer and touch drags on the board
/** Rectangles (window pixels) where a press belongs to the UI, set by screens.ts each frame. */
export const hudRects: { x: number; y: number; width: number; height: number }[] = [];
const onHud = (x: number, y: number): boolean => hudRects.some((r) => x >= r.x && y >= r.y && x <= r.x + r.width && y <= r.y + r.height);
type PEvent = { kind: "down" | "move" | "up" | "cancel"; x: number; y: number; id: number };
const events: PEvent[] = [];
let lastTouch = -1e9;
let drag: { id: number; x: number; y: number; t: number; origin: { r: number; c: number } } | null = null;
onTouch((e) => {
  lastTouch = now();
  if (e.control) return;
  const kind = e.phase === "start" ? "down" : e.phase === "move" ? "move" : e.phase === "end" ? "up" : "cancel";
  events.push({ kind, x: e.x, y: e.y, id: e.id });
});
onPointerButton((e) => {
  if (e.button !== 0 || now() - lastTouch < 0.6) return;
  events.push({ kind: e.pressed ? "down" : "up", x: e.x, y: e.y, id: -1 });
});
onPointerMove((x, y) => { if (drag && drag.id === -1 && now() - lastTouch >= 0.6) events.push({ kind: "move", x, y, id: -1 }); });
/** main.js pointerdown/move/up: decided once the frame's UI is built (presses on the rails, tray or menus are theirs). */
function pointerInput(): void {
  for (const ev of events.splice(0)) {
    if (ev.kind === "down") {
      if (drag || !active() || onHud(ev.x, ev.y)) continue;
      const cell = render.screenToCell(ev.x, ev.y);
      if (!cell) continue;
      ui.setFocus(null);
      drag = { id: ev.id, x: ev.x, y: ev.y, t: now(), origin: cell };
      app.keyboardAnchor = null;
      app.selection = [[cell.r, cell.c]];
      render.updateSelection(app.selection, "pending");
      audio.play("tick");
      continue;
    }
    if (!drag || ev.id !== drag.id) continue;
    if (ev.kind === "move") {
      const cell = render.screenToCell(ev.x, ev.y);
      if (!cell || !active()) continue;
      app.selection = lineBetween(drag.origin, cell);
      render.updateSelection(app.selection, "pending");
      continue;
    }
    const d = drag;
    drag = null;
    const tapDist = 12 * frame().scale;
    const wasTap = Math.hypot(ev.x - d.x, ev.y - d.y) < tapDist && now() - d.t < 0.35;
    if (!active()) { cancelSelection(); continue; }
    if (ev.kind === "cancel") { cancelSelection(); announce([N("Selection cancelled.")]); continue; }
    if (wasTap && app.selection.length === 1) { cancelSelection(); continue; }
    commitSelection();
  }
}

// ------------------------------------------------------------------ boot and lifecycle
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const k = `${f.quality}:${f.levelIndex}`;
  if (k === lookKey) return;
  lookKey = k;
  render.applyLook(lookFor(f.quality, f.levelIndex));
}

onStart(() => {
  setFixedRate(60);
  initStyles();
  platform.initPlatform();
  app.sess = Sess.createSession();
  app.settings = Sess.loadSettings();
  Sess.guestProfile();
  audio.loadSfx();
  render.setReducedMotion(preferences().reducedMotion);
  applyLook();
  render.setActive(false);
  app.sess.transition("title", "boot-done");
  show("title", "btn-play");
});
onPreferencesChange((p) => render.setReducedMotion(p.reducedMotion));
onSessionEnded(() => toast(S("signedOut"))); // keep playing locally
// A merge from another device or the old build rewrote the document: pick up its settings.
platform.onMerged(() => { app.settings = Sess.loadSettings(); });
let hidden = false;
onSuspend(() => {
  hidden = true;
  pauseGame(); // backgrounding pauses solo play
  platform.flush();
});
onResume(() => { hidden = false; });

onFixedUpdate(() => {
  if (hidden || !active()) return;
  app.pendingMs += 1000 / 60;
  flushTick(false);
});

let frameDt = 0;
onUpdate((dt) => {
  frameDt = dt;
  applyLook();
  applyContrast(ui.preferences().highContrast);
  audio.update();
  const t = now();
  for (let i = timers.length - 1; i >= 0; i--) if (timers[i]!.at <= t) { const fn = timers[i]!.fn; timers.splice(i, 1); fn(); }
  if (app.live && app.live.until < t) app.live = null;
  if (app.toast && app.toast.until < t) app.toast = null;
  platform.flushDirty();
});
/** The share of the window's height the board may use (screens.ts: the compact tray takes the rest). */
export const view = { free: 1 };
onRender(() => {
  hudRects.length = 0;
  drawScreens();
  pointerInput();
  const f = frame();
  render.update(frameDt, f.width, f.height, view.free);
});
