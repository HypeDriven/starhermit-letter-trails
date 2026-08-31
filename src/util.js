'use strict';

// FNV-1a 32-bit string hash.
export function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Deterministic PRNG (mulberry32). Returns a function producing [0,1).
export function mulberry(seed) {
  let s = seed >>> 0;
  const out = () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t >> 7, 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  out.int = () => Math.floor(out() * 0x80000000); // [0, 2^31)
  return out;
}

export function lerp(a, b, t) { return a + (b - a) * t; }
export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// Cubic ease-in-out.
export function easeInOut(t) { return t <= 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3)/2; }

function pad(n) { return n < 10 ? '0' + String(n) : String(n); }
export function twoDigit(n) { return pad(Math.floor(n)); }

// "HH:MM" from seconds.
export function clock(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600)/60);
  return (h ? pad(h)+':' : '') + pad(m);
}

// "YYYY-MM-DD" from a Date.
export function dateStr(d) {
  const y = d.getFullYear(), mo = d.getMonth()+1, da = d.getDate();
  return String(y) + '-' + pad(mo) + '-' + pad(da);
}

function hex(n) { let s=''; while (n>0){ n=Math.floor(n/36); s=String.fromCharCode(97+(n%36))+s; } return s||'a'; }
export function uid() { return Date.now().toString(16)+'-'+Math.random().toString(16).slice(2,8)+hex(Math.floor(Math.random()*40)); }

// "YYYY-MM-DD" of the UTC day containing t (ms since epoch), 03:00 boundary.
export function utcDay(t) { return dateStr(new Date(t - 3*3600e3)) + 'T'; }

const _now = () => Date.now();
let _last = 0;
// Monotonic ms, >= previous call's value.
export function now() { const t=_now(); if (t<_last) return _last; _last=t; return t; }
