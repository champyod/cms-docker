import { describe, expect, it } from 'vitest';
import {
  assertReasonForDestructive,
  canonicaliseEntry,
  computeEntryHash,
  isDestructiveVerb,
  type AuditEntry,
} from '@/lib/audit';

describe('isDestructiveVerb', () => {
  const verbCases: { verb: string; expected: boolean }[] = [
    { verb: 'delete', expected: true },
    { verb: 'deleteContest', expected: true },
    { verb: 'reset', expected: true },
    { verb: 'reset_password', expected: true },
    { verb: 'clean', expected: true },
    { verb: 'cleanup', expected: true },
    { verb: 'remove', expected: true },
    { verb: 'remove-member', expected: true },
    { verb: 'drop', expected: true },
    { verb: 'overwrite', expected: true },
    { verb: 'revoke', expected: true },
    { verb: 'rotate', expected: true },
    { verb: 'restart', expected: true },
    { verb: 'redeploy', expected: true },
    { verb: 'shutdown', expected: true },
    { verb: 'ROTATE', expected: true },
    { verb: '  Delete  ', expected: true },
    { verb: 'create', expected: false },
    { verb: 'update', expected: false },
    { verb: 'read', expected: false },
    { verb: 'list', expected: false },
    { verb: 'login', expected: false },
    { verb: '', expected: false },
    { verb: '   ', expected: false },
  ];

  it.each(verbCases)('classifies "$verb" as destructive=$expected', ({ verb, expected }) => {
    expect(isDestructiveVerb(verb)).toBe(expected);
  });
});

describe('assertReasonForDestructive', () => {
  it('rejects a destructive verb with no reason', () => {
    const result = assertReasonForDestructive('delete');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it('rejects a destructive verb with a whitespace-only reason', () => {
    const result = assertReasonForDestructive('reset', '   ');
    expect(result.ok).toBe(false);
  });

  it('accepts a destructive verb with a non-empty reason', () => {
    expect(assertReasonForDestructive('remove', 'requested by ticket OPS-42')).toEqual({ ok: true });
  });

  it('accepts a non-destructive verb without a reason', () => {
    expect(assertReasonForDestructive('create')).toEqual({ ok: true });
  });

  it('accepts a non-destructive verb even with a blank reason', () => {
    expect(assertReasonForDestructive('update', '  ')).toEqual({ ok: true });
  });
});

describe('computeEntryHash', () => {
  it('is deterministic for identical inputs', () => {
    expect(computeEntryHash(null, 'payload')).toBe(computeEntryHash(null, 'payload'));
  });

  it('produces a lowercase 64-character hex digest', () => {
    expect(computeEntryHash(null, 'payload')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when the previous hash changes', () => {
    expect(computeEntryHash('parent-a', 'payload')).not.toBe(computeEntryHash('parent-b', 'payload'));
  });

  it('treats a null previous hash as the empty chain seed', () => {
    expect(computeEntryHash(null, 'payload')).toBe(computeEntryHash('', 'payload'));
  });

  it('changes when the canonical payload changes', () => {
    expect(computeEntryHash('parent', 'a')).not.toBe(computeEntryHash('parent', 'b'));
  });
});

describe('canonicaliseEntry', () => {
  const baseEntry: AuditEntry = {
    verb: 'update',
    entity: 'contest',
    entityId: '42',
    result: 'success',
  };

  it('is independent of top-level key order', () => {
    const reordered: AuditEntry = {
      result: 'success',
      entityId: '42',
      entity: 'contest',
      verb: 'update',
    };
    expect(canonicaliseEntry(baseEntry)).toBe(canonicaliseEntry(reordered));
  });

  it('is independent of nested object key order', () => {
    const first: AuditEntry = {
      verb: 'update',
      entity: 'contest',
      result: 'success',
      beforeValues: { a: 1, b: 2 },
    };
    const second: AuditEntry = {
      verb: 'update',
      entity: 'contest',
      result: 'success',
      beforeValues: { b: 2, a: 1 },
    };
    expect(canonicaliseEntry(first)).toBe(canonicaliseEntry(second));
  });

  it('omits undefined optional fields so two equal entries match', () => {
    const withUndefined: AuditEntry = { ...baseEntry, reason: undefined };
    expect(canonicaliseEntry(withUndefined)).toBe(canonicaliseEntry(baseEntry));
  });

  it('differs when the entry data differs', () => {
    expect(canonicaliseEntry(baseEntry)).not.toBe(
      canonicaliseEntry({ ...baseEntry, entityId: '43' }),
    );
  });

  it('is stable across repeated calls', () => {
    expect(canonicaliseEntry(baseEntry)).toBe(canonicaliseEntry(baseEntry));
  });
});
