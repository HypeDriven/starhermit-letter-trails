// The look per graphics level: the browser build's four presets and budgets
// (src/gfx.js TABLE / BUDGETS, each tuned to hold 60 FPS on the weakest GPU
// its Auto gave it) keyed by the runtime's quality tier (frame().quality),
// with the found-word sparkles scaled within the tier by the level
// (frame().levelIndex, at most 2×), as the browser build scaled them by its
// hardware level. The runtime owns the rest of what the old Graphics panel
// did: Auto and the level choice, render scale and the pixel-ratio cap,
// adaptive resolution, the frame-rate limit and readout. The old panel's
// per-effect overrides are not offered (the runtime's Options choose a level).
import type { QualityTier } from "starhermit:engine";
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
  bloomRes: number;
  aoRes: number;
}
export interface Look {
  preset: QualityTier;
  /** Key-light shadow map (0 = off). */
  shadows: 0 | 1024 | 2048 | 4096;
  ao: "off" | "on" | "high";
  bloom: boolean;
  grade: boolean;
  antialias: AntialiasMode;
  /** Image-based reflections from a neutral room. */
  reflections: boolean;
  /** Wood and paper textures, the detailed letter atlas, rounded clear-coated tiles, pencil tips. */
  detailed: boolean;
  particles: "off" | "low" | "high";
  budget: Budget;
}

const TABLE: Record<QualityTier, Omit<Look, "preset" | "budget">> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "msaa", reflections: false, detailed: false, particles: "off" },
  balanced: { shadows: 1024, ao: "off", bloom: true, grade: true, antialias: "fxaa", reflections: true, detailed: true, particles: "low" },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", reflections: true, detailed: true, particles: "high" },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", reflections: true, detailed: true, particles: "high" },
};
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", atlas: 128, wood: 256, segments: 1, sparks: 0.5, motes: 0.5, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: "standard", atlas: 192, wood: 512, segments: 2, sparks: 0.75, motes: 0.75, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: "physical", atlas: 256, wood: 512, segments: 3, sparks: 1, motes: 1, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: "physical", atlas: 384, wood: 1024, segments: 4, sparks: 1.5, motes: 1.5, bloomRes: 1, aoRes: 1 },
};
/** The first level index of each tier (quantum, molecular, terrestrial, galactic). */
const TIER_FLOOR: Record<QualityTier, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };

/** The look for a quality tier at a level index (0 quantum … 9 infinite). */
export function lookFor(preset: QualityTier, levelIndex: number): Look {
  const b = { ...BUDGETS[preset] };
  // Levels are about 1.64× apart in GPU throughput: sparkles grow with the
  // level above the tier's first, at most 2× the tier's budget.
  const k = Math.min(2, Math.pow(1.64, Math.max(0, levelIndex - TIER_FLOOR[preset])));
  b.sparks = Math.round(b.sparks * k * 100) / 100;
  return { preset, ...TABLE[preset], budget: b };
}
