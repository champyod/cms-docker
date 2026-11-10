import { describe, expect, it } from 'vitest';

import { classifyReachability } from '@/lib/security/kernel-reachability';
import {
  MAX_KERNEL_RELEASE_LENGTH,
  MAX_MODULES_PER_LIST,
  moduleStateMap,
  parseHostModuleFacts,
  type HostModuleFacts,
} from '@/lib/security/host-module-state';

// What these pin: ksmbd is blacklisted AND loaded on both hosts, so testing `blocked` first would suppress a live CVE.

const RELEASE = '6.12.9-1-cachyos';

function facts(overrides: Partial<HostModuleFacts> = {}): HostModuleFacts {
  return { kernelRelease: RELEASE, loaded: [], blocked: [], ...overrides };
}

describe('moduleStateMap', () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly state: Partial<HostModuleFacts>;
    readonly modules: readonly string[];
    readonly expected: Readonly<Record<string, string>>;
  }> = [
    {
      name: 'a blacklisted module that is loaded reads loaded',
      state: { loaded: ['ksmbd'], blocked: ['ksmbd'] },
      modules: ['ksmbd'],
      expected: { ksmbd: 'loaded' },
    },
    {
      name: 'a blacklisted module that is not loaded reads blacklisted',
      state: { loaded: [], blocked: ['ceph'] },
      modules: ['ceph'],
      expected: { ceph: 'blacklisted' },
    },
    {
      name: 'a loaded module with no rule reads loaded',
      state: { loaded: ['cifs'], blocked: [] },
      modules: ['cifs'],
      expected: { cifs: 'loaded' },
    },
    {
      name: 'a module this host never mentioned reads absent',
      state: { loaded: ['cifs'], blocked: ['ceph'] },
      modules: ['nfsd'],
      expected: { nfsd: 'absent' },
    },
    {
      name: 'each name is judged on its own, in one pass',
      state: { loaded: ['ksmbd', 'amdgpu'], blocked: ['ksmbd', 'f2fs'] },
      modules: ['ksmbd', 'f2fs', 'ntfs3', 'amdgpu'],
      expected: { ksmbd: 'loaded', f2fs: 'blacklisted', ntfs3: 'absent', amdgpu: 'loaded' },
    },
  ];

  for (const { name, state, modules, expected } of cases) {
    it(name, () => {
      expect(moduleStateMap(modules, facts(state))).toEqual(expected);
    });
  }

  it('never calls a running module unreachable, however it is configured', () => {
    // Separate from the table: with `blocked` first the verdict is 'blacklisted' and a running subsystem reads unreachable.
    const state = facts({ loaded: ['ksmbd'], blocked: ['ksmbd'] });
    expect(moduleStateMap(['ksmbd'], state).ksmbd).toBe('loaded');
    expect(classifyReachability('kernel: ksmbd: use-after-free in smb2_query_info', moduleStateMap(['ksmbd'], state)))
      .toBe('reachable');
  });

  it('answers reachability for a subsystem with several modules from one map', () => {
    const blockedOnly = facts({ loaded: [], blocked: ['cfg80211'] });
    expect(classifyReachability('kernel: wifi: heap overflow in scan', moduleStateMap(['cfg80211', 'mac80211'], blockedOnly)))
      .toBe('unreachable');
    const oneRunning = facts({ loaded: ['mac80211'], blocked: ['cfg80211'] });
    expect(classifyReachability('kernel: wifi: heap overflow in scan', moduleStateMap(['cfg80211', 'mac80211'], oneRunning)))
      .toBe('reachable');
  });

  it('returns a fresh object, so a caller cannot edit the recorded state through it', () => {
    const state = facts({ loaded: ['ksmbd'] });
    const first = moduleStateMap(['ksmbd'], state);
    const second = moduleStateMap(['ksmbd'], state);
    expect(first).not.toBe(second);
    expect(second).toEqual({ ksmbd: 'loaded' });
  });

  it('answers nothing for an empty request rather than inventing verdicts', () => {
    expect(moduleStateMap([], facts({ loaded: ['ksmbd'] }))).toEqual({});
  });
});

describe('parseHostModuleFacts', () => {
  it('accepts the shape the rootfs scan sends', () => {
    const parsed = parseHostModuleFacts({
      kernel_release: RELEASE,
      loaded: ['ksmbd', 'cifs'],
      blocked: ['ceph'],
    });
    expect(parsed).toEqual({
      ok: true,
      value: { kernelRelease: RELEASE, loaded: ['cifs', 'ksmbd'], blocked: ['ceph'] },
    });
  });

  it('collapses duplicates and sorts both lists, so two scans of one host agree', () => {
    const parsed = parseHostModuleFacts({
      kernel_release: RELEASE,
      loaded: ['cifs', 'cifs', 'ksmbd'],
      blocked: ['tipc', 'tipc'],
    });
    expect(parsed.ok && parsed.value.loaded).toEqual(['cifs', 'ksmbd']);
    expect(parsed.ok && parsed.value.blocked).toEqual(['tipc']);
  });

  it('accepts a host with nothing blocked', () => {
    const parsed = parseHostModuleFacts({ kernel_release: RELEASE, loaded: ['cifs'], blocked: [] });
    expect(parsed.ok && parsed.value.blocked).toEqual([]);
  });

  const refusals: ReadonlyArray<{ readonly name: string; readonly body: unknown }> = [
    { name: 'a string', body: 'ksmbd' },
    { name: 'an array', body: ['ksmbd'] },
    { name: 'null', body: null },
    { name: 'no kernel_release', body: { loaded: [], blocked: [] } },
    { name: 'a blank kernel_release', body: { kernel_release: '  ', loaded: [], blocked: [] } },
    {
      name: 'an over-long kernel_release',
      body: { kernel_release: 'x'.repeat(MAX_KERNEL_RELEASE_LENGTH + 1), loaded: [], blocked: [] },
    },
    { name: 'no loaded list', body: { kernel_release: RELEASE, blocked: [] } },
    { name: 'a loaded list that is not an array', body: { kernel_release: RELEASE, loaded: {}, blocked: [] } },
    { name: 'no blocked list', body: { kernel_release: RELEASE, loaded: [] } },
    { name: 'a non-string entry', body: { kernel_release: RELEASE, loaded: [7], blocked: [] } },
    { name: 'a blank entry', body: { kernel_release: RELEASE, loaded: ['  '], blocked: [] } },
    { name: 'a path instead of a name', body: { kernel_release: RELEASE, loaded: ['fs/ksmbd.ko'], blocked: [] } },
    { name: 'a name with a space', body: { kernel_release: RELEASE, loaded: ['ksmbd evil'], blocked: [] } },
    {
      name: 'more names than a kernel ships',
      body: {
        kernel_release: RELEASE,
        loaded: Array.from({ length: MAX_MODULES_PER_LIST + 1 }, (_, index) => `m${index}`),
        blocked: [],
      },
    },
  ];

  for (const { name, body } of refusals) {
    it(`refuses ${name}, naming the field`, () => {
      const parsed = parseHostModuleFacts(body);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error).toContain('host_modules');
    });
  }
});
