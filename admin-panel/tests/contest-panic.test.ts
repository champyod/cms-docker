import { describe, expect, it } from 'vitest';

import {
  CONTEST_PANIC_ANIMATION_NAMES,
  DEFAULT_CONTEST_PANIC_CONFIG,
  panicAnimationFor,
  panicDigitClassNames,
  panicDigitStyle,
  panicDurationFor,
  panicStaggerFor,
  shouldPanic,
} from '@/lib/contest-panic';
import type { CountdownStage } from '@/lib/contest-countdown';

const ALL_STAGES: readonly CountdownStage[] = ['waiting', 'running', 'analysis', 'hurry', 'ended'];
const DIGITS = [0, 1, 2, 3, 4];

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
  it('spans translation, rotation and skew, not translation alone', () => {
    expect(CONTEST_PANIC_ANIMATION_NAMES).toContain('shakeX');
    expect(CONTEST_PANIC_ANIMATION_NAMES).toContain('headShake');
    expect(CONTEST_PANIC_ANIMATION_NAMES).toContain('swing');
    expect(CONTEST_PANIC_ANIMATION_NAMES).toContain('jello');
  });

  it('leaves out the motions that displace or scale too far to stay legible', () => {
    expect(CONTEST_PANIC_ANIMATION_NAMES).not.toContain('wobble');
    expect(CONTEST_PANIC_ANIMATION_NAMES).not.toContain('tada');
  });

  it('carries enough motions that neighbouring digits rarely coincide', () => {
    expect(CONTEST_PANIC_ANIMATION_NAMES.length).toBeGreaterThanOrEqual(4);
  });
});

describe('panicAnimationFor', () => {
  it('is stable for a digit on a turn, so a render is reproducible', () => {
    expect(panicAnimationFor(2, 3)).toBe(panicAnimationFor(2, 3));
  });

  it('never names a motion outside its cast', () => {
    for (let turn = 0; turn < 40; turn += 1) {
      for (const digit of DIGITS) {
        expect(CONTEST_PANIC_ANIMATION_NAMES).toContain(panicAnimationFor(digit, turn));
      }
    }
  });

  it('gives the digits of one row different motions rather than one shared motion', () => {
    const row = DIGITS.map((digit) => panicAnimationFor(digit, 0));
    expect(new Set(row).size).toBeGreaterThan(1);
  });

  it('reaches every motion in the cast over a run of turns', () => {
    const seen = new Set<string>();
    for (let turn = 0; turn < 400; turn += 1) seen.add(panicAnimationFor(turn % 8, turn));
    expect(seen.size).toBe(CONTEST_PANIC_ANIMATION_NAMES.length);
  });

  it('hands a digit a new motion as the turn advances', () => {
    const sequence = Array.from({ length: 6 }, (_unused, turn) => panicAnimationFor(0, turn));
    expect(new Set(sequence).size).toBeGreaterThan(1);
  });

  it('takes its cast from config, and falls back rather than throwing on an empty one', () => {
    expect(panicAnimationFor(0, 0, { durationSeconds: 1, staggerSeconds: 0, animationNames: ['jello'] })).toBe('jello');
    expect(CONTEST_PANIC_ANIMATION_NAMES).toContain(
      panicAnimationFor(0, 0, { durationSeconds: 1, staggerSeconds: 0, animationNames: [] }),
    );
  });
});

describe('the per-digit stagger', () => {
  it('does not start every digit at the same instant', () => {
    const offsets = DIGITS.map((digit) => panicStaggerFor(digit, 0));
    expect(new Set(offsets.map((value) => value.toFixed(3))).size).toBeGreaterThan(1);
  });

  it('keeps every offset inside the configured spread', () => {
    for (let turn = 0; turn < 50; turn += 1) {
      for (const digit of DIGITS) {
        const offset = panicStaggerFor(digit, turn);
        expect(offset).toBeGreaterThanOrEqual(0);
        expect(offset).toBeLessThanOrEqual(DEFAULT_CONTEST_PANIC_CONFIG.staggerSeconds);
      }
    }
  });

  it('starts at once when the spread is zero', () => {
    const config = { durationSeconds: 0.6, staggerSeconds: 0, animationNames: CONTEST_PANIC_ANIMATION_NAMES };
    for (const digit of DIGITS) expect(panicStaggerFor(digit, 0, config)).toBe(0);
  });
});

describe('the per-digit duration', () => {
  it('varies around the base, so the row does not beat in unison', () => {
    const durations = DIGITS.map((digit) => panicDurationFor(digit, 0));
    expect(new Set(durations.map((value) => value.toFixed(3))).size).toBeGreaterThan(1);
  });

  it('stays near the base rather than running away from it', () => {
    for (let turn = 0; turn < 50; turn += 1) {
      for (const digit of DIGITS) {
        const duration = panicDurationFor(digit, turn);
        expect(duration).toBeGreaterThan(DEFAULT_CONTEST_PANIC_CONFIG.durationSeconds * 0.8);
        expect(duration).toBeLessThan(DEFAULT_CONTEST_PANIC_CONFIG.durationSeconds * 1.2);
      }
    }
  });
});

describe('panicDigitStyle', () => {
  it('carries the motion, its delay, its amplitude and its duration for one digit', () => {
    const style = panicDigitStyle(true, 1, 2);
    expect(style).toBeDefined();
    expect(CONTEST_PANIC_ANIMATION_NAMES).toContain(style?.['--countdown-panic-name']);
    expect(style?.['--countdown-panic-delay']).toMatch(/s$/);
    expect(style?.['--animate-duration']).toMatch(/s$/);
  });

  it('names a different motion per digit, which is what makes it per letter', () => {
    const names = DIGITS.map((digit) => panicDigitStyle(true, digit, 0)?.['--countdown-panic-name']);
    expect(new Set(names).size).toBeGreaterThan(1);
  });

  it('gives no style at all when the timer is at rest', () => {
    expect(panicDigitStyle(false, 0, 0)).toBeUndefined();
  });
});

describe('panicDigitClassNames', () => {
  it('drives the motion through the library classes rather than a hand-rolled animation', () => {
    expect(panicDigitClassNames(true)).toStrictEqual(['animated', 'infinite', 'is-panicking']);
  });

  it('applies nothing when the timer is at rest', () => {
    expect(panicDigitClassNames(false)).toStrictEqual([]);
  });
});
