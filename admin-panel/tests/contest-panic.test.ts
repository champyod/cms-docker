import { describe, expect, it } from 'vitest';

import {
  CONTEST_PANIC_ANIMATION_NAMES,
  DEFAULT_CONTEST_PANIC_CONFIG,
  panicAnimationName,
  panicClassNames,
  shouldPanic,
} from '@/lib/contest-panic';
import type { CountdownStage } from '@/lib/contest-countdown';

const ALL_STAGES: readonly CountdownStage[] = ['waiting', 'running', 'analysis', 'hurry', 'ended'];

describe('shouldPanic', () => {
  it('panics only at the threshold stage', () => {
    for (const stage of ALL_STAGES) {
      expect(shouldPanic(stage, false)).toBe(stage === 'hurry');
    }
  });

  it('keeps panicking in the running phase, which carries no other idle visual', () => {
    expect(shouldPanic('hurry', false)).toBe(true);
  });

  it('stops as soon as the reader pauses the surface', () => {
    for (const stage of ALL_STAGES) {
      expect(shouldPanic(stage, true)).toBe(false);
    }
  });
});

describe('the panic cast', () => {
  it('covers more than one axis, so the timer does not merely thud sideways', () => {
    expect(CONTEST_PANIC_ANIMATION_NAMES).toContain('shakeX');
    expect(CONTEST_PANIC_ANIMATION_NAMES).toContain('shakeY');
    expect(CONTEST_PANIC_ANIMATION_NAMES.length).toBeGreaterThan(1);
  });

  it('turns the timer as well, which no single shake variant does on its own', () => {
    expect(CONTEST_PANIC_ANIMATION_NAMES).toContain('headShake');
  });
});

describe('panicAnimationName', () => {
  it('cycles through every shake as the turn advances', () => {
    const seen = new Set(
      Array.from({ length: CONTEST_PANIC_ANIMATION_NAMES.length }, (_unused, turn) => panicAnimationName(turn)),
    );
    expect(seen.size).toBe(CONTEST_PANIC_ANIMATION_NAMES.length);
  });

  it('is stable for a given turn, so a render is reproducible', () => {
    expect(panicAnimationName(2)).toBe(panicAnimationName(2));
  });

  it('wraps rather than running out of shakes', () => {
    expect(panicAnimationName(CONTEST_PANIC_ANIMATION_NAMES.length)).toBe(panicAnimationName(0));
    expect(panicAnimationName(101)).toBe(panicAnimationName(101 % CONTEST_PANIC_ANIMATION_NAMES.length));
  });

  it('survives a negative or non-finite turn', () => {
    expect(CONTEST_PANIC_ANIMATION_NAMES).toContain(panicAnimationName(-3));
    expect(CONTEST_PANIC_ANIMATION_NAMES).toContain(panicAnimationName(Number.NaN));
  });

  it('takes its cast from config, so a swap needs no code change', () => {
    const single = { durationSeconds: 1, animationNames: ['shakeY'] as const };
    expect(panicAnimationName(0, single)).toBe('shakeY');
    expect(panicAnimationName(9, single)).toBe('shakeY');
  });

  it('falls back to the default cast rather than throwing on an empty one', () => {
    const empty = { durationSeconds: 1, animationNames: [] as const };
    expect(CONTEST_PANIC_ANIMATION_NAMES).toContain(panicAnimationName(0, empty));
  });
});

describe('panicClassNames', () => {
  it('drives the shake through the library classes rather than a hand-rolled animation', () => {
    expect(panicClassNames(true, 0)).toStrictEqual(['animated', 'infinite', 'shakeX']);
  });

  it('leads with the shake the brief names', () => {
    expect(panicClassNames(true, 0)).toContain('shakeX');
    expect(DEFAULT_CONTEST_PANIC_CONFIG.animationNames[0]).toBe('shakeX');
  });

  it('applies no classes at all when the timer is at rest', () => {
    expect(panicClassNames(false, 0)).toStrictEqual([]);
    expect(panicClassNames(false, 7)).toStrictEqual([]);
  });

  it('changes which shake is applied as the turn advances', () => {
    expect(panicClassNames(true, 0)).not.toStrictEqual(panicClassNames(true, 1));
  });
});
