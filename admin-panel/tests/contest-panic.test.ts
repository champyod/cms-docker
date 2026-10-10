import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CONTEST_PANIC_CONFIG,
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

describe('panicClassNames', () => {
  it('drives the shake through the library classes rather than a hand-rolled animation', () => {
    expect(panicClassNames(true)).toStrictEqual(['animated', 'infinite', DEFAULT_CONTEST_PANIC_CONFIG.animationName]);
  });

  it('names the library animation the brief asks for', () => {
    expect(DEFAULT_CONTEST_PANIC_CONFIG.animationName).toBe('shakeX');
  });

  it('applies no classes at all when the timer is at rest', () => {
    expect(panicClassNames(false)).toStrictEqual([]);
  });

  it('takes the animation name from its config, so a swap needs no code change', () => {
    const swapped = { durationSeconds: 1.2, animationName: 'headShake' };
    expect(panicClassNames(true, swapped)).toContain('headShake');
    expect(panicClassNames(true, swapped)).not.toContain(DEFAULT_CONTEST_PANIC_CONFIG.animationName);
  });
});
