import { describe, expect, it } from 'vitest';
import {
  buildCharset,
  DEFAULT_GENERATOR_LENGTH,
  generateRun,
  MAX_GENERATOR_LENGTH,
  MIN_GENERATOR_LENGTH,
  PASSWORD_CONFIG,
  renderTemplate,
  USERNAME_CHARS,
  USERNAME_CONFIG,
  type GeneratorConfig,
} from '@/lib/credential-template';

const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SPECIALS = '@#$%^&*!~';
const OPERATORS = '-+=_[]?';

const NO_GROUPS: GeneratorConfig = {
  length: 12,
  letters: false,
  caseMode: 'both',
  numbers: false,
  specials: false,
  operators: false,
};

const FULL: GeneratorConfig = { ...NO_GROUPS, letters: true, numbers: true, specials: true, operators: true };

describe('buildCharset', () => {
  it('adds only the groups the config turns on', () => {
    expect(buildCharset(NO_GROUPS)).toBe('');
    expect(buildCharset({ ...NO_GROUPS, letters: true })).toBe(LETTERS);
    expect(buildCharset({ ...NO_GROUPS, numbers: true })).toBe(DIGITS);
    expect(buildCharset({ ...NO_GROUPS, specials: true })).toBe(SPECIALS);
    expect(buildCharset({ ...NO_GROUPS, operators: true })).toBe(OPERATORS);
  });

  it('narrows letters to the chosen case', () => {
    expect(buildCharset({ ...FULL, caseMode: 'upper' })).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' + SPECIALS + OPERATORS);
    expect(buildCharset({ ...FULL, caseMode: 'lower' })).toBe('abcdefghijklmnopqrstuvwxyz0123456789' + SPECIALS + OPERATORS);
    expect(buildCharset(FULL)).toBe(LETTERS + DIGITS + SPECIALS + OPERATORS);
  });

  it('keeps the popup bounds it was extracted from', () => {
    expect(MIN_GENERATOR_LENGTH).toBe(4);
    expect(MAX_GENERATOR_LENGTH).toBe(128);
  });
});

describe('the shipped configs', () => {
  it('keeps the password defaults the generator popup always opened with', () => {
    expect(PASSWORD_CONFIG).toEqual({
      length: DEFAULT_GENERATOR_LENGTH,
      letters: true,
      caseMode: 'both',
      numbers: true,
      specials: true,
      operators: true,
    });
  });

  it('restricts a username to letters and digits, exactly as the users API accepts them', () => {
    expect(USERNAME_CONFIG.specials).toBe(false);
    expect(USERNAME_CONFIG.operators).toBe(false);
    expect(USERNAME_CHARS).toBe(buildCharset(USERNAME_CONFIG));
    expect(USERNAME_CHARS).toMatch(/^[A-Za-z0-9]+$/);
  });
});

describe('generateRun', () => {
  it('draws exactly the configured length from the configured alphabet', () => {
    expect(generateRun(FULL)).toHaveLength(12);
    expect(generateRun({ ...FULL, length: 40 })).toMatch(/^[A-Za-z0-9@#$%^&*!~\-+=_\[\]?]{40}$/);
  });

  it('takes an override alphabet over the config flags', () => {
    expect(generateRun(NO_GROUPS, 'x')).toBe('x'.repeat(12));
    expect(generateRun(FULL, 'ab')).toMatch(/^[ab]{12}$/);
  });

  it('returns nothing for an empty alphabet or a zero length', () => {
    expect(generateRun(NO_GROUPS)).toBe('');
    expect(generateRun(NO_GROUPS, '')).toBe('');
    expect(generateRun({ ...FULL, length: 0 })).toBe('');
  });

  it('does not repeat itself', () => {
    expect(generateRun({ ...FULL, length: 64 })).not.toBe(generateRun({ ...FULL, length: 64 }));
  });
});

describe('renderTemplate', () => {
  it('treats a blank template as one full run', () => {
    expect(renderTemplate('', NO_GROUPS, { charset: 'ab' })).toMatch(/^[ab]{12}$/);
  });

  it('keeps the literal text around each run', () => {
    expect(renderTemplate('camp1*', NO_GROUPS, { charset: 'ab' })).toMatch(/^camp1[ab]{12}$/);
    expect(renderTemplate('*@example.com', NO_GROUPS, { charset: 'ab' })).toMatch(/^[ab]{12}@example\.com$/);
  });

  it('gives every wildcard its own run', () => {
    expect(renderTemplate('*|*', NO_GROUPS, { charset: 'ab' })).toMatch(/^[ab]{12}\|[ab]{12}$/);
  });

  it('leaves a template without wildcards untouched', () => {
    expect(renderTemplate('team-01', FULL)).toBe('team-01');
  });

  it('lets the charset option win over the config alphabet', () => {
    expect(renderTemplate('*', FULL, { charset: 'x' })).toBe('x'.repeat(12));
    expect(renderTemplate('*', USERNAME_CONFIG, { charset: USERNAME_CHARS })).toMatch(/^[A-Za-z0-9]{8}$/);
  });
});
