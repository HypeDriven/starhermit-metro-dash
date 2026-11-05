// The look per graphics level. The engine-owned effects (shadows and their map
// size, ambient occlusion, bloom, the grade, anti-aliasing) are the level's own
// (levelSettings(): the same table every StarHermit game reads). The game's art
// (materials, asphalt texture, towers, sparks, motes, reflections, city detail)
// is the browser build's four presets and budgets (js/gfx.js TABLE / BUDGETS)
// keyed by the level's quality tier, with the sparks and the city motes scaled
// within the tier by the level's particle budget against the tier's anchor level
// (quantum, molecular, terrestrial, galactic), at most 2×. The runtime owns the
// rest of what the old Graphics panel did: Auto and the level choice, render
// scale and the pixel-ratio cap, adaptive resolution, the frame-rate limit and
// readout. The old panel's per-effect overrides are not offered (the runtime's
// Options choose a level).
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";
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
}
export interface Look {
  preset: QualityTier;
  /** The level's sun shadow map size, 0 when the level draws no shadows. */
  shadows: number;
  /** The level's ambient occlusion (null: off). */
  ao: { resolution: number; samples: number; denoiseSamples: number } | null;
  /** The level's bloom resolution (null: off). */
  bloom: number | null;
  grade: boolean;
  antialias: AntialiasMode;
  /** Image-based reflections from the room environment. */
  reflections: boolean;
  particles: "low" | "high";
  /** City detail: textured asphalt with a damp roughness map, curbs, lamp light pools, rooftop beacons, more towers. */
  detailed: boolean;
  budget: Budget;
}

type Art = Pick<Look, "reflections" | "particles" | "detailed">;
const ART: Record<QualityTier, Art> = {
  low: { reflections: false, particles: "low", detailed: false },
  balanced: { reflections: true, particles: "high", detailed: true },
  high: { reflections: true, particles: "high", detailed: true },
  ultra: { reflections: true, particles: "high", detailed: true },
};
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", texture: 256, buildings: 10, sparks: 600, motes: 80 },
  balanced: { material: "standard", texture: 256, buildings: 16, sparks: 1200, motes: 140 },
  high: { material: "physical", texture: 512, buildings: 24, sparks: 2400, motes: 260 },
  ultra: { material: "physical", texture: 1024, buildings: 32, sparks: 4000, motes: 400 },
};
export const SPARK_MAX = 8000;
export const MOTE_MAX = 800;
/** The level whose settings are each tier's preset. */
const ANCHOR: Record<QualityTier, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };

/** The look for a graphics level (the frame's by default). */
export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  const b = BUDGETS[preset];
  // Particle counts grow with the level's particle budget above the tier's anchor, at most 2×.
  const k = Math.min(2, s.particles / levelSettings(ANCHOR[preset]).particles);
  return {
    preset, ...ART[preset],
    shadows: s.shadows ? s.shadowMapSize : 0,
    ao: s.ao && { resolution: s.ao.resolution, samples: s.ao.samples, denoiseSamples: s.ao.denoiseSamples },
    bloom: s.bloom ? s.bloom.resolution : null,
    grade: s.grade,
    antialias: s.antialias,
    budget: { ...b, texture: Math.min(b.texture, s.maxTextureSize) as Budget["texture"],
      sparks: Math.min(SPARK_MAX, Math.round(b.sparks * k)), motes: Math.min(MOTE_MAX, Math.round(b.motes * k)) },
  };
}
