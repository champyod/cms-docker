import { describe, expect, it, afterEach } from 'vitest';

import {
  AMBIENT_CHOICE_SOURCES,
  AMBIENT_TUNING_SOURCES,
  resolveAmbientTuning,
  resolveCountdownAmbientConfig,
} from '@/lib/contest-ambient-config';
import { DEFAULT_AMBIENT_CONFIG } from '@/lib/contest-ambient';

const KEYS = [
  ...Object.values(AMBIENT_TUNING_SOURCES).map((source) => source.key),
  ...Object.values(AMBIENT_CHOICE_SOURCES).map((source) => source.key),
];

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

  it('reads every numeric key, so no tuning value is left hardcoded', () => {
    const config = resolveCountdownAmbientConfig();
    const numeric = Object.keys(AMBIENT_TUNING_SOURCES) as (keyof typeof config)[];
    for (const key of numeric) expect(typeof config[key]).toBe('number');
    expect(numeric).toHaveLength(
      Object.keys(DEFAULT_AMBIENT_CONFIG).length - Object.keys(AMBIENT_CHOICE_SOURCES).length,
    );
  });

  it('resolves the two choice keys from their own names, alongside the numbers', () => {
    const config = resolveCountdownAmbientConfig();
    const choices = Object.keys(AMBIENT_CHOICE_SOURCES) as (keyof typeof config)[];
    expect(choices.sort()).toStrictEqual(['ornamentId', 'textureId']);
    for (const key of choices) expect(config[key]).toBe('auto');
  });

  it('takes a named choice, and ignores one that names nothing', () => {
    process.env[AMBIENT_CHOICE_SOURCES.textureId.key] = 'boids';
    process.env[AMBIENT_CHOICE_SOURCES.ornamentId.key] = 'spokes';
    expect(resolveCountdownAmbientConfig().textureId).toBe('boids');
    expect(resolveCountdownAmbientConfig().ornamentId).toBe('spokes');
    process.env[AMBIENT_CHOICE_SOURCES.textureId.key] = 'not-a-texture';
    expect(resolveCountdownAmbientConfig().textureId).toBe('auto');
  });

  it('accepts a choice whatever its case, since config is hand-written', () => {
    process.env[AMBIENT_CHOICE_SOURCES.textureId.key] = 'FlOw';
    expect(resolveCountdownAmbientConfig().textureId).toBe('flow');
  });

  it('applies each key independently', () => {
    process.env[AMBIENT_TUNING_SOURCES.rerollMs.key] = '15000';
    process.env[AMBIENT_TUNING_SOURCES.maxFramesPerSecond.key] = '60';
    const config = resolveCountdownAmbientConfig();
    expect(config.rerollMs).toBe(15_000);
    expect(config.maxFramesPerSecond).toBe(60);
    expect(config.driftExtentRatio).toBe(DEFAULT_AMBIENT_CONFIG.driftExtentRatio);
  });
});
