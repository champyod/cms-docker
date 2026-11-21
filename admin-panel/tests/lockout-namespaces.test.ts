import { describe, expect, it } from 'vitest';

import { LOCKOUT_NAMESPACES, lockoutNamespaceFor } from '@/lib/lockout-namespaces';

describe('lockout namespaces', () => {
  it('covers both login surfaces, one namespace each', () => {
    expect(LOCKOUT_NAMESPACES.map((entry) => entry.namespace)).toEqual(['cms:login:', 'cms:ranking:login:']);
    expect(LOCKOUT_NAMESPACES.map((entry) => entry.surface)).toEqual(['contest', 'ranking']);
  });

  it('resolves a key to the surface its own prefix names', () => {
    expect(lockoutNamespaceFor('cms:login:ada|1.2.3.4')?.surface).toBe('contest');
    expect(lockoutNamespaceFor('cms:login:ip#1.2.3.4')?.surface).toBe('contest');
    expect(lockoutNamespaceFor('cms:ranking:login:ada|1.2.3.4')?.surface).toBe('ranking');
  });

  it('resolves nothing for a key outside every namespace', () => {
    expect(lockoutNamespaceFor('cms:contest:login:ada|1.2.3.4')).toBeNull();
    expect(lockoutNamespaceFor('cms:loginx:ada')).toBeNull();
    expect(lockoutNamespaceFor('other')).toBeNull();
    expect(lockoutNamespaceFor('')).toBeNull();
  });
});
