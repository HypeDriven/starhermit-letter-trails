// Key extraction for the i18n coverage test (run directly to list the keys).
// Keys are the US-English source strings: literal T('…') / N('…') calls in
// src/*.js and native/*.ts (the How to Play cards keep their authored
// <strong>/<kbd> markup) and the content tables' display fields. The hidden
// words are English word-search data, not UI text.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LESSONS, CHALLENGES, PRACTICE } from '../src/content.js';

const ROOT = new URL('..', import.meta.url).pathname;
const unescape = (s) => s.replace(/\\(['"\\])/g, '$1');
const SKIP = new Set(['i18n.js', 'gfx-i18n.js', 'sh-strings.js']);

export function sourceKeys() {
  const keys = new Set();
  const call = /(?<![\w.$])(?:T|N)\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")/g;
  for (const dir of ['src', 'native']) {
    for (const f of readdirSync(join(ROOT, dir))) {
      if (!/\.(js|ts)$/.test(f) || SKIP.has(f)) continue;
      const src = readFileSync(join(ROOT, dir, f), 'utf8');
      for (const m of src.matchAll(call)) keys.add(unescape(m[1] ?? m[2]));
    }
  }
  return keys;
}

export function contentKeys() {
  const keys = new Set();
  const add = (...v) => v.forEach((s) => { if (typeof s === 'string' && s) keys.add(s); });
  for (const l of LESSONS) add(l.title, l.text);
  for (const c of CHALLENGES) add(c.label);
  for (const p of Object.values(PRACTICE)) add(p.label);
  const session = readFileSync(join(ROOT, 'src/session.js'), 'utf8');
  const ach = session.slice(session.indexOf('ACHIEVEMENTS'), session.indexOf('};', session.indexOf('ACHIEVEMENTS')));
  for (const m of ach.matchAll(/(?:name|desc): '([^']+)'/g)) add(m[1]);
  add('Guest');
  return keys;
}

export const ALL = new Set([...sourceKeys(), ...contentKeys()]);

if (process.argv[1] && process.argv[1].endsWith('i18n-keys.mjs')) console.log(JSON.stringify([...ALL], null, 1));
