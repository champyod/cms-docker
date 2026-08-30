import { describe, expect, it } from 'vitest';
import { safeAdminSelect, safeUserSelect } from '@/lib/prisma-selects';

describe('safeUserSelect', () => {
  it('never exposes credential fields', () => {
    const keys = Object.keys(safeUserSelect);
    expect(keys).not.toContain('password');
  });
  it('exposes identity fields', () => {
    for (const key of ['id', 'username', 'first_name', 'last_name', 'email']) {
      expect(Object.keys(safeUserSelect)).toContain(key);
    }
  });
});

describe('safeAdminSelect', () => {
  it('never exposes authentication hash', () => {
    expect(Object.keys(safeAdminSelect)).not.toContain('authentication');
  });
  it('exposes permission flags', () => {
    for (const key of ['permission_all', 'permission_users', 'permission_tasks', 'permission_contests', 'permission_messaging']) {
      expect(Object.keys(safeAdminSelect)).toContain(key);
    }
  });
});
