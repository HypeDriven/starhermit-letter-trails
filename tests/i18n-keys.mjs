// Key extraction for the i18n coverage test (run directly to list the keys).
// Keys are the US-English source strings: literal T('…') / N('…') calls in
// src/, data-i18n* markup in index.html (rich-text cards use their authored
// innerHTML) and the content tables' display fields. The hidden words are
// English word-search data, not UI text.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LESSONS, CHALLENGES, PRACTICE } from '../src/content.js';

const ROOT = new URL('..', import.meta.url).pathname;
const unescape = (s) => s.replace(/\\(['"\\])/g, '$1');
const SKIP = new Set(['i18n.js', 'gfx-i18n.js', 'sh-strings.js']);

export function sourceKeys() {
  const keys = new Set();
  const call = /(?<![\w.$])(?:T|N)\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")/g;
  for (const f of readdirSync(join(ROOT, 'src'))) {
    if (!f.endsWith('.js') || SKIP.has(f)) continue;
    const src = readFileSync(join(ROOT, 'src', f), 'utf8');
    for (const m of src.matchAll(call)) keys.add(unescape(m[1] ?? m[2]));
  }
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  for (const m of html.matchAll(/data-i18n(?:-aria|-title)?="([^"]+)"/g)) keys.add(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  for (const m of html.matchAll(/<div class="rule-card" data-i18n-html>([\s\S]*?)<\/div>/g)) keys.add(m[1].trim());
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
