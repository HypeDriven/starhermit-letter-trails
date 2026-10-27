// The browser build's semantic HTML shell (index.html + src/ui.js) as
// starhermit:ui, built every frame over the board: the title over the key
// art (Play, Daily Challenge, Journey, Practice, Challenge, How to Play,
// Settings, Sign in / Invite, the player line), the mode setup (label,
// description, the board's facts, Start / Back), the Journey grid (40 levels,
// mastery stars, done and locked), Practice, Challenge, the pause menu,
// Settings (the runtime's Options and key bindings, Replay Tutorial), How to
// Play (the four rule cards with the effective keys, and pads and touch),
// the tutorial lessons, the results (score breakdown, time, invalid
// selections, best, the challenge constraint, achievements, the leaderboard
// line and top ten, Retry / Next / Menu), the HUD and the account toast.
// The old media queries are layouts picked by the window's logical size:
// wide (≥ 1024 px: the objective and word list rail on the left, the status
// rail with Pause / Hint / Reset Camera on the right) and compact (the
// Words / Hint / Pause / Status tray at the bottom, the rails as drawers
// over the board, the announcement line above the tray).
import { frame, openMenu } from "starhermit:engine";
import { bindings, requestRebind } from "starhermit:input";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { Content, Sess, Util, type Def } from "./game.ts";
import { M, N, S, T } from "./i18n.ts";
import * as audio from "./audio.ts";
import * as platform from "./platform.ts";
import {
  app, backToTitle, clockMs, closePage, copyInvite, daily, giveHint, hudRects, leaderboardLine, leaveRound, menuBack, modeStart, next,
  openChallenges, openJourney, openPage, openPractice, pauseGame, pickChallenge, pickLevel, pickPractice, play, rankedLabel, replayTutorial,
  resetCamera, resumeGame, retry, signIn, tutorialNext, tutorialSkip, view,
} from "./main.ts";

