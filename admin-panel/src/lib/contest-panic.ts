import type { CountdownStage } from '@/lib/contest-countdown';

/**
 * The timer's panic at the threshold. The shake itself is animate.css's own
 * `shakeX` keyframes plus its `animated`/`infinite` driving classes, imported in
 * `globals.css`; this module only decides when the timer panics and how fast.
 */

export interface ContestPanicConfig {
  readonly durationSeconds: number;
  readonly animationName: string;
}

export const DEFAULT_CONTEST_PANIC_CONFIG: ContestPanicConfig = {
  durationSeconds: 0.85,
  animationName: 'shakeX',
};

const PANIC_BASE_CLASSES = ['animated', 'infinite'] as const;

/** The threshold stage, in every phase: it is the one visual the running state keeps. */
export function shouldPanic(stage: CountdownStage, isPaused: boolean): boolean {
  return stage === 'hurry' && !isPaused;
}

/** The driver classes for the panic, or an empty list when the timer is at rest. */
export function panicClassNames(
  isPanicking: boolean,
  config: ContestPanicConfig = DEFAULT_CONTEST_PANIC_CONFIG,
): readonly string[] {
  return isPanicking ? [...PANIC_BASE_CLASSES, config.animationName] : [];
}
