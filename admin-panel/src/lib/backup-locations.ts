import path from 'node:path';

import { getBackupRoot } from '@/lib/backup-archives';
import { getRepoRoot } from '@/lib/repo-root';

/**
 * A named backup target the Backup & Restore page switches between. `path` is
 * the configured string, unresolved: a relative one points at the legacy tree,
 * which is the only directory both containers see under one name.
 */
export interface BackupLocation {
  readonly id: string;
  readonly label: string;
  readonly path: string;
}

export type ReadRootResolution =
  | { readonly ok: true; readonly root: string }
  | { readonly ok: false; readonly error: string };

/**
 * A resolved write root. `root: null` means "write with the monitor's own
 * BACKUP_DIR and pass no --root flag": the legacy single-tree contract that
 * every pre-locations deployment and every relative path relies on.
 */
export type WriteRootResolution =
  | { readonly ok: true; readonly root: string | null }
  | { readonly ok: false; readonly error: string };

const DEFAULT_LOCATION_ID = 'default';
const DEFAULT_LOCATION_LABEL = 'Primary volume';
const LOCATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_LOCATIONS = 16;

/** The location the switcher and new schedules preselect. */
export function getDefaultLocationId(): string {
  const configured = process.env.BACKUP_DEFAULT_LOCATION?.trim();
  return configured !== undefined && configured.length > 0 ? configured : DEFAULT_LOCATION_ID;
}

function parseLocationEntry(entry: unknown): BackupLocation | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const { id, label, path: rawPath } = entry as { id?: unknown; label?: unknown; path?: unknown };
  if (typeof id !== 'string' || !LOCATION_ID_PATTERN.test(id)) return null;
  if (typeof label !== 'string' || label.trim().length === 0) return null;
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) return null;
  return { id, label: label.trim(), path: rawPath.trim() };
}

function isLegacyTreePath(configuredPath: string): boolean {
  return path.resolve(getRepoRoot(), configuredPath) === getBackupRoot();
}

/**
 * Returns null on ANY violation so the caller falls back to the single
 * implicit location rather than operating on a partial list where one entry
 * writes somewhere another entry cannot read.
 */
export function parseBackupLocations(raw: string): readonly BackupLocation[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_LOCATIONS) return null;
  const seenIds = new Set<string>();
  const locations: BackupLocation[] = [];
  for (const entry of parsed) {
    const location = parseLocationEntry(entry);
    if (location === null || seenIds.has(location.id)) return null;
    seenIds.add(location.id);
    locations.push(location);
  }
  const hasInvalidRelativePath = locations.some(
    (location) => !path.isAbsolute(location.path) && !isLegacyTreePath(location.path),
  );
  return hasInvalidRelativePath ? null : locations;
}

/** The configured location list, read from env per call; invalid or absent env yields the single implicit default location. */
export function listBackupLocations(): readonly BackupLocation[] {
  const raw = process.env.BACKUP_LOCATIONS?.trim();
  if (raw !== undefined && raw.length > 0) {
    const parsed = parseBackupLocations(raw);
    if (parsed !== null) return parsed;
  }
  return [{ id: DEFAULT_LOCATION_ID, label: DEFAULT_LOCATION_LABEL, path: getBackupRoot() }];
}

/** The configured default when the list carries it, otherwise the first entry's id — never an id the list lacks. */
export function resolveDefaultLocationId(locations: readonly BackupLocation[]): string {
  const preferred = getDefaultLocationId();
  if (locations.some((location) => location.id === preferred)) return preferred;
  return locations[0]?.id ?? DEFAULT_LOCATION_ID;
}

/**
 * An absent id is not a fourth location: it is the configured default, which
 * config.toml documents as the target when no other is chosen. An id the list
 * does not carry resolves to null so both resolvers fail closed instead of
 * silently reading or writing a different tree.
 */
function findEffectiveLocation(locationId?: string | null): BackupLocation | null {
  const locations = listBackupLocations();
  if (locationId !== undefined && locationId !== null) {
    return locations.find((location) => location.id === locationId) ?? null;
  }
  const defaultId = resolveDefaultLocationId(locations);
  return locations.find((location) => location.id === defaultId) ?? null;
}

/**
 * Resolves a read root. An absent id reads whatever the configured default
 * names — with no [backup] config that is getBackupRoot(), exactly the legacy
 * behaviour every pre-locations caller depended on.
 */
export function resolveReadRoot(locationId?: string | null): ReadRootResolution {
  const location = findEffectiveLocation(locationId);
  if (location === null) return { ok: false, error: `Unknown backup location: ${locationId}` };
  const root = path.isAbsolute(location.path) ? path.resolve(location.path) : path.resolve(getRepoRoot(), location.path);
  return { ok: true, root };
}

/**
 * Resolves the `--root` argument for a monitor dump: null whenever the target
 * directory is the one the monitor already writes — a relative path or a path
 * equal to getBackupRoot() — because the monitor knows that tree under its own
 * mount (/app/backups), and handing it the panel's view would point the
 * container at a path its filesystem does not have. Any other absolute path is
 * passed verbatim; it must be bind-mounted at the same path in BOTH
 * cms-monitor (write) and cms-admin-next (read), the contract stated next to
 * the location list in config.toml.example.
 */
export function resolveWriteRoot(locationId?: string | null): WriteRootResolution {
  const location = findEffectiveLocation(locationId);
  if (location === null) return { ok: false, error: `Unknown backup location: ${locationId}` };
  if (!path.isAbsolute(location.path)) return { ok: true, root: null };
  const root = path.resolve(location.path);
  if (root === path.resolve(getBackupRoot())) return { ok: true, root: null };
  return { ok: true, root };
}
