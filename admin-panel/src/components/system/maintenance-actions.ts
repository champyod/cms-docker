'use client';

import { toast } from 'sonner';

import { getDiscordNotificationSettings, saveDiscordNotificationSettings, sendTestDiscordAlert } from '@/app/actions/notifications';
import { readConfigTomlValues, updateConfigTomlValues } from '@/app/actions/configTomlActions';
import { restartServices } from '@/app/actions/services';
import { listBackups, triggerManualBackup } from '@/app/actions/backupActions';
import type { Confirm } from '@/hooks/useConfirm';
import { buildConfigTomlUpdates, type ConfigTomlKey } from '@/lib/config-toml';
import type { ConfirmationCopy } from '@/lib/confirmation-copy';
import { interpolate } from '@/lib/interpolate';
import type { Locale } from '@/lib/locales';

import type {
  MaintenanceGates,
  MaintenanceState,
  MaintenanceToasts,
  Patch,
} from '@/components/system/maintenance-types';

export interface MaintenanceActionConfig {
  readonly locale: Locale;
  readonly toasts: MaintenanceToasts;
  readonly state: MaintenanceState;
  readonly patch: Patch;
  readonly gates: MaintenanceGates;
  readonly confirm: Confirm;
  readonly manualBackupConfirm: ConfirmationCopy['manualBackupConfirm'];
  readonly runAction: (labels: ActionLabels, action: () => Promise<ActionOutcome>) => Promise<ActionOutcome | null>;
}

interface ActionOutcome {
  readonly success: boolean;
  readonly error?: string;
}

interface ActionLabels {
  readonly pending: string;
  readonly success: string;
  readonly failure: string;
  readonly description?: string;
}

interface DiscordSettings {
  readonly configTomlPresent: boolean;
  readonly configWebhookUrl: string;
}

// config.toml [infra], not the generated .env: ./cms config sync rewrites .env from it on every deploy.
const BACKUP_POLICY_KEYS: readonly ConfigTomlKey[] = [
  { section: 'infra', key: 'BACKUP_INTERVAL_MINS' },
  { section: 'infra', key: 'BACKUP_MAX_COUNT' },
  { section: 'infra', key: 'BACKUP_MAX_AGE_DAYS' },
  { section: 'infra', key: 'BACKUP_MAX_SIZE_GB' },
];

const NOTIFICATION_KEYS: readonly ConfigTomlKey[] = [
  { section: 'infra', key: 'DISCORD_WEBHOOK_URL' },
  { section: 'infra', key: 'DISCORD_ROLE_ID' },
];

const MAINTENANCE_CONFIG_KEYS: readonly ConfigTomlKey[] = [
  ...BACKUP_POLICY_KEYS,
  ...NOTIFICATION_KEYS,
];

// Names what config.toml holds, since that is the only file the panel reads the webhook from.
function describeDiscordState(settings: DiscordSettings): string {
  if (!settings.configTomlPresent) {
    return "config.toml not found — run './cms config sync' so saved values survive the next sync.";
  }
  if (settings.configWebhookUrl === '') {
    return 'No webhook configured — monitor alerts are dropped.';
  }
  return 'Webhook configured in config.toml.';
}

export async function loadDiscordSettings(patch: Patch): Promise<void> {
  const result = await getDiscordNotificationSettings();
  if (!result.success) {
    patch((previous) => ({ ...previous, discordError: result.error }));
    return;
  }
  patch((previous) => ({ ...previous, discordState: describeDiscordState(result) }));
}

export async function readArchives(patch: Patch): Promise<void> {
  patch((previous) => ({ ...previous, archivesLoading: true }));
  try {
    const result = await listBackups();
    if (result.success) patch((previous) => ({ ...previous, archives: result.archives ?? [] }));
  } finally {
    patch((previous) => ({ ...previous, archivesLoading: false }));
  }
}

export async function loadMaintenanceData(
  canConfigure: boolean,
  canViewBackups: boolean,
  patch: Patch,
): Promise<void> {
  if (canConfigure) {
    const result = await readConfigTomlValues(MAINTENANCE_CONFIG_KEYS);
    // Throws so the surface can offer a retry: an empty field cannot be told from a failed read.
    if (!result.success) {
      throw new Error(result.error);
    }
    patch((previous) => ({ ...previous, data: result.values }));
    await loadDiscordSettings(patch);
  }
  if (canViewBackups) {
    await readArchives(patch);
  }
}

