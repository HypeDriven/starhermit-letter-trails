'use strict';

// Letter Trails — the save document. Pure (no storage, no platform) so the
// engine client and the node tests share it.
//
// The browser build kept its progress in localStorage under the lt:* keys
// and mirrored them into the cloud slot game:<slug> as one JSON document
// { 'lt:settings': {…}, 'lt:journey': {…}, … } (the JS SDK's saveJSON). The
// engine client's save is that same document: docStorage() gives
// src/session.js a localStorage-like view of it, mergeDocs() is the browser
// build's saveconflict merge, and readForeign() reads the old slot's text.

export const CLOUD_KEYS = ['lt:settings', 'lt:journey', 'lt:achievements', 'lt:best', 'lt:streak', 'lt:guest'];

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** Only the lt:* keys of anything (the old cloud doc included); values parsed when stored as JSON text. */
export function normalize(raw) {
  const src = obj(raw);
  const out = {};
  for (const k of CLOUD_KEYS) {
    let v = src[k];
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { continue; } }
    if (v && typeof v === 'object') out[k] = v;
  }
  return out;
}

// Another device saved since this one last loaded the slot: keep everything
// either side earned (journey levels, achievements with the earliest unlock,
// the larger word total, the best score per mode, the more recent daily streak)
// and this device's settings and guest profile.
export function mergeDocs(remote, local) {
  const r = normalize(remote), l = normalize(local);
  const out = { ...r, ...l };
  const rj = obj(r['lt:journey']), lj = obj(l['lt:journey']);
  out['lt:journey'] = { ...rj, ...lj, completed: [...new Set([...(rj.completed || []), ...(lj.completed || [])])] };
  const ra = obj(r['lt:achievements']), la = obj(l['lt:achievements']);
  const unlocked = { ...obj(ra.unlocked) };
  for (const [k, v] of Object.entries(obj(la.unlocked))) unlocked[k] = unlocked[k] && unlocked[k] < v ? unlocked[k] : v;
  out['lt:achievements'] = { ...ra, ...la, unlocked, totalWords: Math.max(Number(ra.totalWords) || 0, Number(la.totalWords) || 0) };
  const best = { ...obj(r['lt:best']) };
  for (const [k, v] of Object.entries(obj(l['lt:best']))) best[k] = Math.max(Number(best[k]) || 0, Number(v) || 0);
  out['lt:best'] = best;
  const rs = obj(r['lt:streak']), ls = obj(l['lt:streak']);
  out['lt:streak'] = String(rs.lastDay || '') > String(ls.lastDay || '') ? rs
    : String(rs.lastDay || '') < String(ls.lastDay || '') ? ls
    : ((Number(rs.days) || 0) > (Number(ls.days) || 0) ? rs : ls);
  for (const k of ['lt:settings', 'lt:guest']) if (l[k] !== undefined) out[k] = l[k];
  // Only keys that exist on either side are kept.
  for (const k of Object.keys(out)) if (r[k] === undefined && l[k] === undefined) delete out[k];
  return out;
}

/** The browser build's cloud slot text (its lt:* document as JSON), or null. */
export function readForeign(text) {
  if (typeof text !== 'string' || !text) return null;
  try {
    const doc = JSON.parse(text);
    return doc && typeof doc === 'object' && !Array.isArray(doc) ? normalize(doc) : null;
  } catch { return null; }
}

/** A localStorage-like view of `doc` (getItem/setItem/removeItem); onWrite() after each change. */
export function docStorage(doc, onWrite) {
  return {
    getItem(k) { return doc[k] === undefined ? null : JSON.stringify(doc[k]); },
    setItem(k, v) { doc[k] = JSON.parse(String(v)); if (onWrite) onWrite(); },
    removeItem(k) { delete doc[k]; if (onWrite) onWrite(); },
  };
}
