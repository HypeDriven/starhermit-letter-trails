'use strict';

// Letter Trails — WebAudio procedural SFX. No audio assets; everything is
// synthesized. Buses: master → music / effects / ambience / voice.

import { mulberry } from './util.js';

let ctx = null;
let master, musicBus, effectsBus, ambienceBus, voiceBus;
let muted = false;
let ambienceNodes = null;
let rng = mulberry(20260830);

const volumes = { music: 0.6, effects: 0.8, ambience: 0.4, voice: 0.7 };

function ensureCtx() {
  if (ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  master = ctx.createGain();
  master.connect(ctx.destination);
  musicBus = ctx.createGain(); musicBus.connect(master);
  effectsBus = ctx.createGain(); effectsBus.connect(master);
  ambienceBus = ctx.createGain(); ambienceBus.connect(master);
  voiceBus = ctx.createGain(); voiceBus.connect(master);
  applyVolumes();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) suspend(); else resume();
  });
  return true;
}

function applyVolumes() {
  if (!ctx) return;
  const m = muted ? 0 : 1;
  master.gain.value = m;
  musicBus.gain.value = volumes.music;
  effectsBus.gain.value = volumes.effects;
  ambienceBus.gain.value = volumes.ambience;
  voiceBus.gain.value = volumes.voice;
}

export function unlock() {
  if (!ensureCtx()) return false;
  if (ctx.state === 'suspended') ctx.resume();
  return true;
}

export function suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); }
export function resume() { if (ctx && ctx.state === 'suspended' && !muted) ctx.resume(); }

export function setMuted(v) { muted = !!v; applyVolumes(); }
export function isMuted() { return muted; }

export function setVolume(bus, v) {
  if (!(bus in volumes)) return;
  volumes[bus] = Math.max(0, Math.min(1, v));
  applyVolumes();
}

export function getVolumes() { return { ...volumes }; }

// Seeded pitch variant in [1-spread, 1+spread], deterministic per counter.
let pitchCounter = 0;
function pitchVariant(spread = 0.06) {
  pitchCounter++;
  return 1 + (mulberry((pitchCounter * 2654435761) >>> 0)() * 2 - 1) * spread;
}

function blipShape(bus, { freq = 440, dur = 0.08, type = 'sine', gain = 0.3, slide = 0 }) {
  if (!unlock() || muted) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq * pitchVariant(), t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(bus);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}

// Authored one-shot samples (sfx/<name>.opus, see sfx/manifest.json), lazily
// fetched and decoded after the user-gesture unlock. Procedural synthesis
// remains the fallback while a sample is loading or if fetch/decode fails.
const sampleMap = {
  tick: ['tile-tick-1', 'tile-tick-2', 'tile-tick-3'],
  select: ['select-confirm-1', 'select-confirm-2'],
  invalid: ['invalid-thud-1', 'invalid-thud-2'],
  wordFound: ['word-found-1', 'word-found-2', 'word-found-3'],
  complete: ['round-complete-1', 'round-complete-2'],
  uiMove: ['ui-move-1', 'ui-move-2'],
  hint: ['hint-shimmer-1', 'hint-shimmer-2'],
  achievement: ['achievement-1'],
  uiBack: ['ui-back-1'],
};
const sampleBuffers = new Map(); // name -> AudioBuffer
const sampleLoads = new Map();   // name -> in-flight Promise (dedupes fetches)
const sampleCursor = new Map();  // event -> rotation index across variants

function loadSample(name) {
  if (sampleLoads.has(name)) return sampleLoads.get(name);
  const p = fetch(`sfx/${name}.opus`)
    .then((r) => {
      if (!r.ok) throw new Error(`sfx ${name}: HTTP ${r.status}`);
      return r.arrayBuffer();
    })
    .then((ab) => ctx.decodeAudioData(ab))
    .then((buf) => { sampleBuffers.set(name, buf); })
    .catch(() => { sampleLoads.delete(name); }); // retry on a later event
  sampleLoads.set(name, p);
  return p;
}

