import { describe, expect, it } from 'vitest';
import { getFieldAccess, stripDisallowedFields } from '@/lib/field-permissions';

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
    expect(getFieldAccess('__unknown__', perms)).toEqual({});
    expect(stripDisallowedFields('__unknown__', { foo: 'bar' }, perms)).toEqual({});
    expect(stripDisallowedFields('__unknown__', { foo: 'bar', baz: 1 }, new Set<string>())).toEqual({});
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

  it('strips only keys with update permission and preserves values', (): void => {
    const perms = new Set<string>(['admin:read', 'admin:update', 'password:reveal']);
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