export async function saveConfiguration(config: MaintenanceActionConfig): Promise<void> {
  const { locale, toasts, state, patch } = config;
  patch((previous) => ({ ...previous, saving: true }));
  try {
    const backupResult = await updateConfigTomlValues(
      buildConfigTomlUpdates(state.data, BACKUP_POLICY_KEYS),
    );
    if (!backupResult.success) {
      toast.error(interpolate(toasts.saveFailed, { error: backupResult.error }));
      return;
    }
    // Its own action, not the config write: a malformed webhook URL silently drops every alert.
    const notificationResult = await saveDiscordNotificationSettings({
      webhookUrl: state.data['DISCORD_WEBHOOK_URL'] ?? '',
      roleId: state.data['DISCORD_ROLE_ID'] ?? '',
    }, locale);
    if (!notificationResult.success) {
      toast.error(interpolate(toasts.notificationSaveFailed, { error: notificationResult.error }));
      return;
    }
    toast.success(toasts.saved);
  } finally {
    patch((previous) => ({ ...previous, saving: false }));
  }
}

export async function persistNotifications(
  config: MaintenanceActionConfig,
  applyToMonitor: boolean,
): Promise<void> {
  const { locale, toasts, state, patch } = config;
  patch((previous) => ({ ...previous, discordSaving: true }));
  try {
    const result = await saveDiscordNotificationSettings({
      webhookUrl: state.data['DISCORD_WEBHOOK_URL'] ?? '',
      roleId: state.data['DISCORD_ROLE_ID'] ?? '',
    }, locale);
    if (!result.success) {
      patch((previous) => ({ ...previous, discordError: result.error }));
      toast.error(interpolate(toasts.notificationSaveFailed, { error: result.error }));
      return;
    }
    patch((previous) => ({ ...previous, discordError: '' }));
    await loadDiscordSettings(patch);
    if (!applyToMonitor) {
      toast.success(toasts.notificationsSaved);
      return;
    }
    await restartMonitorOrWarn(toasts);
  } finally {
    patch((previous) => ({ ...previous, discordSaving: false }));
  }
}

export async function sendTestAlert(config: MaintenanceActionConfig): Promise<void> {
  const { locale, toasts, state, patch } = config;
  patch((previous) => ({ ...previous, discordTesting: true }));
  try {
    const result = await sendTestDiscordAlert({
      webhookUrl: state.data['DISCORD_WEBHOOK_URL'] ?? '',
      roleId: state.data['DISCORD_ROLE_ID'] ?? '',
    }, locale);
    if (result.success) {
      toast.success(interpolate(toasts.testAlertDelivered, { status: result.status }));
      return;
    }
    const message = result.error ?? toasts.testAlertFailedFallback;
    patch((previous) => ({ ...previous, discordError: message }));
    toast.error(interpolate(toasts.testAlertFailed, { message }));
  } finally {
    patch((previous) => ({ ...previous, discordTesting: false }));
  }
}

export async function runManualBackup(
  config: MaintenanceActionConfig,
  reloadArchives: () => Promise<void>,
): Promise<void> {
  const { toasts, patch, confirm, manualBackupConfirm, runAction } = config;
  if (!(await confirm(manualBackupConfirm()))) return;
  patch((previous) => ({ ...previous, backingUp: true }));
  try {
    await runAction(
      { pending: 'Starting backup...', success: toasts.backupTriggered, failure: toasts.failed },
      () => triggerManualBackup(),
    );
    await reloadArchives();
  } finally {
    patch((previous) => ({ ...previous, backingUp: false }));
  }
}

// The audit row records the cause: saving settings recreates the monitor without an operator asking.
const NOTIFICATION_SAVED_RESTART_REASON =
  'Notification settings were saved, so the monitor container was recreated.';

async function restartMonitorOrWarn(toasts: MaintenanceToasts): Promise<void> {
  const restart = await restartServices('custom', ['monitor'], NOTIFICATION_SAVED_RESTART_REASON);
  if (restart.success) {
    toast.success(toasts.notificationsSavedMonitorRecreated);
    return;
  }
  // Partial success: the settings were written, so the operator must hear both facts.
  toast.warning(interpolate(toasts.monitorRestartFailed, { error: restart.error }));
}
