// Sound, as the browser build's src/audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per game event, round-robin among an
// event's variants (tile ticks, line start, invalid thud, word found, round
// complete, cursor moves, hint shimmer, achievement, back), and the quiet
// ambience of a round: lowpassed noise (320 Hz) whose level a 0.11 Hz LFO
// swells by ±0.02 around 0.05. The browser build ran that as a live noise
// loop and oscillator; here it is rendered once into one seamless LFO cycle
// (createClip, a slice a frame) and looped on the music bus while a round is
// active (the runtime has no ambience bus; its gain folds in the old
// ambience slider's 40 % default). The runtime's Options own the volumes, the
// mute and the voice limit; the back click plays on the "interface" bus, the
// rest on "effects". The oscillator blips the browser build synthesized while
// a sample decoded are not ported (a live synthesis graph makes clip loads
// fail on the engine's web runtime), so a clip still loading is silent.
// Clips load once the mixer runs (natively at once, in a browser after the
// first press), one at a time.
import { context, createClip, loadClip, play as playClip, type AudioClip, type Sound } from "starhermit:audio";

const SFX: Record<string, string[]> = {
  tick: ["tile-tick-1", "tile-tick-2", "tile-tick-3"],
  select: ["select-confirm-1", "select-confirm-2"],
  invalid: ["invalid-thud-1", "invalid-thud-2"],
  wordFound: ["word-found-1", "word-found-2", "word-found-3"],
  complete: ["round-complete-1", "round-complete-2"],
  uiMove: ["ui-move-1", "ui-move-2"],
  hint: ["hint-shimmer-1", "hint-shimmer-2"],
  achievement: ["achievement-1"],
  uiBack: ["ui-back-1"],
};
export type Sfx = keyof typeof SFX;
const clips = new Map<string, AudioClip>();
const queue: string[] = [];
const cursor = new Map<string, number>();
let loading = false;
let wantClips = false;

/** Asks for the clips; they load once the mixer runs (see update). */
export function loadSfx(): void { wantClips = true; }

/** src/audio.js sfx.<event>(): the event's next variant (a still-loading one is silent). */
export function play(event: Sfx): void {
  const names = SFX[event];
  if (!names) return;
  const i = (cursor.get(event) ?? 0) % names.length;
  const file = names[i]!;
  const clip = clips.get(file);
  if (!clip) return;
  cursor.set(event, i + 1);
  try { playClip(clip, { bus: event === "uiBack" ? "interface" : "effects" }); }
  catch { clips.delete(file); if (!queue.includes(file)) queue.push(file); } // a clip the mixer lost: load it again
}

// -- the ambience -----------------------------------------------------------------------------
const RATE = 11025;
const N = Math.round(RATE / 0.11);
const amb = new Float32Array(N);
let ambPos = 0;
let ambY = 0;
let seed = 991;
function noise(): number {
  // mulberry32 (src/util.js), as the old noise buffer was seeded.
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t ^= t + Math.imul(t >> 7, 61 | t);
  return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
}
/** One LFO cycle, a slice at a time: a one-pole lowpass run twice over the noise so the loop joins without a click. */
function renderAmbience(count: number): boolean {
  const k = (2 * Math.PI * 320) / RATE;
  const end = Math.min(2 * N, ambPos + count);
  for (; ambPos < end; ambPos++) {
    const i = ambPos % N;
    if (ambPos < N) amb[i] = noise();
    ambY += k * (amb[i]! - ambY);
    if (ambPos >= N) amb[i] = ambY * 2.2 * (0.05 + 0.02 * Math.sin((2 * Math.PI * i) / N));
  }
  return ambPos >= 2 * N;
}
let ambClip: AudioClip | null = null;
let ambVoice: Sound | null = null;
let wantAmbience = false;
/** The round's ambience on (main.ts: the round goes active) or off. */
export function setAmbience(on: boolean): void {
  wantAmbience = on;
  if (!on && ambVoice) { try { ambVoice.stop(); } catch { /* already gone */ } ambVoice = null; }
}

/** Each frame: the clips once the mixer runs (one at a time), then the ambience loop. */
export function update(): void {
  if (context.state !== "running") return;
  if (wantClips) {
    wantClips = false;
    for (const list of Object.values(SFX)) for (const n of list) if (!queue.includes(n)) queue.push(n);
  }
  if (!loading && queue.length) {
    const name = queue.shift()!;
    if (!clips.has(name)) {
      loading = true;
      loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); loading = false; }, (e: unknown) => { console.warn(`sfx ${name}: ${String(e)}`); loading = false; });
    }
    return;
  }
  if (loading) return;
  if (!ambClip) {
    if (!renderAmbience(6000)) return;
    try { ambClip = createClip([amb], RATE); } catch (e) { console.warn(`audio: ${String(e)}`); ambPos = 0; }
    return;
  }
  if (wantAmbience && !ambVoice) {
    try { ambVoice = playClip(ambClip, { bus: "music", gain: 0.4, loop: true }); } catch { ambVoice = null; }
  }
}
