import type { PermissionKey } from '@/lib/permissions';

export type BackupModeId =
  | 'from-file'
  | 'to-file'
  | 'from-dir'
  | 'to-dir'
  | 'schedules';

export interface BackupModeDescriptor {
  readonly id: BackupModeId;
  readonly label: string;
  readonly anyOf: readonly PermissionKey[];
  readonly showsLocationSwitcher: boolean;
}

export const BACKUP_MODES: readonly BackupModeDescriptor[] = [
  { id: 'from-file', label: 'From File', anyOf: ['backup:restore'], showsLocationSwitcher: false },
  { id: 'to-file', label: 'To File', anyOf: ['backup:create'], showsLocationSwitcher: false },
  { id: 'from-dir', label: 'From Backup Dir', anyOf: ['backup:restore', 'backup:list', 'backup:delete'], showsLocationSwitcher: true },
  { id: 'to-dir', label: 'To Backup Dir', anyOf: ['backup:create'], showsLocationSwitcher: true },
  { id: 'schedules', label: 'Schedules', anyOf: ['backup:schedule', 'backup:settle'], showsLocationSwitcher: false },
];

// The route gate must admit every key a mode filter admits, or the tab renders behind a 404.
export const BACKUP_MODE_PERMISSION_KEYS: readonly PermissionKey[] = [
  ...new Set(BACKUP_MODES.flatMap((mode) => mode.anyOf)),
].sort();
