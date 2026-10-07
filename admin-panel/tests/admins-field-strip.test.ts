import { describe, expect, it } from 'vitest';
import { filterReadableFields, getFieldAccess, stripDisallowedFields, type FieldAccessEntity } from '@/lib/field-permissions';

describe('admins field-permissions UPDATE contract', (): void => {
  it('excludes username from updatable fields while including name and enabled', (): void => {
    const perms = new Set<string>(['admin:read', 'admin:update']);
    const access = getFieldAccess('admins', perms);
    expect(access['username'].canUpdate).toBe(false);
    expect(access['name'].canUpdate).toBe(true);
    expect(access['enabled'].canUpdate).toBe(true);

    const stripped = stripDisallowedFields('admins', { name: 'Ada', username: 'ada', enabled: true, id: 1 }, perms);
    expect(stripped).toEqual({ name: 'Ada', enabled: true });
    expect('username' in stripped).toBe(false);
    expect('id' in stripped).toBe(false);
  });

  it('returns empty for unknown entity (deny-by-default)', (): void => {
    const perms = new Set<string>(['admin:read', 'admin:update']);
    // Why the cast: the entity union rejects an unmapped name at compile time, so
    // this pins that the runtime guard behind the type still denies by default.
    const unmapped = '__unknown__' as FieldAccessEntity;
    expect(getFieldAccess(unmapped, perms)).toEqual({});
    expect(stripDisallowedFields(unmapped, { foo: 'bar' }, perms)).toEqual({});
    expect(stripDisallowedFields(unmapped, { foo: 'bar', baz: 1 }, new Set<string>())).toEqual({});
  });

  it('yields nothing updatable without admin:update', (): void => {
    const perms = new Set<string>(['admin:read']);
    const access = getFieldAccess('admins', perms);
    expect(access['name'].canUpdate).toBe(false);
    expect(access['enabled'].canUpdate).toBe(false);
    expect(access['username'].canUpdate).toBe(false);

    const stripped = stripDisallowedFields('admins', { name: 'Ada', enabled: true, password: 'secret', username: 'ada' }, perms);
    expect(stripped).toEqual({});
  });

  it('requires admin:password:update for the credential fields', (): void => {
    const perms = new Set<string>(['admin:read', 'admin:update', 'password:reveal']);
    const access = getFieldAccess('admins', perms);
    expect(access['name'].canUpdate).toBe(true);
    expect(access['password'].canUpdate).toBe(false);
    expect(access['authentication'].canUpdate).toBe(false);

    const stripped = stripDisallowedFields('admins', { name: 'Ada', password: 'secret', authentication: 'hash' }, perms);
    expect(stripped).toEqual({ name: 'Ada' });
  });

  it('lets a password-only caller write the credential fields and nothing else', (): void => {
    const perms = new Set<string>(['admin:password:update']);
    const access = getFieldAccess('admins', perms);
    expect(access['password'].canUpdate).toBe(true);
    expect(access['authentication'].canUpdate).toBe(true);
    expect(access['name'].canUpdate).toBe(false);

    const stripped = stripDisallowedFields('admins', { name: 'Ada', enabled: true, password: 'secret' }, perms);
    expect(stripped).toEqual({ password: 'secret' });
  });

  it('strips only keys with update permission and preserves values', (): void => {
    const perms = new Set<string>(['admin:read', 'admin:update', 'admin:password:update', 'password:reveal']);
    const stripped = stripDisallowedFields(
      'admins',
      { name: 'Ada', username: 'ada', password: 'secret', authentication: 'hash', enabled: false, last_login_at: 'now' },
      perms,
    );
    expect(stripped).toEqual({ name: 'Ada', password: 'secret', authentication: 'hash', enabled: false });
    expect('username' in stripped).toBe(false);
    expect('last_login_at' in stripped).toBe(false);
  });
});

describe('users field-permissions READ contract', (): void => {
  it('strips unreadable user fields from list results', (): void => {
    const perms = new Set<string>(['user:list']);
    const filtered = filterReadableFields('users', { id: 7, username: 'ada', email: 'ada.test', status: 'active' }, perms);

    expect(filtered).toEqual({});
  });

  it('keeps the participation _count for a caller who can list participations', (): void => {
    // Why: Prisma returns _count beside the row, not as a users column. The filter drops
    // any key the table does not name, so without a _count entry the Contests column
    // rendered 0 for every row.
    const perms = new Set<string>(['user:list', 'user:read', 'participation:list']);
    const filtered = filterReadableFields('users', { id: 7, username: 'ada', _count: { participations: 3 } }, perms);

    expect(filtered['_count']).toEqual({ participations: 3 });
  });

  it('drops the participation _count for a caller without participation:list', (): void => {
    const perms = new Set<string>(['user:list', 'user:read']);
    const filtered = filterReadableFields('users', { id: 7, username: 'ada', _count: { participations: 3 } }, perms);

    expect(filtered.username).toBe('ada');
    expect('_count' in filtered).toBe(false);
  });
});
