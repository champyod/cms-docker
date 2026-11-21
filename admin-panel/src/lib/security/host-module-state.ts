// The host kernel's module state as the rootfs scan reports it, and the reachability facts it yields.
import type { HostModuleState, ModuleState } from '@/lib/security/kernel-reachability';

// The route's 1 MB body cap is the real ceiling; these refuse a runaway producer before that.
export const MAX_MODULES_PER_LIST = 4096;
export const MAX_MODULE_NAME_LENGTH = 120;
export const MAX_KERNEL_RELEASE_LENGTH = 200;

// A kernel module name: the characters the kernel itself uses, never a path or a blank.
const MODULE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

// The wire keys, named once: the envelope is snake_case and the stored columns are not.
const FIELD_KERNEL_RELEASE = 'kernel_release';
const FIELD_LOADED = 'loaded';
const FIELD_BLOCKED = 'blocked';

// The three verdicts a recorded host can support; 'builtin' is not one, since /proc/modules never lists it.
const STATE_LOADED: ModuleState = 'loaded';
const STATE_BLACKLISTED: ModuleState = 'blacklisted';
const STATE_ABSENT: ModuleState = 'absent';

export interface HostModuleFacts {
  readonly kernelRelease: string;
  readonly loaded: readonly string[];
  readonly blocked: readonly string[];
}

export type HostModuleFactsValidation =
  | { readonly ok: true; readonly value: HostModuleFacts }
  | { readonly ok: false; readonly error: string };

type NameListResult =
  | { readonly ok: true; readonly names: readonly string[] }
  | { readonly ok: false; readonly error: string };

function parseNameList(raw: unknown, field: string): NameListResult {
  if (!Array.isArray(raw)) return { ok: false, error: `host_modules.${field} must be an array` };
  if (raw.length > MAX_MODULES_PER_LIST) {
    return { ok: false, error: `host_modules.${field} exceeds ${MAX_MODULES_PER_LIST} names` };
  }
  const names = new Set<string>();
  for (const entry of raw) {
    // Case is preserved: the comparison that matters is exact equality with what /proc/modules prints.
    if (typeof entry !== 'string') {
      return { ok: false, error: `host_modules.${field} entries must be strings` };
    }
    const name = entry.trim();
    if (name.length === 0 || name.length > MAX_MODULE_NAME_LENGTH) {
      return {
        ok: false,
        error: `host_modules.${field} entries must be 1-${MAX_MODULE_NAME_LENGTH} characters`,
      };
    }
    if (!MODULE_NAME.test(name)) {
      return { ok: false, error: `host_modules.${field} entry is not a module name: ${name}` };
    }
    names.add(name);
  }
  // Duplicates are collapsed rather than refused: two copies of one name say the same thing.
  return { ok: true, names: [...names].sort() };
}

// Schema-checks the optional `host_modules` field, naming the offending key so one 422 is enough.
export function parseHostModuleFacts(raw: unknown): HostModuleFactsValidation {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'host_modules must be an object' };
  }
  const record = raw as Record<string, unknown>;
  const release = record[FIELD_KERNEL_RELEASE];
  if (typeof release !== 'string' || release.trim() === '') {
    return { ok: false, error: `host_modules.${FIELD_KERNEL_RELEASE} is required` };
  }
  const kernelRelease = release.trim();
  if (kernelRelease.length > MAX_KERNEL_RELEASE_LENGTH) {
    return { ok: false, error: `host_modules.${FIELD_KERNEL_RELEASE} exceeds ${MAX_KERNEL_RELEASE_LENGTH} characters` };
  }
  const loaded = parseNameList(record[FIELD_LOADED], FIELD_LOADED);
  if (!loaded.ok) return loaded;
  const blocked = parseNameList(record[FIELD_BLOCKED], FIELD_BLOCKED);
  if (!blocked.ok) return blocked;
  return { ok: true, value: { kernelRelease, loaded: loaded.names, blocked: blocked.names } };
}

// Loaded is tested first: ksmbd is blacklisted AND running on both hosts, and tests/host-module-state.test.ts fails on an inversion.
export function moduleStateMap(
  modules: readonly string[],
  state: Pick<HostModuleFacts, 'loaded' | 'blocked'>,
): HostModuleState {
  const loaded = new Set(state.loaded);
  const blocked = new Set(state.blocked);
  const verdicts: Record<string, ModuleState> = {};
  for (const name of modules) {
    if (loaded.has(name)) verdicts[name] = STATE_LOADED;
    else if (blocked.has(name)) verdicts[name] = STATE_BLACKLISTED;
    else verdicts[name] = STATE_ABSENT;
  }
  return verdicts;
}