// Prefer the mapped sample for an event; run the synthesis fallback while it
// loads (never both). Samples go through effectsBus, so mute/volume apply.
function playSample(event, fallback) {
  if (!unlock() || muted) return;
  const names = sampleMap[event];
  if (!names) { fallback(); return; }
  const i = (sampleCursor.get(event) || 0) % names.length;
  const buf = sampleBuffers.get(names[i]);
  if (!buf) {
    loadSample(names[i]);
    fallback();
    return;
  }
  sampleCursor.set(event, i + 1);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(effectsBus);
  src.start();
}

export const sfx = {
  tick() { playSample('tick', () => blipShape(effectsBus, { freq: 660, dur: 0.05, type: 'triangle', gain: 0.18 })); },
  select() { playSample('select', () => blipShape(effectsBus, { freq: 520, dur: 0.07, type: 'sine', gain: 0.25, slide: 120 })); },
  invalid() { playSample('invalid', () => blipShape(effectsBus, { freq: 130, dur: 0.22, type: 'sawtooth', gain: 0.22, slide: -50 })); },
  wordFound() {
    playSample('wordFound', () => {
      blipShape(effectsBus, { freq: 523, dur: 0.12, gain: 0.28 });
      setTimeout(() => blipShape(effectsBus, { freq: 659, dur: 0.12, gain: 0.28 }), 90);
      setTimeout(() => blipShape(effectsBus, { freq: 784, dur: 0.18, gain: 0.3 }), 180);
    });
  },
  complete() {
    playSample('complete', () => {
      const notes = [523, 659, 784, 1047];
      notes.forEach((f, i) => setTimeout(() => blipShape(effectsBus, { freq: f, dur: 0.3, gain: 0.3 }), i * 140));
      setTimeout(() => blipShape(effectsBus, { freq: 1319, dur: 0.5, gain: 0.25 }), 620);
    });
  },
  hint() {
    playSample('hint', () => {
      blipShape(effectsBus, { freq: 988, dur: 0.16, type: 'sine', gain: 0.16 });
      setTimeout(() => blipShape(effectsBus, { freq: 1319, dur: 0.22, type: 'sine', gain: 0.13 }), 110);
    });
  },
  achievement() {
    playSample('achievement', () => {
      blipShape(effectsBus, { freq: 196, dur: 0.14, type: 'triangle', gain: 0.24 });
      setTimeout(() => blipShape(effectsBus, { freq: 784, dur: 0.28, gain: 0.26 }), 130);
      setTimeout(() => blipShape(effectsBus, { freq: 1175, dur: 0.42, gain: 0.2 }), 300);
    });
  },
  uiBack() { playSample('uiBack', () => blipShape(effectsBus, { freq: 320, dur: 0.07, type: 'triangle', gain: 0.14, slide: -80 })); },
  uiMove() { playSample('uiMove', () => blipShape(effectsBus, { freq: 880, dur: 0.03, type: 'square', gain: 0.08 })); },
};

// Quiet filtered-noise ambience loop with a slow LFO. Start/stop safe.
export function startAmbience() {
  if (!unlock() || ambienceNodes) return;
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  const nrng = mulberry(991);
  for (let i = 0; i < len; i++) data[i] = nrng() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass'; filter.frequency.value = 320; filter.Q.value = 0.4;
  const g = ctx.createGain(); g.gain.value = 0.05;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11;
  const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.02;
  lfo.connect(lfoGain); lfoGain.connect(g.gain);
  src.connect(filter); filter.connect(g); g.connect(ambienceBus);
  src.start(); lfo.start();
  ambienceNodes = { src, lfo };
}

export function stopAmbience() {
  if (!ambienceNodes) return;
  try { ambienceNodes.src.stop(); ambienceNodes.lfo.stop(); } catch { /* already stopped */ }
  ambienceNodes = null;
}
