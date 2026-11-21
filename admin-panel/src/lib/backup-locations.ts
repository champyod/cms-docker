import { getBackupRoot } from '@/lib/backup-archives';

/**
 * The archive tree the Backup & Restore page offers. There is exactly one — the
 * tree BACKUP_DIR mounts — so it is a constant, not a table row. `path` stays
 * empty because the tree is named by the mount, not a configured path.
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
 * BACKUP_DIR and pass no --root flag": the contract every relative path relies
 * on, because the monitor knows that tree under its own mount (/app/backups).
 */
export type WriteRootResolution =
  | { readonly ok: true; readonly root: string | null }
  | { readonly ok: false; readonly error: string };

export const SYSTEM_LOCATION_ID = 'default';

const SYSTEM_LOCATION: BackupLocation = {
  id: SYSTEM_LOCATION_ID,
  label: 'Primary volume',
  path: '',
};

/** The one location, kept as a list so a picker still renders a single source. */
export async function listBackupLocations(): Promise<readonly BackupLocation[]> {
  return [SYSTEM_LOCATION];
}

/** The default location. Never null now that the tree is not a row. */
export async function findDefaultLocation(): Promise<BackupLocation | null> {
  return SYSTEM_LOCATION;
}

function isKnownLocation(locationId?: string | null): boolean {
  return locationId === undefined || locationId === null || locationId === SYSTEM_LOCATION_ID;
}

/** Resolves a read root. An absent or system id reads the one tree. */
export async function resolveReadRoot(locationId?: string | null): Promise<ReadRootResolution> {
  if (!isKnownLocation(locationId)) {
    return { ok: false, error: `Unknown backup location: ${locationId}` };
  }
  return { ok: true, root: getBackupRoot() };
}

/**
 * Resolves the `--root` argument for a monitor dump. Always null: the only tree
 * is the one the monitor already writes under its own mount.
 */
export async function resolveWriteRoot(locationId?: string | null): Promise<WriteRootResolution> {
  if (!isKnownLocation(locationId)) {
    return { ok: false, error: `Unknown backup location: ${locationId}` };
  }
  return { ok: true, root: null };
}
