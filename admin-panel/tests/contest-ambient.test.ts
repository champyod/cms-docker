import { describe, expect, it } from 'vitest';

import {
  AMBIENT_PALETTES,
  AMBIENT_STEP_COUNT,
  AMBIENT_TEXTURES,
  DEFAULT_AMBIENT_CONFIG,
  ambientColor,
  ambientDensityScale,
  clampOrnamentRotationMs,
  rollOrnament,
  AMBIENT_ORNAMENT_IDS,
  createAmbientRandom,
  isAmbientRampComplete,
  resolveAmbientStep,
  resolveAmbientProgress,
  rollAmbient,
} from '@/lib/contest-ambient';
import { createAmbientNoise } from '@/lib/contest-ambient-noise';

const FALLBACK_MS = 60_000;

describe('rollAmbient', () => {
  it('gives the same roll for the same seed, so a roll is reproducible', () => {
    expect(rollAmbient(0.42)).toStrictEqual(rollAmbient(0.42));
  });

  it('picks colour and texture from the one draw', () => {
    const roll = rollAmbient(0.31);
    expect(AMBIENT_TEXTURES.map((texture) => texture.id)).toContain(roll.texture.id);
    expect(AMBIENT_PALETTES.map((palette) => palette.id)).toContain(roll.palette.id);
  });

  it('reaches every texture over a spread of seeds', () => {
    const seen = new Set(
      Array.from({ length: 200 }, (_unused, index) => rollAmbient(index / 200).texture.id),
    );
    expect(seen.size).toBe(AMBIENT_TEXTURES.length);
  });

  it('keeps every pace inside the texture\u2019s own range', () => {
    for (let index = 0; index < 200; index += 1) {
      const roll = rollAmbient(index / 200);
      const [slowest, fastest] = roll.texture.driftSecondsRange;
      expect(roll.driftSeconds).toBeGreaterThanOrEqual(slowest);
      expect(roll.driftSeconds).toBeLessThanOrEqual(fastest);
    }
  });

  it('draws differently for different seeds', () => {
    const first = rollAmbient(0.1);
    const second = rollAmbient(0.9);
    expect([first.texture.id, first.palette.id]).not.toStrictEqual([second.texture.id, second.palette.id]);
  });
});

