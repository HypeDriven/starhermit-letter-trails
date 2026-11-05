// The look per graphics level. The engine-owned effects (shadows and their
// map size, ambient occlusion, bloom, the grade, anti-aliasing) are the
// level's own (levelSettings(): the same table every StarHermit game reads).
// The game's art (materials, the letter atlas, wood and paper textures, tile
// bevels, reflections, detail, the sparkles and motes) is the browser build's
// four presets and budgets (src/gfx.js TABLE / BUDGETS) keyed by the level's
// quality tier, with the found-word sparkles scaled within the tier by the
// level's particle budget against the tier's anchor level (quantum,
// molecular, terrestrial, galactic), at most 2×. The runtime owns the rest of
// what the old Graphics panel did: Auto and the level choice, render scale and
// the pixel-ratio cap, adaptive resolution, the frame-rate limit and readout.
// The old panel's per-effect overrides are not offered (the runtime's Options
// choose a level).
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export interface Budget {
  /** Tiles, desk, paper and pencils: Lambert (Low), standard (Balanced), clear-coated physical (High/Ultra). */
  material: "lambert" | "standard" | "physical";
  /** Letter-atlas cell size in px (assets/textures/atlas-<theme>-<cell>…). */
  atlas: number;
  /** Desk wood and paper texture size in px. */
  wood: number;
  /** Rounded-tile bevel segments and pencil sides. */
  segments: number;
  /** Multiplies the found-word sparkles and their pool. */
  sparks: number;
  /** Multiplies the ambient dust motes. */
  motes: number;
}
export interface Look {
  preset: QualityTier;
  /** The level's key-light shadow map size, 0 when the level draws no shadows. */
  shadows: number;
  /** The level's ambient occlusion (null: off). */
  ao: { resolution: number; samples: number; denoiseSamples: number } | null;
  /** The level's bloom resolution (null: off). */
  bloom: number | null;
  grade: boolean;
  antialias: AntialiasMode;
  /** Image-based reflections from a neutral room. */
  reflections: boolean;
  /** Wood and paper textures, the detailed letter atlas, rounded clear-coated tiles, pencil tips. */
  detailed: boolean;
  particles: "off" | "low" | "high";
  budget: Budget;
}

const ART: Record<QualityTier, Pick<Look, "reflections" | "detailed" | "particles">> = {
  low: { reflections: false, detailed: false, particles: "off" },
  balanced: { reflections: true, detailed: true, particles: "low" },
  high: { reflections: true, detailed: true, particles: "high" },
  ultra: { reflections: true, detailed: true, particles: "high" },
};
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", atlas: 128, wood: 256, segments: 1, sparks: 0.5, motes: 0.5 },
  balanced: { material: "standard", atlas: 192, wood: 512, segments: 2, sparks: 0.75, motes: 0.75 },
  high: { material: "physical", atlas: 256, wood: 512, segments: 3, sparks: 1, motes: 1 },
  ultra: { material: "physical", atlas: 384, wood: 1024, segments: 4, sparks: 1.5, motes: 1.5 },
};
/** The level whose settings are each tier's preset. */
const ANCHOR: Record<QualityTier, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };

/** The look for a graphics level (the frame's by default). */
export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  const b = { ...BUDGETS[preset] };
  // The sparkles grow with the level's particle budget above the tier's anchor, at most 2×.
  const k = Math.min(2, s.particles / levelSettings(ANCHOR[preset]).particles);
  b.sparks = Math.round(b.sparks * k * 100) / 100;
  b.wood = Math.min(b.wood, s.maxTextureSize);
  return {
    preset, ...ART[preset],
    shadows: s.shadows ? s.shadowMapSize : 0,
    ao: s.ao && { resolution: s.ao.resolution, samples: s.ao.samples, denoiseSamples: s.ao.denoiseSamples },
    bloom: s.bloom ? s.bloom.resolution : null,
    grade: s.grade,
    // Engine 1.36.1 bug: antialias "off" recolours fog, haze and translucent overlays; the old Low's MSAA
    // stays until engine 1.36.2 (drop this clamp when pinning 1.36.2+).
    antialias: s.antialias === "off" ? "msaa" : s.antialias,
    budget: b,
  };
}