// ------------------------------------------------------------------ layout
interface Layout { lw: number; lh: number; sc: number; wide: boolean; short: boolean }
function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const sa = f.safeArea;
  const lw = Math.max(1, (f.width - sa.left - sa.right) / sc), lh = Math.max(1, (f.height - sa.top - sa.bottom) / sc);
  return { lw, lh, sc, wide: lw >= 1024, short: lh <= 500 };
}
const lastSize = new Map<string, number>();
function textWidth(text: string, style: string, kind?: "button" | "heading"): number {
  return ui.measureText(text, { ...(kind ? { kind } : {}), style: [style] }).width / ui.preferences().scale;
}
const fresh = (): boolean => frame().frame !== app.openedFrame;
interface Btn { id: string; text: string; style?: string; act: () => void; disabled?: boolean }
const buttonWidth = (text: string, style: string): number => textWidth(text, style, "button") + 4;
/** A button `width` wide (null: its text's); a label too long for it wraps inside. */
function button(b: Btn, width: number | null = null): void {
  const style = b.style ?? "btn";
  const opts: ui.ButtonOptions = {};
  if (b.disabled) opts.disabled = true;
  const s: ui.Style = width != null ? { width } : {};
  if (width != null && buttonWidth(b.text, style) > width) {
    const inner = Math.max(20, width - 40);
    opts.content = () => { ui.style({ text: { align: "center" } }).paragraph(b.text, inner); };
  }
  if (ui.style(style, s).id(b.id).button(b.text, opts) && fresh()) b.act();
}
/** index.html .row with flex-direction column / align stretch: one full-width button a line. */
function stack(label: string, list: Btn[], width: number): void {
  ui.column(label, () => { for (const b of list) button(b, width); }, { spacing: 10, width });
}
/** index.html .row: buttons at their own widths in rows that wrap at `width` (gap 10). */
function flow(label: string, list: Btn[], width: number, gap = 10): void {
  const rows: Btn[][] = [[]];
  let used = 0;
  for (const b of list) {
    const bw = Math.min(width, buttonWidth(b.text, b.style ?? "btn"));
    if (rows[rows.length - 1]!.length && used + gap + bw > width) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1]!.length ? gap : 0) + bw;
    rows[rows.length - 1]!.push(b);
  }
  ui.column(label, () => {
    rows.forEach((row, ri) => ui.row(`${label}-r${ri}`, () => {
      for (const b of row) button(b, buttonWidth(b.text, b.style ?? "btn") > width ? width : null);
    }, { spacing: gap }));
  }, { spacing: gap, width });
}
/** Text up to `width` wide: one label when it fits, else a paragraph. */
function para(text: string, width: number, cls = "body", id?: string): void {
  if (!text) return;
  let u = ui.style(cls);
  if (id) u = u.id(id);
  if (textWidth(text, cls) <= width) u.label(text);
  else u.paragraph(text, width);
}
function heading(cls: string, text: string, width: number, id?: string): void {
  if (textWidth(text, cls, "heading") <= width) (id ? ui.id(id) : ui).style(cls).heading(text);
  else ui.style(cls).paragraph(text, width);
}
function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${Util.twoDigit(s % 60)}`;
}
// Word-bank keys (content.js) → display names; the words themselves are English data.
const BANK_NAMES: Record<string, string> = { ocean: N("Ocean"), forest: N("Forest"), kitchen: N("Kitchen"), space: N("Space"), music: N("Music"), garden: N("Garden") };
const themeName = (key: string): string => (BANK_NAMES[key] ? T(BANK_NAMES[key]!) : key || "");

// ------------------------------------------------------------------ the frame
let blurFrames = 0;
/** After a HUD button: the board keeps the arrows and Enter (the focus is let go now and on the next frames). */
function blur(): void { ui.setFocus(null); blurFrames = 2; }
export function drawScreens(): void {
  const L = layoutNow();
  const f = frame();
  if (blurFrames > 0) { blurFrames--; ui.setFocus(null); }
  view.free = 1;
  if (app.screen === "game") gameScreen(L);
  else if (app.screen === "title") { backdrop("title-art"); page("title", L, titleScreen); }
  else {
    backdrop("wash");
    switch (app.screen) {
      case "mode": page("mode", L, modeScreen); break;
      case "journey": page("journey", L, journeyScreen); break;
      case "practice": page("practice", L, practiceScreen); break;
      case "challenge": page("challenge", L, challengeScreen); break;
      case "help": page("help", L, helpScreen); break;
      case "settings": page("settings", L, settingsScreen); break;
    }
  }
  toast(L);
  if (app.focusNext) {
    const age = f.frame - app.openedFrame;
    if (age >= 1) ui.setFocus(app.focusNext);
    if (age >= 3) app.focusNext = null;
  }
}

/** A full-window box in a class (the .screen wash, the title's key art): a placed widget, so it covers the rails built before it. */
function backdrop(cls: string): void {
  const f = frame(), sc = ui.preferences().scale;
  ui.place(`backdrop-${cls}`, { anchor: "top-start", x: -f.safeArea.left / sc, y: -f.safeArea.top / sc }, () => {
    ui.widget("", { role: "none", size: { width: f.width / sc, height: f.height / sc }, draw: () => draw.box(0, 0, f.width, f.height, cls) });
  });
}
/** A panel (index.html .panel): centred, at most 560 px wide, scrolling inside when taller than the window. */
function page(key: string, L: Layout, build: (w: number, L: Layout) => void, width = 560): void {
  const pad = L.lw < 420 ? 16 : 24;
  const outer = Math.min(width, L.lw * 0.92);
  const avail = Math.max(80, L.lh * 0.85);
  const h = lastSize.get(key) ?? 0;
  const scroll = h > avail;
  const inner = outer - 2 * pad - 6 - (scroll ? 14 : 0);
  const opening = frame().frame - app.openedFrame <= 5;
  ui.place(`page-${key}`, "center", () => {
    const body = (): void => {
      const r = ui.column(`${key}-col`, () => build(inner, L), { style: "panel", width: outer - (scroll ? 14 : 0), spacing: 14, padding: pad });
      lastSize.set(key, r.height / L.sc);
    };
    if (scroll) ui.scrollArea(`${key}-scroll`, { width: outer, height: avail }, body, opening ? { scrollTo: { top: 0 } } : undefined);
    else body();
  });
}

// ------------------------------------------------------------------ title and menus
const SYNC_LABELS: Record<string, string> = { synced: N("cloud synced"), saving: N("saving..."), error: N("sync error"), offline: N("offline") };
function profileLine(): string {
  const name = platform.displayName();
  if (platform.signedIn() && name) return `${S("playingAs", { name })} · ${T(SYNC_LABELS[platform.syncState()]!)}`;
  const g = Sess.guestProfile();
  const guest = g.name === "Guest" ? T("Guest") : g.name;
  return platform.signedIn() ? T("Playing as {name}", { name: guest }) : T("Playing as {name} (local guest)", { name: guest });
}
function titleScreen(w: number): void {
  ui.column("title-head", () => {
    heading("title", "Letter Trails", w, "title-h");
    para(T("Trace straight lines through the letter grid to find the themed words."), w, "muted-center", "tagline");
  }, { spacing: 10, width: w, align: "center" });
  const list: Btn[] = [
    { id: "btn-play", text: T("Play"), style: "btn-primary", act: play },
    { id: "btn-daily", text: T("Daily Challenge"), act: daily },
    { id: "btn-journey", text: T("Journey"), act: openJourney },
    { id: "btn-practice", text: T("Practice"), act: openPractice },
    { id: "btn-challenge", text: T("Challenge"), act: openChallenges },
    { id: "btn-help", text: T("How to Play"), act: () => openPage("help") },
    { id: "btn-settings", text: T("Settings"), act: () => openPage("settings") },
  ];
  if (!platform.signedIn()) list.push({ id: "btn-signin", text: S("signIn"), act: signIn });
  if (platform.inviteLink()) list.push({ id: "btn-invite", text: S("invite"), act: copyInvite });
  stack("title-menu", list, w);
  ui.column("title-foot", () => para(profileLine(), w, "muted-center", "profile-line"), { width: w, align: "center" });
}

function modeScreen(w: number): void {
  const def = app.pendingDef;
  if (!def) return;
  heading("h2", M(def.label), w, "mode-h");
  para(M(def.desc), w, "body", "mode-desc");
  const facts: [string, string][] = [
    [N("Board"), `${def.size} × ${def.size}`],
    [N("Words"), String(def.wordCount)],
    [N("Theme"), themeName(def.theme)],
    [N("Par"), T("{moves} moves, {time}", { moves: def.par.moves, time: fmtTime(def.par.timeMs) })],
    [N("Expected duration"), T("{n} min", { n: Math.max(1, Math.round(def.par.timeMs / 60000)) })],
    [N("Players"), "1"],
    [N("Ranked"), app.pendingRanked ? M(rankedLabel()!) : T("No")],
  ];
  const ch = def.mechanics.challenge;
  if (ch && ch.moveLimit) facts.push([N("Move limit"), String(ch.moveLimit)]);
  if (ch && ch.timeTargetMs) facts.push([N("Time target"), fmtTime(ch.timeTargetMs)]);
  // index.html <dl>: each term, its value indented under it.
  ui.column("mode-facts", () => {
    facts.forEach(([k, v], i) => {
      para(T(k), w, "dt", `fact-${i}`);
      ui.row(`fact-${i}-v`, () => { ui.widget("", { role: "none", size: { width: 40, height: 1 } }); para(v, w - 40, "dd"); }, { spacing: 0 });
    });
  }, { spacing: 0, width: w });
  flow("mode-btns", [
    { id: "btn-mode-start", text: T("Start"), style: "btn-primary", act: modeStart },
    { id: "btn-mode-back", text: T("Back"), act: menuBack },
  ], w);
}

function journeyScreen(w: number): void {
  heading("h2", T("Journey"), w, "journey-h");
  para(T("Complete each stage to unlock the next. Mastery stages every 8th level."), w, "muted", "journey-note");
  const levels = Content.JOURNEY;
  const done = Sess.loadJourneyProgress().completed;
  // index.html .journey-grid: auto-fill columns of at least 52 px, gap 8.
  const cols = Math.max(1, Math.floor((w + 8) / 60));
  const bw = (w - (cols - 1) * 8) / cols;
  ui.column("journey-grid", () => {
    for (let r = 0; r * cols < levels.length; r++) {
      ui.row(`jg-${r}`, () => {
        for (let i = r * cols; i < Math.min(levels.length, (r + 1) * cols); i++) {
          const lv = levels[i]!, n = i + 1;
          const isDone = done.includes(lv.id);
          const unlocked = i === 0 || done.includes(levels[i - 1]!.id) || isDone;
          const key = lv.mechanics.mastery
            ? (isDone ? N("Level {n} (mastery), completed") : unlocked ? N("Level {n} (mastery)") : N("Level {n} (mastery), locked"))
            : (isDone ? N("Level {n}, completed") : unlocked ? N("Level {n}") : N("Level {n}, locked"));
          const face = `${lv.mechanics.mastery ? "★" : ""}${n}`;
          const pressed = ui.style(isDone ? "btn-done" : "btn-level", { width: bw }).id(`level-${n}`)
            .button(T(key, { n }), { disabled: !unlocked, content: () => ui.label(face) });
          if (pressed && unlocked && fresh()) pickLevel(lv as Def);
        }
      }, { spacing: 8 });
    }
  }, { spacing: 8, width: w });
  flow("journey-nav", [{ id: "btn-journey-back", text: T("Back"), act: menuBack }], w);
}

function practiceScreen(w: number): void {
  heading("h2", T("Practice"), w, "practice-h");
  para(T("Unranked. Restart freely; no effect on competitive rating."), w, "muted", "practice-note");
  stack("practice-list", [
    { id: "btn-practice-easy", text: T("Easy — 6×6, 5 words"), act: () => pickPractice("easy") },
    { id: "btn-practice-medium", text: T("Medium — 7×7, 7 words"), act: () => pickPractice("medium") },
    { id: "btn-practice-hard", text: T("Hard — 9×9, 10 words"), act: () => pickPractice("hard") },
  ], w);
  flow("practice-nav", [{ id: "btn-practice-back", text: T("Back"), act: menuBack }], w);
}

function challengeScreen(w: number): void {
  heading("h2", T("Challenge"), w, "challenge-h");
  para(T("Constrained goals: move limits and speed targets."), w, "muted", "challenge-note");
  stack("challenge-list", Content.CHALLENGES.map((c, i) => {
    const parts: string[] = [];
    if (c.mechanics.challenge.moveLimit) parts.push(T("move limit {n}", { n: c.mechanics.challenge.moveLimit }));
    if (c.mechanics.challenge.timeTargetMs) parts.push(T("target {time}", { time: fmtTime(c.mechanics.challenge.timeTargetMs) }));
    return { id: `btn-challenge-${i}`, text: `${T(c.label)} — ${parts.join(", ")}`, act: () => pickChallenge(c.id) };
  }), w);
  flow("challenge-nav", [{ id: "btn-challenge-back", text: T("Back"), act: menuBack }], w);
}

// ------------------------------------------------------------------ how to play, settings
const KEY_GLYPHS: Record<string, string> = { "Arrow Up": "↑", "Arrow Down": "↓", "Arrow Left": "←", "Arrow Right": "→", Escape: "Esc" };
/** The effective keys of an action, e.g. "Enter/Space" (main.js keyLabel). */
function keysFor(action: string): string {
  let list: string[] = [];
  try { list = bindings(action).filter((b) => b.device === "keyboard").map((b) => KEY_GLYPHS[b.label] ?? b.label); } catch { /* not yet */ }
  return [...new Set(list)].join("/") || "—";
}
const RULES = [
  N("<strong>Trace words.</strong> Drag (or use arrow keys + Enter) across a straight line of letters — horizontal, vertical, or diagonal — to spell a word from the list."),
  N("<strong>Both directions.</strong> Words may read forwards or backwards along the line."),
  N("<strong>Clean streaks.</strong> Invalid selections reset your clean bonus. Each word scores 20 points per letter, plus clean, speed, and daily-streak bonuses."),
  N("<strong>Keyboard.</strong> <kbd data-key=\"up\">↑</kbd> <kbd data-key=\"down\">↓</kbd> <kbd data-key=\"left\">←</kbd> <kbd data-key=\"right\">→</kbd> move the cursor, <kbd data-key=\"select\">Enter/Space</kbd> starts or confirms a line, <kbd data-key=\"back\">Esc</kbd> cancels or pauses, <kbd data-key=\"hint\">H</kbd> gives a hint, <kbd data-key=\"camera\">C</kbd> resets the camera."),
  N("<strong>Gamepad and touch.</strong> The D-pad or left stick moves the cursor, A starts or confirms a line, B cancels or pauses, Y gives a hint, X resets the camera. On a touch screen, drag a finger along the letters."),
];
/** A rule card's translated markup: the <strong> lead-in and the text, <kbd> keys as the effective bindings. */
function ruleCard(html: string): { lead: string; text: string } {
  const m = /^<strong>([\s\S]*?)<\/strong>\s*([\s\S]*)$/.exec(html);
  const rest = (m ? m[2]! : html).replace(/<kbd data-key="(\w+)">[\s\S]*?<\/kbd>/g, (_, a: string) => keysFor(a)).replace(/<[^>]+>/g, "");
  return { lead: m ? m[1]! : "", text: rest };
}
function helpScreen(w: number): void {
  heading("h2", T("How to Play"), w, "help-h");
  RULES.forEach((key, i) => {
    const { lead, text } = ruleCard(T(key));
    ui.column(`rule-${i}`, () => {
      para(lead, w - 28, "strong");
      para(text, w - 28, "body");
    }, { style: "rule-card", width: w, spacing: 2 });
  });
  flow("help-nav", [{ id: "btn-help-close", text: T("Close"), style: "btn-primary", act: closePage }], w);
}
function settingsScreen(w: number): void {
  heading("h2", T("Settings"), w, "settings-h");
  para(T("Sound, graphics, language, larger text, high contrast and reduced motion are in the StarHermit Options."), w, "body", "options-note");
  stack("settings-btns", [
    { id: "btn-options", text: T("Open Options"), act: () => openMenu() },
    { id: "btn-rebind", text: T("Key bindings"), act: () => requestRebind() },
  ], w);
  flow("settings-nav", [
    { id: "btn-replay-tutorial", text: T("Replay Tutorial"), act: replayTutorial },
    { id: "btn-settings-close", text: T("Done"), style: "btn-primary", act: closePage },
  ], w);
}

// ------------------------------------------------------------------ the round
function gameScreen(L: Layout): void {
  const st = app.state;
  if (!st) return;
  if (app.overlay === "tutorial") {
    backdrop("wash-light");
    page("tutorial", L, tutorialPanel);
    return;
  }
  if (app.overlay === "results") { backdrop("wash"); page("results", L, resultsPanel); return; }
  hud(L, app.overlay === null);
  if (app.overlay === "pause") { backdrop("wash"); page("pause", L, pausePanel); }
}

function rect(r: { x: number; y: number; width: number; height: number }): void { hudRects.push({ x: r.x, y: r.y, width: r.width, height: r.height }); }
/** The objective, progress and word list (the left rail / Words drawer). */
function wordsRail(w: number): void {
  const st = app.state!, def = app.def!;
  heading("rail-h", def.theme ? T("Find {n} words — {theme}", { n: st.words.length, theme: themeName(def.theme) }) : T("Find {n} words", { n: st.words.length }), w, "objective");
  para(T("{found} of {total}", { found: st.foundCount, total: st.words.length }), w, "muted", "progress-text");
  ui.column("word-list", () => st.words.forEach((wd, i) => {
    ui.row(`word-${i}`, () => {
      const text = wd.found ? `${wd.word} ✓` : wd.word;
      const r = ui.style(wd.found ? "word-found" : "word").id(`word-${i}-t`).label(text);
      // li.found: line-through.
      if (wd.found) {
        const sc = ui.preferences().scale;
        const ww = textWidth(wd.word, "word-found") * sc;
        ui.widget("", { role: "none", size: { width: 0, height: 0 }, draw: (_r, ws) => draw.line(r.x, r.y + r.height * 0.55, r.x + ww, r.y + r.height * 0.55, ws.highContrast ? "#000000" : "#2b2b2f8c", 1.5 * sc) });
      }
    }, { spacing: 0, padding: { top: 6, bottom: 6, start: 8, end: 8 } });
  }), { spacing: 0, width: w });
}
/** Score, time, the challenge limits and the round's buttons (the right rail / Status drawer). */
function statusRail(w: number, live: boolean): void {
  const st = app.state!;
  heading("rail-h", T("Status"), w, "status-h");
  para(`${T("Score:")} ${st.score.total}`, w, "stat", "hud-score");
  para(`${T("Time:")} ${fmtTime(clockMs())}`, w, "stat", "hud-time");
  const ch = app.def!.mechanics.challenge;
  if (ch) {
    const parts: string[] = [];
    if (ch.moveLimit) parts.push(T("Move limit: {limit} (used {used})", { limit: ch.moveLimit, used: app.movesUsed }));
    if (ch.timeTargetMs) parts.push(T("Time target: {time}", { time: fmtTime(ch.timeTargetMs) }));
    if (parts.length) para(`${parts.join(". ")}.`, w, "stat-muted", "hud-limit");
  }
  if (!live) return;
  const act = (fn: () => void) => () => { blur(); app.drawer = null; fn(); };
  stack("rail-btns", [
    { id: "btn-pause", text: T("Pause"), act: act(pauseGame) },
    { id: "btn-hint", text: T("Hint (H)"), act: act(giveHint) },
    { id: "btn-camera", text: T("Reset Camera (C)"), act: act(resetCamera) },
  ], w);
}
function hud(L: Layout, live: boolean): void {
  const f = frame();
  const sa = f.safeArea;
  if (L.wide) {
    const h = L.lh - 20;
    const railW = 220;
    for (const [side, build] of [["left", wordsRail], ["right", statusRail]] as const) {
      const key = `rail-${side}`;
      const inner = railW - 28;
      const scroll = (lastSize.get(key) ?? 0) > h;
      ui.place(key, { anchor: side === "left" ? "top-start" : "top-end", x: 10, y: 10 }, () => {
        const r = ui.column(key, () => {
          const body = (): void => {
            const c = ui.column(`${key}-in`, () => build(inner - (scroll ? 14 : 0), live), { spacing: 8, width: inner - (scroll ? 0 : 0) });
            lastSize.set(key, c.height / L.sc + 28);
          };
          if (scroll) ui.scrollArea(`${key}-scroll`, { width: inner, height: h - 28 }, body);
          else body();
        }, { style: "rail", width: railW, height: h, spacing: 0 });
        rect(r);
      });
    }
    liveLine(L, false, 0);
    return;
  }
  // Compact: the bottom tray, the drawers and the announcement line above the tray.
  const trayH = 64;
  const trayPx = trayH * L.sc + sa.bottom;
  view.free = 1 - Math.min(0.3, trayPx / Math.max(1, f.height));
  if (app.drawer) drawer(L, trayPx, live);
  draw.box(0, f.height - trayPx, f.width, trayPx, "tray");
  rect({ x: 0, y: f.height - trayPx, width: f.width, height: trayPx });
  const gap = 8;
  const bw = Math.min(140, (L.lw - 16 - 3 * gap) / 4);
  const toggle = (d: "words" | "status") => () => { blur(); app.drawer = app.drawer === d ? null : d; };
  const btns: Btn[] = [
    { id: "tray-words", text: T("Words"), act: toggle("words") },
    { id: "tray-hint", text: T("Hint"), act: () => { blur(); app.drawer = null; giveHint(); } },
    { id: "tray-pause", text: T("Pause"), act: () => { blur(); pauseGame(); } },
    { id: "tray-status", text: T("Status"), act: toggle("status") },
  ];
  if (live) {
    ui.place("tray", { anchor: "bottom", y: 8 }, () => ui.row("tray-row", () => {
      for (const b of btns) button(b, bw);
    }, { spacing: gap }));
  }
  liveLine(L, true, trayPx);
}
/** index.html compact .rail: a drawer over the board, above the tray, with a close button; the scrim closes it. */
function drawer(L: Layout, trayPx: number, live: boolean): void {
  const f = frame();
  const left = app.drawer === "words";
  const w = Math.min(L.lw * 0.8, 320);
  const h = (f.height - trayPx) / L.sc;
  // The scrim: a tap outside the drawer closes it.
  draw.box(0, 0, f.width, f.height - trayPx, "scrim");
  ui.place("scrim", { anchor: "top-start", x: -f.safeArea.left / L.sc, y: -f.safeArea.top / L.sc }, () => {
    if (ui.widget(left ? T("Close word list") : T("Close status"), { role: "button", size: { width: f.width / L.sc, height: h } }).activated && fresh()) app.drawer = null;
  });
  rect({ x: 0, y: 0, width: f.width, height: f.height - trayPx });
  const key = `drawer-${app.drawer}`;
  const inner = w - 28;
  const avail = h - f.safeArea.top / L.sc;
  const scroll = (lastSize.get(key) ?? 0) > avail;
  ui.place(key, { anchor: left ? "top-start" : "top-end", x: 0, y: 0 }, () => {
    ui.column(key, () => {
      const body = (): void => {
        const c = ui.column(`${key}-in`, () => {
          ui.row(`${key}-head`, () => {
            ui.spacer();
            if (ui.style("btn").id(`${key}-close`).button(left ? T("Close word list") : T("Close status"), { content: () => ui.label("✕") }) && fresh()) app.drawer = null;
          }, { width: inner - (scroll ? 14 : 0) });
          if (left) wordsRail(inner - (scroll ? 14 : 0));
          else statusRail(inner - (scroll ? 14 : 0), live);
        }, { spacing: 8, width: inner - (scroll ? 14 : 0) });
        lastSize.set(key, c.height / L.sc + 28);
      };
      if (scroll) ui.scrollArea(`${key}-scroll`, { width: inner, height: avail - 28 }, body);
      else body();
    }, { style: "drawer", width: w, height: avail, spacing: 0 });
  });
}
/** index.html #live: the polite announcement, 5 s at the bottom (compact: in a dark box above the tray). */
function liveLine(L: Layout, compact: boolean, trayPx: number): void {
  const lv = app.live;
  if (!lv) return;
  const text = M(lv.msg);
  const w = Math.min(L.lw * 0.92, 700);
  ui.place("live", { anchor: "bottom", y: compact ? (trayPx - frame().safeArea.bottom) / L.sc + 6 : 4 }, () => {
    if (compact) ui.column("live-box", () => para(text, w - 20, "live-dark", "live-text"), { style: "live-box", align: "center" });
    else para(text, w, "live", "live-text");
  });
}

// ------------------------------------------------------------------ overlays
function tutorialPanel(w: number): void {
  const step = Content.LESSONS[Math.min(app.tutorialIndex, Content.LESSONS.length - 1)]!;
  const last = app.tutorialIndex >= Content.LESSONS.length - 1;
  heading("h2", T(step.title), w, "tutorial-h");
  para(T(step.text), w, "body", "tutorial-text");
  flow("tutorial-btns", [
    { id: "btn-tutorial-next", text: last ? T("Start Playing") : T("Got it"), style: "btn-primary", act: tutorialNext },
    { id: "btn-tutorial-skip", text: T("Skip Tutorial"), act: tutorialSkip },
  ], w);
}
function pausePanel(w: number): void {
  heading("h2", T("Paused"), w, "pause-h");
  stack("pause-menu", [
    { id: "btn-resume", text: T("Resume"), style: "btn-primary", act: resumeGame },
    { id: "btn-pause-settings", text: T("Settings"), act: () => openPage("settings") },
    { id: "btn-pause-help", text: T("Help"), act: () => openPage("help") },
    { id: "btn-leave", text: T("Leave Round"), act: leaveRound },
  ], w);
}
function scoreRow(id: string, label: string, value: string, total: boolean, w: number): void {
  ui.row(id, () => {
    para(label, w - 80, total ? "score-total-label" : "score-label");
    ui.spacer();
    ui.style(total ? "score-total-value" : "score-value").id(`${id}-v`).label(value);
  }, { width: w, align: "center", style: total ? "score-total" : "score-row" });
}
function resultsPanel(w: number): void {
  const r = app.results!;
  const st = r.state;
  heading("h2", st.status === "complete" ? T("Board Complete!") : T("Round Over"), w, "results-h");
  const rows: [string, number][] = [
    [T("Words ({n})", { n: st.foundCount }), st.score.wordPoints],
    [T("Clean bonuses"), st.score.cleanBonus],
    [T("Speed bonuses"), st.score.speedBonus],
    [T("Daily streak bonus"), st.score.streakBonus],
  ];
  ui.column("breakdown", () => {
    rows.forEach(([k, v], i) => scoreRow(`bd-${i}`, k, String(v), false, w));
    scoreRow("bd-total", T("Total"), String(st.score.total), true, w);
  }, { spacing: 0, width: w });
  para(T("Time {time} · Invalid selections {n}", { time: fmtTime(st.elapsedMs), n: st.invalidActions })
    + (r.best ? ` · ${T("New best score!")}` : "") + (r.constraint ? ` · ${r.constraint()}` : ""), w, "muted", "results-extra");
  r.achievements.forEach((a, i) => para(`🏆 ${T("Achievement unlocked: {name} — {desc}", { name: T(a.name), desc: T(a.desc) })}`, w, "body", `ach-${i}`));
  const lb = leaderboardLine();
  if (lb) para(lb, w, "muted", "results-lb");
  if (app.lbRows && app.lbRows.length) {
    heading("h3", T("Leaderboard"), w, "lb-h");
    ui.column("lb-rows", () => app.lbRows!.slice(0, 10).forEach((row, i) =>
      scoreRow(`lb-${i}`, `${i + 1}. ${row.player || T("player")}`, String(row.score), false, w)), { spacing: 0, width: w });
  }
  flow("results-btns", [
    { id: "btn-retry", text: T("Retry"), style: "btn-primary", act: () => { audio.play("select"); retry(); } },
    { id: "btn-next", text: T(r.nextLabel), act: next },
    { id: "btn-results-menu", text: T("Menu"), act: () => { audio.play("uiBack"); backToTitle(); } },
  ], w);
}

// ------------------------------------------------------------------ the toast
function toast(L: Layout): void {
  const tt = app.toast;
  if (!tt) return;
  const w = Math.min(L.lw * 0.92, 420);
  ui.place("toast", { anchor: "bottom", y: 16 }, () => ui.column("toast-col", () => para(tt.text, w - 36, "toast-text", "toast-text"), { style: "toast", align: "center" }));
}
