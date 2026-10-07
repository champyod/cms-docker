import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoLeak, loadAuditedActions } from './audit-payload-harness';

/**
 * A password reveal is the most sensitive read in the panel, so its row is the one that must never
 * carry the password — on the success path, on the missing-row path, and on the error path. A
 * failure row is also the shape a break-in attempt takes, which is why the error name is the whole
 * payload: a message here can carry the query that was refused.
 */

describe('password reveal rows never carry the password', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('records a user reveal as its storage kind', async () => {
    const { entries } = await loadAuditedActions();
    const { revealUserPassword } = await import('@/app/actions/users');

    await revealUserPassword(4);

    expect(entries).toHaveLength(1);
    expectNoLeak(entries);
    expect(entries[0]).toMatchObject({
      verb: 'password:reveal',
      entity: 'user',
      entityId: '4',
      result: 'success',
      afterValues: { kind: 'plaintext' },
    });
  });

  it('records a missing user as a failure without an error message', async () => {
    const { entries } = await loadAuditedActions({ userRow: null });
    const { revealUserPassword } = await import('@/app/actions/users');

    const result = await revealUserPassword(4);

    expect(result.success).toBe(false);
    expect(entries).toHaveLength(1);
    expectNoLeak(entries);
    expect(entries[0].result).toBe('failure');
    expect(entries[0].afterValues).toEqual({ error: 'NotFound' });
  });

  it('records a failed user reveal as the error name only', async () => {
    const { entries, users } = await loadAuditedActions();
    users.findUnique.mockRejectedValueOnce(new Error('relation "users" does not exist'));
    const { revealUserPassword } = await import('@/app/actions/users');

    const result = await revealUserPassword(4);

    expect(result.success).toBe(false);
    expect(entries).toHaveLength(1);
    expectNoLeak(entries);
    expect(entries[0].result).toBe('failure');
    expect(entries[0].afterValues).toEqual({ error: 'Error' });
    expect(JSON.stringify(entries)).not.toContain('relation');
  });

  it('records an admin reveal as its storage kind', async () => {
    const { entries } = await loadAuditedActions();
    const { revealAdminPassword } = await import('@/app/actions/admins');

    await revealAdminPassword(2);

    expect(entries).toHaveLength(1);
    expectNoLeak(entries);
    expect(entries[0]).toMatchObject({
      verb: 'password:reveal',
      entity: 'admin',
      entityId: '2',
      result: 'success',
      afterValues: { kind: 'plaintext' },
    });
  });

  it('records a missing admin as a failure without an error message', async () => {
    const { entries } = await loadAuditedActions({ adminRow: null });
    const { revealAdminPassword } = await import('@/app/actions/admins');

    const result = await revealAdminPassword(2);

    expect(result.success).toBe(false);
    expect(entries).toHaveLength(1);
    expectNoLeak(entries);
    expect(entries[0].result).toBe('failure');
    expect(entries[0].afterValues).toEqual({ error: 'NotFound' });
  });

  it('records a failed admin reveal as the error name only', async () => {
    const { entries, admins } = await loadAuditedActions();
    admins.findUnique.mockRejectedValueOnce(new Error('connection refused for admin 2'));
    const { revealAdminPassword } = await import('@/app/actions/admins');

    const result = await revealAdminPassword(2);

    expect(result.success).toBe(false);
    expect(entries).toHaveLength(1);
    expectNoLeak(entries);
    expect(entries[0]).toMatchObject({
      verb: 'password:reveal',
      entity: 'admin',
      entityId: '2',
      result: 'failure',
      afterValues: { error: 'Error' },
    });
    expect(JSON.stringify(entries)).not.toContain('connection refused');
  });
});
