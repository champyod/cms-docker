import type { BackupArchive } from '@/app/actions/backupActions';
import type { Dictionary } from '@/lib/dictionary';
import type { Locale } from '@/lib/locales';

export type MaintenanceToasts = Dictionary['toasts']['maintenance'];

export type Patch = (update: (previous: MaintenanceState) => MaintenanceState) => void;

export interface MaintenanceState {
  readonly data: Record<string, string>;
  readonly loading: boolean;
  readonly saving: boolean;
  readonly backingUp: boolean;
  readonly discordState: string;
  readonly discordError: string;
  readonly discordSaving: boolean;
  readonly discordTesting: boolean;
  readonly archives: readonly BackupArchive[];
  readonly archivesLoading: boolean;
}

export interface MaintenanceGates {
  readonly canTriggerBackup: boolean;
  readonly canConfigure: boolean;
  readonly canViewBackups: boolean;
  readonly canTestAlert: boolean;
}

export const INITIAL_MAINTENANCE_STATE: MaintenanceState = {
  data: {},
  loading: true,
  saving: false,
  backingUp: false,
  discordState: '',
  discordError: '',
  discordSaving: false,
  discordTesting: false,
  archives: [],
  archivesLoading: false,
};

/**
 * Everything the Maintenance cards render, behind one shape.
 *
 * Why a shared controller: the backup policy, the notification wiring, and the
 * archive list are one screen's state, and two cards each deriving their own
 * permission answers from the same key set is how they drift apart.
 */
export interface MaintenanceController {
  readonly locale: Locale;
  readonly data: Readonly<Record<string, string>>;
  readonly loading: boolean;
  readonly saving: boolean;
  readonly backingUp: boolean;
  readonly discordState: string;
  readonly discordError: string;
  readonly discordSaving: boolean;
  readonly discordTesting: boolean;
  readonly archives: readonly BackupArchive[];
  readonly archivesLoading: boolean;
  readonly canTriggerBackup: boolean;
  readonly canConfigure: boolean;
  readonly canViewBackups: boolean;
  readonly canTestAlert: boolean;
  readonly handleChange: (key: string, value: string) => void;
  readonly handleSave: () => Promise<void>;
  readonly handleBackup: () => Promise<void>;
  readonly persistDiscordSettings: (applyToMonitor: boolean) => Promise<void>;
  readonly handleTestAlert: () => Promise<void>;
  readonly loadArchives: () => Promise<void>;
}
