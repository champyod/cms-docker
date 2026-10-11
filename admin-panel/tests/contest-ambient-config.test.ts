import { describe, expect, it, afterEach } from 'vitest';

import {
  AMBIENT_TUNING_SOURCES,
  resolveAmbientTuning,
  resolveCountdownAmbientConfig,
} from '@/lib/contest-ambient-config';
import { DEFAULT_AMBIENT_CONFIG } from '@/lib/contest-ambient';

const KEYS = Object.values(AMBIENT_TUNING_SOURCES).map((source) => source.key);

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe('resolveAmbientTuning', () => {
  it('uses the config value when it is present and in band', () => {
    process.env[AMBIENT_TUNING_SOURCES.rerollMs.key] = '20000';
    expect(resolveAmbientTuning(AMBIENT_TUNING_SOURCES.rerollMs)).toBe(20_000);
  });

  it('falls back when the key is absent', () => {
    expect(resolveAmbientTuning(AMBIENT_TUNING_SOURCES.rerollMs)).toBe(DEFAULT_AMBIENT_CONFIG.rerollMs);
  });

  it('falls back on an unparseable or blank value instead of emitting NaN', () => {
    for (const bad of ['', '   ', 'soon', 'NaN', '12ms']) {
      process.env[AMBIENT_TUNING_SOURCES.rerollMs.key] = bad;
      expect(resolveAmbientTuning(AMBIENT_TUNING_SOURCES.rerollMs)).toBe(DEFAULT_AMBIENT_CONFIG.rerollMs);
    }
  });

  it('refuses a value outside the band rather than accepting it', () => {
    process.env[AMBIENT_TUNING_SOURCES.rerollMs.key] = '10';
    expect(resolveAmbientTuning(AMBIENT_TUNING_SOURCES.rerollMs)).toBe(DEFAULT_AMBIENT_CONFIG.rerollMs);
  });

  it('keeps the blur inside the band that measures clean, whatever config says', () => {
    expect(AMBIENT_TUNING_SOURCES.maxBlurPx.max).toBeLessThanOrEqual(64);
    process.env[AMBIENT_TUNING_SOURCES.maxBlurPx.key] = '200';
    expect(resolveCountdownAmbientConfig().maxBlurPx).toBe(DEFAULT_AMBIENT_CONFIG.maxBlurPx);
  });

  it('refuses a zero frame cap, which would freeze the field', () => {
    process.env[AMBIENT_TUNING_SOURCES.maxFramesPerSecond.key] = '0';
    expect(resolveCountdownAmbientConfig().maxFramesPerSecond).toBe(DEFAULT_AMBIENT_CONFIG.maxFramesPerSecond);
  });

  it('accepts a value sitting exactly on either bound', () => {
    process.env[AMBIENT_TUNING_SOURCES.driftExtentRatio.key] = '0';
    expect(resolveAmbientTuning(AMBIENT_TUNING_SOURCES.driftExtentRatio)).toBe(0);
    process.env[AMBIENT_TUNING_SOURCES.driftExtentRatio.key] = '0.5';
    expect(resolveAmbientTuning(AMBIENT_TUNING_SOURCES.driftExtentRatio)).toBe(0.5);
  });
});

describe('resolveCountdownAmbientConfig', () => {
  it('returns the defaults when nothing is configured', () => {
    expect(resolveCountdownAmbientConfig()).toStrictEqual(DEFAULT_AMBIENT_CONFIG);
  });

  it('reads every key, so no tuning value is left hardcoded', () => {
    const config = resolveCountdownAmbientConfig();
    const tunable = Object.keys(AMBIENT_TUNING_SOURCES) as (keyof typeof config)[];
    expect(tunable.sort()).toStrictEqual(Object.keys(DEFAULT_AMBIENT_CONFIG).sort());
    for (const key of tunable) expect(typeof config[key]).toBe('number');
  });

  it('applies each key independently', () => {
    process.env[AMBIENT_TUNING_SOURCES.rerollMs.key] = '15000';
    process.env[AMBIENT_TUNING_SOURCES.maxFramesPerSecond.key] = '60';
    const config = resolveCountdownAmbientConfig();
    expect(config.rerollMs).toBe(15_000);
    expect(config.maxFramesPerSecond).toBe(60);
    expect(config.maxBlurPx).toBe(DEFAULT_AMBIENT_CONFIG.maxBlurPx);
  });
});
