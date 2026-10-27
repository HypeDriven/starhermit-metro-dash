// The look per graphics level: the browser build's four presets and budgets
// (js/gfx.js TABLE / BUDGETS, each tuned to hold 60 FPS on the weakest GPU
// its Auto gave it) keyed by the runtime's quality tier (frame().quality),
// with the sparks and the city motes scaled within the tier by the level
// (frame().levelIndex, at most 2×), as the browser build scaled them by its
// hardware level. The runtime owns the rest of what the old Graphics panel
// did: Auto and the level choice, render scale and the pixel-ratio cap,
// adaptive resolution, the frame-rate limit and readout. The old panel's
// per-effect overrides are not offered (the runtime's Options choose a level).
import type { QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export interface Budget {
  /** Runner, coins, obstacles, street and city: Lambert (Low), Standard (Balanced), the authored Standard / clear-coated Physical (High, Ultra). */
  material: "lambert" | "standard" | "physical";
  /** Detailed asphalt texture size in px (the window texture: half as wide). */
  texture: 256 | 512 | 1024;
  /** Towers per side of the street with City detail on (plain keeps 10). */
  buildings: number;
  /** Spark pool at Particles high (low keeps 400). */
  sparks: number;
  /** Ambient city motes at Particles high. */
  motes: number;
  bloomRes: number;
  aoRes: number;
}
export interface Look {
  preset: QualityTier;
  /** Sun shadow map (0 = off). */
  shadows: 0 | 1024 | 2048 | 4096;
  ao: "off" | "on" | "high";
  bloom: boolean;
  grade: boolean;
  antialias: AntialiasMode;
  /** Image-based reflections from the room environment. */
  reflections: boolean;
  particles: "low" | "high";
  /** City detail: textured asphalt with a damp roughness map, curbs, lamp light pools, rooftop beacons, more towers. */
  detailed: boolean;
  budget: Budget;
}

const TABLE: Record<QualityTier, Omit<Look, "preset" | "budget">> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "msaa", reflections: false, particles: "low", detailed: false },
  balanced: { shadows: 1024, ao: "off", bloom: true, grade: true, antialias: "fxaa", reflections: true, particles: "high", detailed: true },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", reflections: true, particles: "high", detailed: true },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", reflections: true, particles: "high", detailed: true },
};
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", texture: 256, buildings: 10, sparks: 600, motes: 80, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: "standard", texture: 256, buildings: 16, sparks: 1200, motes: 140, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: "physical", texture: 512, buildings: 24, sparks: 2400, motes: 260, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: "physical", texture: 1024, buildings: 32, sparks: 4000, motes: 400, bloomRes: 1, aoRes: 1 },
};
export const SPARK_MAX = 8000;
export const MOTE_MAX = 800;
/** The first level index of each tier (quantum, molecular, terrestrial, galactic). */
const TIER_FLOOR: Record<QualityTier, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };

/** The look for a quality tier at a level index (0 … 9). */
export function lookFor(preset: QualityTier, levelIndex: number): Look {
  const b = { ...BUDGETS[preset] };
  // Levels are about 1.64× apart in GPU throughput: particle counts grow with the level above the tier's first, at most 2×.
  const k = Math.min(2, Math.pow(1.64, Math.max(0, levelIndex - TIER_FLOOR[preset])));
  b.sparks = Math.min(SPARK_MAX, Math.round(b.sparks * k));
  b.motes = Math.min(MOTE_MAX, Math.round(b.motes * k));
  return { preset, ...TABLE[preset], budget: b };
}
