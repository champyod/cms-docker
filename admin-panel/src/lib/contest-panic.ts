import type { CountdownStage } from '@/lib/contest-countdown';

/**
 * The timer's panic at the threshold.
 *
 * Every motion below is an animate.css keyframe set, imported in `globals.css`; this module
 * chooses which of them each digit plays and when. That keeps the panic on a proven prebuilt
 * technique rather than a hand-rolled animation, and brings the library's own reduced-motion
 * handling with it.
 *
 * The digits panic one at a time rather than the block moving as a single unit, so the timer
 * reads as something coming apart instead of a metronome. The cast deliberately spans more
 * than translation: rotation, skew and scale are what make it read as an animated sequence
 * rather than a wobble.
 *
 * The cast is kept to motions that stay legible while they play. `wobble` and `tada` are
 * left out: both displace by a share of the element and both scale past 1.1, which at this
 * size reads as broken rather than urgent, and neither can be quietened without also
 * disturbing the row's layout.
 */
export const CONTEST_PANIC_ANIMATION_NAMES = [
  'headShake',
  'swing',
  'jello',
  'shakeX',
  'shakeY',
] as const;

export type ContestPanicAnimationName = (typeof CONTEST_PANIC_ANIMATION_NAMES)[number];

export interface ContestPanicConfig {
  /** Base duration; each digit varies around it so the row never beats in unison. */
  readonly durationSeconds: number;
  /** Spread of the per-digit stagger, in seconds. */
  readonly staggerSeconds: number;
  readonly animationNames: readonly ContestPanicAnimationName[];
}

export const DEFAULT_CONTEST_PANIC_CONFIG: ContestPanicConfig = {
  durationSeconds: 0.62,
  staggerSeconds: 0.34,
  animationNames: CONTEST_PANIC_ANIMATION_NAMES,
};

/** How often every digit is handed a new motion and a new offset. */
export const PANIC_VARIANT_INTERVAL_MS = 620;

/** Duration spread either side of the base, as a fraction, so the row never syncs up. */
const PANIC_DURATION_SPREAD = 0.3;

/**
 * The threshold stage, in every phase: it is the one visual the running state keeps.
 * A paused reader, or one who asked for reduced motion, gets a still timer.
 */
export function shouldPanic(stage: CountdownStage, isPaused: boolean): boolean {
  return stage === 'hurry' && !isPaused;
}

/**
 * A well-mixed fraction for one small integer seed. Used instead of Math.random because the
 * panic must be reproducible, and because nothing may be drawn during a server render.
 * The multipliers are the mixing constants from a mulberry-style generator.
 */
function hashUnit(seed: number): number {
  let mixed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d);
  mixed = Math.imul(mixed ^ (mixed >>> 12), 0x297a2d39);
  return ((mixed ^ (mixed >>> 15)) >>> 0) / 0x1_0000_0000;
}

/** Odd multiplier, so neighbouring digits land far apart in the hash rather than in sequence. */
const DIGIT_SEED_STRIDE = 0x9e37_79b1;
const TURN_SEED_STRIDE = 0x85eb_ca6b;

function digitSeed(digitIndex: number, turn: number): number {
  return Math.imul(digitIndex, DIGIT_SEED_STRIDE) ^ Math.imul(turn, TURN_SEED_STRIDE);
}

/** Which motion one digit plays on a given turn; adjacent digits do not share one. */
export function panicAnimationFor(
  digitIndex: number,
  turn: number,
  config: ContestPanicConfig = DEFAULT_CONTEST_PANIC_CONFIG,
): ContestPanicAnimationName {
  const names = config.animationNames.length > 0
    ? config.animationNames
    : DEFAULT_CONTEST_PANIC_CONFIG.animationNames;
  const bucket = Math.floor(hashUnit(digitSeed(digitIndex, turn)) * names.length);
  return names[Math.min(names.length - 1, bucket)];
}

/**
 * How long one digit waits before it starts, in seconds. The stagger is what stops every
 * letter from firing at the same instant, which is the whole point of panicking per digit.
 */
export function panicStaggerFor(
  digitIndex: number,
  turn: number,
  config: ContestPanicConfig = DEFAULT_CONTEST_PANIC_CONFIG,
): number {
  return hashUnit(digitSeed(digitIndex, turn) ^ 0x5bf0_3635) * config.staggerSeconds;
}

/** One digit's duration in seconds, varied around the base so the row does not beat in unison. */
export function panicDurationFor(
  digitIndex: number,
  turn: number,
  config: ContestPanicConfig = DEFAULT_CONTEST_PANIC_CONFIG,
): number {
  const unit = hashUnit(digitSeed(digitIndex, turn) ^ 0x27d4_eb2d);
  return config.durationSeconds * (1 - PANIC_DURATION_SPREAD / 2 + unit * PANIC_DURATION_SPREAD);
}

/**
 * Custom properties are not part of React's own CSSProperties, so the style object is
 * typed by its keys and cast once here rather than at every call site.
 */
export interface PanicDigitStyle extends Record<string, string> {
  '--countdown-panic-name': string;
  '--countdown-panic-delay': string;
  '--animate-duration': string;
}

/** The per-digit custom properties the stylesheet reads; a digit at rest gets none. */
export function panicDigitStyle(
  isPanicking: boolean,
  digitIndex: number,
  turn: number,
  config: ContestPanicConfig = DEFAULT_CONTEST_PANIC_CONFIG,
): PanicDigitStyle | undefined {
  if (!isPanicking) return undefined;
  return {
    '--countdown-panic-name': panicAnimationFor(digitIndex, turn, config),
    '--countdown-panic-delay': `${panicStaggerFor(digitIndex, turn, config).toFixed(3)}s`,
    '--animate-duration': `${panicDurationFor(digitIndex, turn, config).toFixed(3)}s`,
  };
}

/** The classes the animating element carries while panicking, or none when it is at rest. */
export function panicDigitClassNames(isPanicking: boolean): readonly string[] {
  return isPanicking ? ['animated', 'infinite', 'is-panicking'] : [];
}
