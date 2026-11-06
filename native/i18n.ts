// Localization: the engine's string tables (assets/strings.json: US-English
// keys, the nine StarHermit locales) in the interface language the runtime
// reports (the player's choice in Options › Language, else the account's
// preferred language or the device's). The runtime's Options replaced the game's
// own Language setting (sh-language.js) and the DOM re-labelling: every string is
// drawn through T() each frame, so a change shows on the next frame without
// touching the round. The hidden words are English word-search content in every
// locale (as before); their theme names are translated. The account lines are the
// engine's `starhermit.*` keys.
import { strings } from "starhermit:engine";
import * as ui from "starhermit:ui";

strings.load("assets/strings.json");
strings.defaultLocale = "en-US";
ui.setLanguage(strings.locale);
strings.onChange((locale) => ui.setLanguage(locale));

type Vars = Record<string, string | number | (() => string)>;
const resolve = (vars?: Vars): Record<string, string | number> | undefined =>
  vars && Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, typeof v === "function" ? v() : v]));
/** A string by its US-English key in the player's language; `{name}` placeholders from vars (functions resolve now). */
export function T(key: string, vars?: Vars): string {
  if (key == null) return "";
  const k = String(key), v = resolve(vars);
  if (strings.has(k)) return strings.t(k, v);
  return v ? k.replace(/\{(\w+)\}/g, (m, n: string) => (v[n] != null ? String(v[n]) : m)) : k;
}
/** Marks a key for the translation check; translated later with T(). */
export const N = (key: string): string => key;
/** [key, vars] pairs translated at draw time (so they follow a language change). */
export type Msg = [string, Vars?];
export const M = (m: Msg | string): string => (typeof m === "string" ? T(m) : T(m[0], m[1]));
/** An account or leaderboard line: the engine's `starhermit.*` strings. */
export function account(key: string, vars?: Record<string, string | number>): string { return strings.t(`starhermit.${key}`, vars); }
