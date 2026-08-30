import { describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import {
  DEFAULT_PASSWORD_KIND,
  formatStoredPassword,
  isPasswordKind,
  parseStoredPassword,
} from '@/lib/password-format';

describe('formatStoredPassword', () => {
  it('prefixes bcrypt hashes', async () => {
    const stored = await formatStoredPassword('bcrypt', 's3cret');
    expect(stored.startsWith('bcrypt:')).toBe(true);

    const hash = stored.slice('bcrypt:'.length);
    await expect(bcrypt.compare('s3cret', hash)).resolves.toBe(true);
  });

  it('roundtrips plaintext through parseStoredPassword', async () => {
    const stored = await formatStoredPassword('plaintext', 'hunter2');
    expect(stored).toBe('plaintext:hunter2');

    const parsed = parseStoredPassword(stored);
    expect(parsed.kind).toBe('plaintext');
    expect(parsed.value).toBe('hunter2');
  });

  it('roundtrips bcrypt through parseStoredPassword without leaking the raw value', async () => {
    const stored = await formatStoredPassword('bcrypt', 's3cret');
    const parsed = parseStoredPassword(stored);
    expect(parsed.kind).toBe('bcrypt');
    expect(parsed.value).not.toContain('s3cret');
    await expect(bcrypt.compare('s3cret', parsed.value)).resolves.toBe(true);
  });
});

describe('isPasswordKind', () => {
  it('accepts both kinds', () => {
    expect(isPasswordKind('bcrypt')).toBe(true);
    expect(isPasswordKind('plaintext')).toBe(true);
  });

  it('rejects garbage', () => {
    for (const candidate of ['md5', 'sha256', '', 'BCRYPT', null, undefined, 42, true, {}, [], ['plaintext']]) {
      expect(isPasswordKind(candidate)).toBe(false);
    }
  });
});

describe('parseStoredPassword', () => {
  it('parses legacy no-colon values as plaintext', () => {
    expect(parseStoredPassword('legacyraw')).toEqual({ kind: 'plaintext', value: 'legacyraw' });
  });

  it('treats missing stored values as empty plaintext', () => {
    expect(parseStoredPassword(null)).toEqual({ kind: 'plaintext', value: '' });
    expect(parseStoredPassword(undefined)).toEqual({ kind: 'plaintext', value: '' });
    expect(parseStoredPassword('')).toEqual({ kind: 'plaintext', value: '' });
  });

  it('keeps value payloads intact when they contain colons', () => {
    expect(parseStoredPassword('plaintext:pa:ss:word')).toEqual({ kind: 'plaintext', value: 'pa:ss:word' });
    expect(parseStoredPassword('bcrypt:$2a$10$abc:def')).toEqual({ kind: 'bcrypt', value: '$2a$10$abc:def' });
  });
});

describe('DEFAULT_PASSWORD_KIND', () => {
  it('is bcrypt', () => {
    expect(DEFAULT_PASSWORD_KIND).toBe('bcrypt');
  });
});
