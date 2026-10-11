/**
 * The one place the countdown surface's ambient tuning is read from.
 *
 * Server-only by construction: the ambient layer is a Client Component, so reading the
 * environment there would bundle the values into the browser bundle and would not pick
 * up a runtime change. The countdown page reads this and passes the result down as a
 * plain object of numbers, which is why nothing under `components/` imports this module.
 *
 * WHY from the environment and never as a literal: each of these is a config.toml key
 * ([admin]) that config sync and compose deliver to this container, so an operator
 * retunes the idle screen on a running deployment without rebuilding the image. The
 * fallback below is the fail-safe for a key that is absent or unusable — never the
 * intended value — because a re-roll interval resolving to NaN would stop the re-roll
 * outright, and a zero frame cap would leave the field frozen.
 */
import { DEFAULT_AMBIENT_CONFIG, type AmbientConfig } from '@/lib/contest-ambient';

/** Inclusive band a parsed value must land in to be used at all. */
interface TuningSource {
  readonly key: string;
  readonly fallback: number;
  readonly min: number;
  readonly max: number;
}

export const AMBIENT_TUNING_SOURCES: Readonly<Record<keyof AmbientConfig, TuningSource>> = {
  rerollMs: { key: 'COUNTDOWN_AMBIENT_REROLL_MS', fallback: DEFAULT_AMBIENT_CONFIG.rerollMs, min: 1_000, max: 3_600_000 },
  itemScale: { key: 'COUNTDOWN_AMBIENT_ITEM_SCALE', fallback: DEFAULT_AMBIENT_CONFIG.itemScale, min: 0.4, max: 2.5 },
  growthGain: { key: 'COUNTDOWN_AMBIENT_GROWTH_GAIN', fallback: DEFAULT_AMBIENT_CONFIG.growthGain, min: 0, max: 2 },
  ornamentRotationMs: {
    key: 'COUNTDOWN_ORNAMENT_ROTATION_MS',
    fallback: DEFAULT_AMBIENT_CONFIG.ornamentRotationMs,
    min: 4_000,
    max: 180_000,
  },
  fallbackProgressMs: {
    key: 'COUNTDOWN_AMBIENT_FALLBACK_PROGRESS_MS',
    fallback: DEFAULT_AMBIENT_CONFIG.fallbackProgressMs,
    min: 1_000,
    max: 3_600_000,
  },
  maxFramesPerSecond: { key: 'COUNTDOWN_AMBIENT_MAX_FPS', fallback: DEFAULT_AMBIENT_CONFIG.maxFramesPerSecond, min: 1, max: 120 },
  driftExtentRatio: { key: 'COUNTDOWN_AMBIENT_DRIFT_RATIO', fallback: DEFAULT_AMBIENT_CONFIG.driftExtentRatio, min: 0, max: 0.5 },
};

/** Resolves one key, falling back whenever it is absent, unparseable or out of band. */
export function resolveAmbientTuning(source: TuningSource): number {
  const raw = process.env[source.key];
  if (raw === undefined || raw.trim() === '') return source.fallback;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed < source.min || parsed > source.max) return source.fallback;
  return parsed;
}

/** The ambient tuning the surface runs with, read once per server render. */
export function resolveCountdownAmbientConfig(): AmbientConfig {
  return {
    rerollMs: resolveAmbientTuning(AMBIENT_TUNING_SOURCES.rerollMs),
    itemScale: resolveAmbientTuning(AMBIENT_TUNING_SOURCES.itemScale),
    growthGain: resolveAmbientTuning(AMBIENT_TUNING_SOURCES.growthGain),
    ornamentRotationMs: resolveAmbientTuning(AMBIENT_TUNING_SOURCES.ornamentRotationMs),
    fallbackProgressMs: resolveAmbientTuning(AMBIENT_TUNING_SOURCES.fallbackProgressMs),
    maxFramesPerSecond: resolveAmbientTuning(AMBIENT_TUNING_SOURCES.maxFramesPerSecond),
    driftExtentRatio: resolveAmbientTuning(AMBIENT_TUNING_SOURCES.driftExtentRatio),
  };
}
