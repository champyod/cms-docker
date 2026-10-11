'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useReducedMotion } from 'motion/react';
import {
  DEFAULT_AMBIENT_CONFIG,
  ambientDensityScale,
  clampItemScale,
  isAmbientRampComplete,
  resolveAmbientProgress,
  resolveAmbientStep,
  rollAmbient,
  type AmbientConfig,
  type AmbientRoll,
  type AmbientTextureIdChoice,
} from '@/lib/contest-ambient';

interface UseAmbientOptions {
  /** The threshold instant, or null where the countdown has no target to measure to. */
  readonly thresholdMs: number | null;
  readonly nowMs: number;
  readonly isPaused: boolean;
  /** Changes when the surface's state changes, which triggers a fresh roll. */
  readonly rerollKey: string;
  readonly config?: AmbientConfig;
}

export interface AmbientView {
  readonly roll: AmbientRoll;
  readonly progress: number;
  /** 0 to 5, in 20% steps up to the threshold. */
  readonly step: number;
  /** Grows with the step, so the field's objects enlarge as the moment nears. */
  readonly density: number;
  /** Base size of every object the field draws. */
  readonly itemScale: number;
  readonly isRampComplete: boolean;
  readonly isAnimating: boolean;
  /** False until the first roll has landed, so nothing paints a placeholder texture. */
  readonly isRolled: boolean;
}

/**
 * The current roll as an external store. Keeping it outside React is what lets the seed
 * be drawn without a render-time Math.random — which Next.js fails the build on — and
 * without a setState inside an effect, which cascades renders.
 *
 * The ramp anchor is deliberately separate from the roll. The roll changes often, for
 * variety; the ramp is measured from the start of the state to the threshold, so it must
 * survive every re-roll or it could never reach its last step.
 */
interface AmbientStore {
  roll: AmbientRoll | null;
  /** When the current blur ramp began: on entry, or when the state changed. */
  rampAnchorMs: number | null;
}

let store: AmbientStore = { roll: null, rampAnchorMs: null };

/**
 * The pinned texture, when the deployment names one. Held in a module variable because the
 * roll is drawn outside React, and set by the hook below before any roll happens.
 */
let pinnedTextureId: AmbientTextureIdChoice = 'auto';
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribeAmbientRoll(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

function readAmbientRoll(): AmbientRoll | null {
  return store.roll;
}

/**
 * Draws a new roll. Called from effects and events, never during render. Restarting the
 * ramp is for a state change, where the field's progress legitimately begins again.
 */
/** Pins the texture the next roll will use; 'auto' returns it to the seeded draw. */
export function pinAmbientTexture(textureId: AmbientTextureIdChoice): void {
  pinnedTextureId = textureId;
}

export function rollAmbientNow(restartRamp: boolean): void {
  store = {
    roll: rollAmbient(Math.random(), pinnedTextureId),
    rampAnchorMs: restartRamp || store.rampAnchorMs === null ? Date.now() : store.rampAnchorMs,
  };
  emit();
}

/**
 * The seed the current roll came from, as an external store. The ended screen's ornament is
 * drawn from it too, so one roll decides the whole screen rather than each layer rolling apart.
 */
export function useAmbientSeed(): number {
  const roll = useSyncExternalStore(subscribeAmbientRoll, readAmbientRoll, () => null);
  return roll?.seed ?? 0;
}

/** Reads the instant the blur ramp began, which is what its progress is measured from. */
function readAmbientRampAnchor(): number | null {
  return store.rampAnchorMs;
}

/**
 * The roll and the blur schedule for the ambient field.
 *
 * A reader who is paused or who asked for reduced motion keeps the roll they have: the
 * roll is what changes the colour and the texture, so redrawing it is the motion they
 * declined. The blur still advances, because it reports the real deadline.
 */
export function useContestAmbient({
  thresholdMs,
  nowMs,
  isPaused,
  rerollKey,
  config = DEFAULT_AMBIENT_CONFIG,
}: UseAmbientOptions): AmbientView {
  const prefersReducedMotion = useReducedMotion() ?? false;
  const shouldHoldStill = isPaused || prefersReducedMotion;
  const rollSeed = useSyncExternalStore(subscribeAmbientRoll, readAmbientRoll, () => null);
  const rampAnchorMs = useSyncExternalStore(subscribeAmbientRoll, readAmbientRampAnchor, () => null);

  // Roll on entry, and start the ramp here too. This writes to the external store rather
  // than to React state, so the seed is never drawn during a render the server also runs.
  useEffect(() => {
    pinAmbientTexture(config.textureId);
    rollAmbientNow(true);
  }, [config.textureId]);

  // Roll again while time simply passes. The ramp is left alone, so the blur keeps its
  // place: a fresh roll only changes which colour and texture carry it.
  useEffect(() => {
    if (shouldHoldStill) return;
    const interval = window.setInterval(() => rollAmbientNow(false), config.rerollMs);
    return () => window.clearInterval(interval);
  }, [shouldHoldStill, config.rerollMs]);

  // Roll on a state change, and restart the ramp with it, since the field's progress
  // begins again from the new state.
  useEffect(() => {
    if (shouldHoldStill) return;
    rollAmbientNow(true);
  }, [rerollKey, shouldHoldStill]);

  // The fallback is only ever seen for the first paint, before the entry roll lands.
  const roll = useMemo(() => rollSeed ?? rollAmbient(0, config.textureId), [rollSeed, config.textureId]);
  const progress = resolveAmbientProgress({
    startedAtMs: rampAnchorMs,
    completeAtMs: thresholdMs,
    nowMs,
    fallbackMs: config.fallbackProgressMs,
  });
  const step = resolveAmbientStep(progress);

  return {
    roll,
    progress,
    step,
    density: ambientDensityScale(step, config.growthGain),
    isRampComplete: isAmbientRampComplete(step),
    itemScale: clampItemScale(config.itemScale),
    isAnimating: rollSeed !== null && !shouldHoldStill,
    isRolled: rollSeed !== null,
  };
}
