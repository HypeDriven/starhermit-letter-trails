// The browser build's pure game modules, imported unchanged in what they
// decide (allowJs) and typed here with the shapes this client reads: the
// deterministic rules (src/rules.js: board generation, the select / tick /
// claim-streak commands, scoring, hashing), the versioned content
// (src/content.js: themes, word banks, the 40 Journey levels, the Daily,
// Practice and Challenge boards, the tutorial lessons), the session (phase
// machine, local progress under the lt:* keys, achievements, replay
// envelope) and the save document (src/store.js).
import * as RulesJs from "../src/rules.js";
import * as ContentJs from "../src/content.js";
import * as SessionJs from "../src/session.js";
import * as StoreJs from "../src/store.js";
import * as UtilJs from "../src/util.js";

export type Cell = [number, number];
export interface Word { word: string; cells: Cell[]; found: boolean }
export interface Score { wordPoints: number; cleanBonus: number; speedBonus: number; streakBonus: number; total: number }
export interface State {
  version: number; seed: number; size: number; grid: string[]; words: Word[]; tick: number; foundCount: number;
  invalidActions: number; streakClean: number; status: "active" | "complete"; terminalReason: string | null;
  score: Score; elapsedMs: number; streakClaimed: boolean;
}
export interface Challenge { moveLimit?: number; timeTargetMs?: number }
export interface Def {
  id: string; seed: number; size: number; theme: string; wordCount: number; words: string[];
  mechanics: { tutorial: boolean; mastery: boolean; challenge: Challenge | null };
  par: { moves: number; timeMs: number }; date?: string;
}
export interface Theme { name: string; paper: string; ink: string; tile: string; tileEdge: string; accent: string; desk: string; found: string; marker: string }
export interface Lesson { id: string; title: string; text: string }
export interface ChallengeEntry { id: string; label: string; mechanics: { challenge: Challenge } }
export interface Command { type: string; id?: string; cells?: Cell[]; ms?: number; days?: number }
export interface Result { state: State; ok: boolean; reason: string }
export interface Phase { phase: string; transition(to: string, reason: string): void; onTransition(fn: (e: { from: string; to: string; reason: string }) => void): void }
export interface Settings { tutorialDone: boolean; [k: string]: unknown }
export interface Achievement { name: string; desc: string }
export type Doc = Record<string, unknown>;

interface RulesApi {
  createState(def: { seed: number; size: number; words: string[] }): State;
  applyCommand(s: State, cmd: Command): Result;
  legalActions(s: State): { type: "select"; cells: Cell[]; word: string }[];
}
interface ContentApi {
  THEMES: Record<string, Theme>;
  JOURNEY: Def[];
  PRACTICE: Record<string, { id: string; size: number; wordCount: number; label: string }>;
  LESSONS: Lesson[];
  CHALLENGES: ChallengeEntry[];
  dailyDefinition(day: string): Def;
  practiceDefinition(diff: string, seed: number): Def;
  challengeDefinition(id: string): Def;
}
interface SessionApi {
  setStorage(s: { getItem(k: string): string | null; setItem(k: string, v: string): void }): void;
  createSession(): Phase;
  beginEnvelope(def: Def, s: State): unknown;
  recordCommand(env: unknown, cmd: Command, s: State): void;
  loadSettings(): Settings;
  saveSettings(s: Settings): void;
  loadJourneyProgress(): { completed: string[]; lastLevel: string | null };
  markJourneyLevelCompleted(id: string): void;
  recordBestScore(id: string, score: number): boolean;
  recordDailyCompletion(day: string): { days: number; lastDay: string };
  guestProfile(): { id: string; name: string };
  ACHIEVEMENTS: Record<string, Achievement>;
  loadAchievements(): { unlocked: Record<string, number>; totalWords: number };
  unlockAchievement(key: string): boolean;
  addWordsFound(n: number): number;
}
interface StoreApi {
  CLOUD_KEYS: string[];
  normalize(raw: unknown): Doc;
  mergeDocs(remote: unknown, local: unknown): Doc;
  readForeign(text: string | null): Doc | null;
  docStorage(doc: Doc, onWrite: () => void): { getItem(k: string): string | null; setItem(k: string, v: string): void };
}
interface UtilApi {
  utcDay(t: number): string;
  twoDigit(n: number): string;
}

export const Rules = RulesJs as unknown as RulesApi;
export const Content = ContentJs as unknown as ContentApi;
export const Sess = SessionJs as unknown as SessionApi;
export const Store = StoreJs as unknown as StoreApi;
export const Util = UtilJs as unknown as UtilApi;