describe('createAmbientRandom', () => {
  it('is a pure stream: same seed, same sequence', () => {
    const first = Array.from({ length: 8 }, createAmbientRandom(0.7));
    const second = Array.from({ length: 8 }, createAmbientRandom(0.7));
    expect(first).toStrictEqual(second);
  });

  it('stays inside the unit interval', () => {
    const random = createAmbientRandom(0.5);
    for (let index = 0; index < 500; index += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('resolveAmbientProgress', () => {
  it('starts at nothing before the first roll', () => {
    expect(resolveAmbientProgress({ startedAtMs: null, completeAtMs: 100, nowMs: 50, fallbackMs: FALLBACK_MS })).toBe(0);
  });

  it('reaches one exactly at the threshold', () => {
    const params = { startedAtMs: 0, completeAtMs: 60_000, nowMs: 60_000, fallbackMs: FALLBACK_MS };
    expect(resolveAmbientProgress(params)).toBe(1);
  });

  it('climbs linearly over the distance to the threshold', () => {
    expect(resolveAmbientProgress({ startedAtMs: 0, completeAtMs: 100, nowMs: 25, fallbackMs: FALLBACK_MS })).toBe(0.25);
    expect(resolveAmbientProgress({ startedAtMs: 0, completeAtMs: 100, nowMs: 50, fallbackMs: FALLBACK_MS })).toBe(0.5);
  });

  it('stays at one past the threshold rather than overshooting', () => {
    expect(resolveAmbientProgress({ startedAtMs: 0, completeAtMs: 100, nowMs: 900, fallbackMs: FALLBACK_MS })).toBe(1);
  });

  it('falls back to elapsed time where there is no threshold to measure to', () => {
    expect(resolveAmbientProgress({ startedAtMs: 0, completeAtMs: null, nowMs: FALLBACK_MS / 2, fallbackMs: FALLBACK_MS }))
      .toBe(0.5);
  });

  it('ignores a non-finite clock instead of emitting NaN', () => {
    expect(resolveAmbientProgress({ startedAtMs: 0, completeAtMs: 100, nowMs: Number.NaN, fallbackMs: FALLBACK_MS })).toBe(0);
  });
});

describe('the 20% ramp steps', () => {
  it('quantises progress into exactly five steps', () => {
    expect(AMBIENT_STEP_COUNT).toBe(5);
    expect(resolveAmbientStep(0)).toBe(0);
    expect(resolveAmbientStep(0.19)).toBe(0);
    expect(resolveAmbientStep(0.2)).toBe(1);
    expect(resolveAmbientStep(0.99)).toBe(4);
    expect(resolveAmbientStep(1)).toBe(5);
  });

  it('never leaves the step range, however odd the progress', () => {
    for (const progress of [-5, -0.01, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const step = resolveAmbientStep(progress);
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThanOrEqual(AMBIENT_STEP_COUNT);
    }
  });

  it('completes at the last step and at no earlier one', () => {
    expect(isAmbientRampComplete(5)).toBe(true);
    expect(isAmbientRampComplete(4)).toBe(false);
    expect(isAmbientRampComplete(0)).toBe(false);
  });
});

describe('ambientDensityScale', () => {
  it('starts at the drawn size, so the first step changes nothing', () => {
    expect(ambientDensityScale(0)).toBe(1);
  });

  it('grows monotonically, so the field never shrinks back', () => {
    const scales = [0, 1, 2, 3, 4, 5].map(ambientDensityScale);
    for (let index = 1; index < scales.length; index += 1) {
      expect(scales[index]).toBeGreaterThan(scales[index - 1]);
    }
  });

  it('stays modest at the last step, so the field does not crowd the digits', () => {
    expect(ambientDensityScale(5)).toBeLessThan(1.5);
  });

  it('clamps a step outside the range instead of extrapolating', () => {
    expect(ambientDensityScale(99)).toBe(ambientDensityScale(5));
    expect(ambientDensityScale(-4)).toBe(ambientDensityScale(0));
  });

  it('still names a configurable frame cap and drift', () => {
    expect(DEFAULT_AMBIENT_CONFIG.maxFramesPerSecond).toBeGreaterThan(0);
    expect(DEFAULT_AMBIENT_CONFIG.driftExtentRatio).toBeGreaterThan(0);
  });

  it('grows by the configured gain, so the reader chooses how much it changes', () => {
    expect(ambientDensityScale(0, 1.5)).toBe(1);
    expect(ambientDensityScale(5, 1.5)).toBeCloseTo(2.5, 6);
    expect(ambientDensityScale(5, 0)).toBe(1);
  });

  it('clamps a growth gain outside the published range', () => {
    expect(ambientDensityScale(5, 99)).toBe(ambientDensityScale(5, 2));
    expect(ambientDensityScale(5, -5)).toBe(ambientDensityScale(5, 0));
  });
});

describe('the ended ornament', () => {
  it('is a set of its own, so it never matches the field it sits over', () => {
    for (const id of AMBIENT_ORNAMENT_IDS) expect(AMBIENT_TEXTURES.map((t) => t.id)).not.toContain(id);
  });

  it('picks its shape and its colour from one seed', () => {
    const first = rollOrnament(0.3);
    expect(first).toStrictEqual(rollOrnament(0.3));
    expect(AMBIENT_ORNAMENT_IDS).toContain(first.ornament);
    expect(AMBIENT_PALETTES.map((palette) => palette.id)).toContain(first.palette.id);
  });

  it('reaches every ornament over a spread of seeds', () => {
    const seen = new Set(Array.from({ length: 200 }, (_unused, index) => rollOrnament(index / 200).ornament));
    expect(seen.size).toBe(AMBIENT_ORNAMENT_IDS.length);
  });

  it('does not pick the same shape the field would for that seed', () => {
    let differed = 0;
    for (let index = 0; index < 40; index += 1) {
      const seed = index / 40;
      if ((rollOrnament(seed).ornament as string) !== rollAmbient(seed).texture.id) differed += 1;
    }
    expect(differed).toBeGreaterThan(30);
  });

  it('keeps the turn inside the band that neither spins nor freezes', () => {
    expect(clampOrnamentRotationMs(26_000)).toBe(26_000);
    expect(clampOrnamentRotationMs(1)).toBe(4_000);
    expect(clampOrnamentRotationMs(9_999_999)).toBe(180_000);
    expect(clampOrnamentRotationMs(Number.NaN)).toBe(DEFAULT_AMBIENT_CONFIG.ornamentRotationMs);
  });
});

describe('ambientColor', () => {
  it('builds a colour from the palette hue', () => {
    expect(ambientColor(AMBIENT_PALETTES[0], 0.5)).toContain(`${AMBIENT_PALETTES[0].glowHue}`);
  });

  it('can take an accent hue and still stay a valid colour', () => {
    expect(ambientColor(AMBIENT_PALETTES[0], 0.4, AMBIENT_PALETTES[0].accentHue)).toMatch(/^hsl\(/);
  });

  it('wraps an out-of-range hue instead of emitting an invalid one', () => {
    expect(ambientColor(AMBIENT_PALETTES[0], 0.4, 400)).toContain('40 ');
    expect(ambientColor(AMBIENT_PALETTES[0], 0.4, -20)).toContain('340 ');
  });

  it('clamps alpha into the visible range', () => {
    expect(ambientColor(AMBIENT_PALETTES[0], 5)).toContain('/ 1)');
    expect(ambientColor(AMBIENT_PALETTES[0], -1)).toContain('/ 0)');
  });
});

describe('createAmbientNoise', () => {
  it('is reproducible from its seed', () => {
    expect(createAmbientNoise(0.3).at(4.2, 8.1)).toBe(createAmbientNoise(0.3).at(4.2, 8.1));
  });

  it('differs between seeds', () => {
    expect(createAmbientNoise(0.2).at(4.2, 8.1)).not.toBe(createAmbientNoise(0.8).at(4.2, 8.1));
  });

  it('stays inside the unit range', () => {
    const noise = createAmbientNoise(0.55);
    for (let index = 0; index < 2_000; index += 1) {
      const value = noise.at(index * 0.37, index * 0.11);
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('is continuous, so a particle never jumps between neighbouring samples', () => {
    const noise = createAmbientNoise(0.66);
    let previous = noise.at(0, 0);
    let largestStep = 0;
    for (let index = 1; index < 4_000; index += 1) {
      const value = noise.at(index * 0.01, index * 0.013);
      largestStep = Math.max(largestStep, Math.abs(value - previous));
      previous = value;
    }
    expect(largestStep).toBeLessThan(0.1);
  });

  it('stacks octaves within the same range', () => {
    const noise = createAmbientNoise(0.44);
    for (let index = 0; index < 500; index += 1) {
      const value = noise.fbm(index * 0.21, index * 0.07, 4);
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});
