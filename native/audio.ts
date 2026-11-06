// Sound, as the browser build's src/audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per game event, round-robin among an
// event's variants (tile ticks, line start, invalid thud, word found, round
// complete, cursor moves, hint shimmer, achievement, back), and the quiet
// ambience of a round: lowpassed noise (320 Hz) whose level a 0.11 Hz LFO
// swells by ±0.02 around 0.05. The browser build ran that as a live noise
// loop and oscillator; here it is rendered offline once into one seamless LFO
// cycle and looped on the music bus while a round is
// active (the runtime has no ambience bus; its gain folds in the old
// ambience slider's 40 % default). The runtime's Options own the volumes, the
// mute and the voice limit; the back click plays on the "interface" bus, the
// rest on "effects". The oscillator blips the browser build synthesized while
// a sample decoded are not ported (a live synthesis graph makes clip loads
// fail on the engine's web runtime), so a clip still loading is silent.
// Every clip loads at once in onStart (the engine hands each loaded clip to
// the mixer, natively and in a browser); the ambience still waits for the
// mixer to run (in a browser, the first press).
import { OfflineAudioContext, SoundBank, context, createClip, loadClip, play as playClip, type AudioClip, type Sound } from "starhermit:audio";

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
const banks = new Map<string, SoundBank>();

/** Loads every clip at once (onStart); an event whose clips are still loading is silent. */
export function loadSfx(): void {
  for (const [event, names] of Object.entries(SFX)) {
    void Promise.all(names.map((name) => loadClip(`sfx/${name}.opus`).catch((e: unknown) => { console.warn(`sfx ${name}: ${String(e)}`); return null; }))).then((loaded) => {
      const clips = loaded.filter((c) => c !== null);
      if (clips.length) banks.set(event, new SoundBank({ clips, order: "sequence", bus: event === "uiBack" ? "interface" : "effects" }));
    });
  }
  void renderAmbience().then((c) => { ambClip = c; }, (e: unknown) => console.warn(`audio: ${String(e)}`));
}

/** src/audio.js sfx.<event>(): the event's next variant (silent while its clips load). */
export function play(event: Sfx): void {
  try { banks.get(event)?.play(); }
  catch { /* the mixer is full this frame: skip it */ }
}

// -- the ambience -----------------------------------------------------------------------------
const RATE = 11025;
const N = Math.round(RATE / 0.11);
/** One LFO cycle over a noise loop of the same length: the second cycle of the render is periodic, so the loop joins without a click. */
async function renderAmbience(): Promise<AudioClip> {
  const off = new OfflineAudioContext(1, 2 * N, RATE);
  const noise = off.createNoise({ seed: 991, seconds: N / RATE });
  const lp = off.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 320;
  const swell = off.createGain();
  swell.gain.value = 2.2 * 0.05;
  const lfo = off.createOscillator();
  lfo.frequency.value = RATE / N;
  const depth = off.createGain();
  depth.gain.value = 2.2 * 0.02;
  lfo.connect(depth).connect(swell.gain);
  noise.connect(lp).connect(swell).connect(off.destination);
  noise.start();
  lfo.start();
  const r = await off.startRendering();
  return createClip([r.getChannelData(0).slice(N)], RATE);
}
let ambClip: AudioClip | null = null;
let ambVoice: Sound | null = null;
let wantAmbience = false;
/** The round's ambience on (main.ts: the round goes active) or off. */
export function setAmbience(on: boolean): void {
  wantAmbience = on;
  if (!on && ambVoice) { try { ambVoice.stop(); } catch { /* already gone */ } ambVoice = null; }
}

/** Each frame once the mixer runs: the ambience loop. */
export function update(): void {
  if (context.state !== "running") return;
  if (!ambClip) return;
  if (wantAmbience && !ambVoice) {
    try { ambVoice = playClip(ambClip, { bus: "music", gain: 0.4, loop: true }); } catch { ambVoice = null; }
  }
}
