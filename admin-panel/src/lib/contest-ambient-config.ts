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
import {
  AMBIENT_ORNAMENT_IDS,
  AMBIENT_TEXTURE_IDS,
  DEFAULT_AMBIENT_CONFIG,
  type AmbientConfig,
} from '@/lib/contest-ambient';

/** Inclusive band a parsed value must land in to be used at all. */
interface TuningSource {
  readonly key: string;
  readonly fallback: number;
  readonly min: number;
  readonly max: number;
}

/** A choice key: resolved against a known set of names, falling back to 'auto'. */
interface ChoiceSource<Name extends string> {
  readonly key: string;
  readonly allowed: readonly Name[];
}

export const AMBIENT_CHOICE_SOURCES = {
  textureId: { key: 'COUNTDOWN_AMBIENT_TEXTURE', allowed: [...AMBIENT_TEXTURE_IDS, 'auto'] },
  ornamentId: { key: 'COUNTDOWN_ORNAMENT', allowed: [...AMBIENT_ORNAMENT_IDS, 'auto'] },
} as const satisfies Record<'textureId' | 'ornamentId', ChoiceSource<string>>;

/** Resolves one choice key, falling back to 'auto' when it names nothing known. */
export function resolveAmbientChoice<Name extends string>(source: ChoiceSource<Name>): Name | 'auto' {
  const raw = process.env[source.key]?.trim().toLowerCase();
  const match = source.allowed.find((candidate) => candidate.toLowerCase() === raw);
  return match ?? 'auto';
}

type NumericTuningKey = Exclude<keyof AmbientConfig, 'textureId' | 'ornamentId'>;

export const AMBIENT_TUNING_SOURCES: Readonly<Record<NumericTuningKey, TuningSource>> = {
  rerollMs: { key: 'COUNTDOWN_AMBIENT_REROLL_MS', fallback: DEFAULT_AMBIENT_CONFIG.rerollMs, min: 1_000, max: 3_600_000 },
  itemScale: { key: 'COUNTDOWN_AMBIENT_ITEM_SCALE', fallback: DEFAULT_AMBIENT_CONFIG.itemScale, min: 0.4, max: 2.5 },
  growthGain: { key: 'COUNTDOWN_AMBIENT_GROWTH_GAIN', fallback: DEFAULT_AMBIENT_CONFIG.growthGain, min: 0, max: 2 },
  markRevealMs: {
    key: 'COUNTDOWN_MARK_REVEAL_MS',
    fallback: DEFAULT_AMBIENT_CONFIG.markRevealMs,
    min: 600,
    max: 20_000,
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
    markRevealMs: resolveAmbientTuning(AMBIENT_TUNING_SOURCES.markRevealMs),
    textureId: resolveAmbientChoice(AMBIENT_CHOICE_SOURCES.textureId),
    ornamentId: resolveAmbientChoice(AMBIENT_CHOICE_SOURCES.ornamentId),
    fallbackProgressMs: resolveAmbientTuning(AMBIENT_TUNING_SOURCES.fallbackProgressMs),
    maxFramesPerSecond: resolveAmbientTuning(AMBIENT_TUNING_SOURCES.maxFramesPerSecond),
    driftExtentRatio: resolveAmbientTuning(AMBIENT_TUNING_SOURCES.driftExtentRatio),
  };
}
