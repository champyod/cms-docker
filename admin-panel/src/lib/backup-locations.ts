import path from 'node:path';

import { getBackupRoot } from '@/lib/backup-archives';
import { getRepoRoot } from '@/lib/repo-root';
import { prisma } from '@/lib/prisma';

/**
 * A named archive tree the Backup & Restore page offers. Locations are
 * rows now, so a schedule's reference is a real FK. `path` is the
 * configured string, unresolved: the system row carries an empty one
 * because the tree it names is whatever BACKUP_DIR mounts, not a
 * configured path.
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
 * BACKUP_DIR and pass no --root flag": the contract every relative path
 * and the system row rely on, because the monitor knows that tree under
 * its own mount (/app/backups).
 */
export type WriteRootResolution =
  | { readonly ok: true; readonly root: string | null }
  | { readonly ok: false; readonly error: string };

function isLegacyTreePath(configuredPath: string): boolean {
  return path.resolve(getRepoRoot(), configuredPath) === getBackupRoot();
}

/**
 * The archive tree a location's configured path names, or null when the
 * path names no tree both containers see. The system row's empty path is
 * the legacy tree. A relative path is admitted only in the one spelling
 * both containers share — the panel resolves it against the repo root,
 * the monitor against its own mount — because any other relative path
 * would point the two at different trees.
 */
function resolveConfiguredPath(locationPath: string): string | null {
  if (locationPath.length === 0) return getBackupRoot();
  if (path.isAbsolute(locationPath)) return path.resolve(locationPath);
  return isLegacyTreePath(locationPath) ? getBackupRoot() : null;
}

function toLocation(row: { id: string; label: string; path: string }): BackupLocation {
  return { id: row.id, label: row.label, path: row.path };
}

/** Every location row, the system row first, so a picker offers the default where it was. */
export async function listBackupLocations(): Promise<readonly BackupLocation[]> {
  const rows = await prisma.backup_locations.findMany({ orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }] });
  return rows.map(toLocation);
}

/** The seeded system row: the default location every absent id names. */
export async function findDefaultLocation(): Promise<BackupLocation | null> {
  const row = await prisma.backup_locations.findFirst({ where: { isSystem: true } });
  return row === null ? null : toLocation(row);
}

/**
 * The location an id names, or the system row when the id is absent.
 * Null when the id names no row: an unknown id is drift to report,
 * never a silent redirect to another tree.
 */
async function findEffectiveLocation(locationId?: string | null): Promise<BackupLocation | null> {
  if (locationId !== undefined && locationId !== null) {
    const row = await prisma.backup_locations.findUnique({ where: { id: locationId } });
    return row === null ? null : toLocation(row);
  }
  return findDefaultLocation();
}

/**
 * The tree an id names, or the error to fail closed with. Shared by both
 * resolvers so the read and write paths can never disagree about what an
 * id points at.
 */
async function resolveNamedTree(
  locationId?: string | null,
): Promise<{ readonly ok: true; readonly tree: string } | { readonly ok: false; readonly error: string }> {
  const location = await findEffectiveLocation(locationId);
  if (location === null) return { ok: false, error: `Unknown backup location: ${locationId ?? 'default'}` };
  const tree = resolveConfiguredPath(location.path);
  if (tree === null) {
    return { ok: false, error: `Backup location ${location.id} names a path only one container sees` };
  }
  return { ok: true, tree };
}

/**
 * Resolves a read root. An absent id reads whatever the system row names —
 * with no [backup] config that is getBackupRoot(), exactly the legacy
 * behaviour every pre-locations caller depended on.
 */
export async function resolveReadRoot(locationId?: string | null): Promise<ReadRootResolution> {
  const resolved = await resolveNamedTree(locationId);
  return resolved.ok ? { ok: true, root: resolved.tree } : { ok: false, error: resolved.error };
}

/**
 * Resolves the `--root` argument for a monitor dump: null whenever the
 * target tree is the one the monitor already writes — the system row, a
 * relative path naming it, or a configured path equal to getBackupRoot() —
 * because handing the monitor the panel's view of its own mount would
 * point the container at a path its filesystem does not have. Any other
 * tree is passed verbatim; it must be bind-mounted at the same path in
 * BOTH cms-monitor (write) and cms-admin-next (read), the contract every
 * non-system location carries.
 */
export async function resolveWriteRoot(locationId?: string | null): Promise<WriteRootResolution> {
  const resolved = await resolveNamedTree(locationId);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  return { ok: true, root: resolved.tree === getBackupRoot() ? null : resolved.tree };
}
