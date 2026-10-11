import type { CountdownStage } from '@/lib/contest-countdown';

/**
 * The timer's panic at the threshold. The shake itself is animate.css's own keyframes,
 * imported in `globals.css`; this module decides which of them to use, when the timer
 * panics, and how fast. The library's `_base.css` also carries the reduced-motion rule,
 * which is why the panic is driven through its `animated`/`infinite` classes rather than
 * a hand-rolled animation.
 */

/**
 * Every shake animate.css ships. Using the whole cast is what makes the panic read as a
 * struggle rather than a metronome, and it is the only way to get motion on both axes:
 * `shakeY` moves the timer along the other axis and `headShake` adds a turn. They are
 * named here rather than chosen ad hoc, because the stylesheet has to import each one.
 */
export const CONTEST_PANIC_ANIMATION_NAMES = ['shakeX', 'shakeY', 'headShake'] as const;

export type ContestPanicAnimationName = (typeof CONTEST_PANIC_ANIMATION_NAMES)[number];

export interface ContestPanicConfig {
  readonly durationSeconds: number;
  /** Rotation must be off when a variant turns the timer, or the transform clobbers it. */
  readonly animationNames: readonly ContestPanicAnimationName[];
}

export const DEFAULT_CONTEST_PANIC_CONFIG: ContestPanicConfig = {
  durationSeconds: 0.85,
  animationNames: CONTEST_PANIC_ANIMATION_NAMES,
};

const PANIC_BASE_CLASSES = ['animated', 'infinite'] as const;

export const PANIC_VARIANT_INTERVAL_MS = 850;

/**
 * The threshold stage, in every phase: it is the one visual the running state keeps.
 * A paused reader, or one who asked for reduced motion, gets a still timer.
 */
export function shouldPanic(stage: CountdownStage, isPaused: boolean): boolean {
  return stage === 'hurry' && !isPaused;
}

/**
 * Which shake to play. The turn is a counter rather than a random draw, so the same
 * sequence is reproducible in a test and cannot run during a server render.
 */
export function panicAnimationName(
  turn: number,
  config: ContestPanicConfig = DEFAULT_CONTEST_PANIC_CONFIG,
): ContestPanicAnimationName {
  const names = config.animationNames.length > 0 ? config.animationNames : DEFAULT_CONTEST_PANIC_CONFIG.animationNames;
  const bounded = Number.isFinite(turn) ? Math.floor(turn) : 0;
  return names[((bounded % names.length) + names.length) % names.length];
}

/** The driver classes for one shake, or an empty list when the timer is at rest. */
export function panicClassNames(
  isPanicking: boolean,
  turn = 0,
  config: ContestPanicConfig = DEFAULT_CONTEST_PANIC_CONFIG,
): readonly string[] {
  if (!isPanicking) return [];
  return [...PANIC_BASE_CLASSES, panicAnimationName(turn, config)];
}
