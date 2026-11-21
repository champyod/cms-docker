'use server';

import path from 'path';

import { ensurePermission } from '@/lib/permissions';
import { getRepoRoot } from '@/lib/repo-root';
import { recordAudit } from '@/lib/audit';
import { readConfigFile, type ConfigFileRead } from '@/lib/config-file';
import { updateConfigTomlValues } from '@/app/actions/configTomlActions';
import { getDictionary } from '@/i18n';
import { interpolate } from '@/lib/interpolate';
import {
  buildDiscordAlertPayload,
  postDiscordPayload,
  readTomlValue,
  validateDiscordRoleId,
  validateDiscordWebhookUrl,
} from '@/lib/discord-webhook';

const CONFIG_TOML = 'config.toml';
const CONFIG_SECTION = 'infra';
const WEBHOOK_KEY = 'DISCORD_WEBHOOK_URL';
const ROLE_KEY = 'DISCORD_ROLE_ID';

interface DiscordNotificationInput {
  webhookUrl: string;
  roleId: string;
}

/**
 * The config.toml read, with "absent" and "unreadable" kept apart: a settings read that folds a
 * permission refusal into "absent" shows the operator an empty value where the file existed and
 * merely could not be opened — the read fault this screen must report instead.
 */
async function readConfigToml(): Promise<ConfigFileRead> {
  return readConfigFile(path.join(getRepoRoot(), CONFIG_TOML));
}

/**
 * Reads the saved webhook settings from config.toml, the one file the panel writes them to and
 * reads them back from. The generated .env is a render of that file, so reading it here would
 * show a value the next `./cms config sync` is free to replace.
 */
export async function getDiscordNotificationSettings() {
  await ensurePermission('env:read');
  try {
    const configToml = await readConfigToml();
    if (configToml.kind === 'unreadable') {
      return { success: false as const, error: configToml.reason };
    }

    return {
      success: true as const,
      configTomlPresent: configToml.kind === 'ok',
      configWebhookUrl: configToml.kind === 'absent'
        ? ''
        : readTomlValue(configToml.content, CONFIG_SECTION, WEBHOOK_KEY),
    };
  } catch (error) {
    return { success: false as const, error: (error as Error).message };
  }
}

/**
 * Persists the webhook settings to config.toml, the file `./cms config sync` regenerates .env
 * from. Invalid values are rejected rather than stored: a wrong URL silently disables every alert.
 *
 * `locale` comes from the calling panel page so the returned message is in the admin's language;
 * an unknown locale falls back to English inside `getDictionary`.
 */
export async function saveDiscordNotificationSettings(input: DiscordNotificationInput, locale: string) {
  await ensurePermission('env:update');
  const discordToasts = (await getDictionary(locale)).toasts.discord;

  const webhook = validateDiscordWebhookUrl(input.webhookUrl);
  if (!webhook.ok) {
    return { success: false as const, error: webhook.error };
  }
  const role = validateDiscordRoleId(input.roleId);
  if (!role.ok) {
    return { success: false as const, error: role.error };
  }

  try {
    const configToml = await readConfigToml();
    if (configToml.kind === 'unreadable') {
      return { success: false as const, error: configToml.reason };
    }
    if (configToml.kind === 'absent') {
      return {
        success: false as const,
        error: interpolate(discordToasts.configTomlMissing, { configToml: CONFIG_TOML }),
      };
    }

    // Why the shared writer: this is the same write the settings screen performs, so the panel
    // has one config.toml writer rather than two that could resolve a section differently.
    const written = await updateConfigTomlValues([
      { section: CONFIG_SECTION, key: WEBHOOK_KEY, value: webhook.value },
      { section: CONFIG_SECTION, key: ROLE_KEY, value: role.value },
    ]);
    if (!written.success) {
      return { success: false as const, error: written.error };
    }

    // Why: the webhook URL is a credential — record that it changed, never its value.
    await recordAudit({
      verb: 'env:update',
      entity: 'discord_notification',
      afterValues: {
        configToml: CONFIG_TOML,
        webhookConfigured: webhook.value !== '',
        roleIdSet: role.value !== '',
      },
      result: 'success',
    });

    return { success: true as const };
  } catch (error) {
    return { success: false as const, error: (error as Error).message };
  }
}

/**
 * Posts a real alert through the same payload shape the monitor sends and reports the HTTP
 * result, so an operator can prove delivery without waiting for an incident.
 */
type TestAlertTarget =
  | { ok: true; webhook: string; usedConfiguredWebhook: boolean; hasRoleId: boolean }
  | { ok: false; error: string; usedConfiguredWebhook: boolean; hasRoleId: boolean };

/**
 * Works out where a test alert would go, without sending anything. A webhook the caller supplies
 * wins over the configured one, so the flag records which of the two an attempt would have used.
 */
async function resolveTestAlertTarget(
  input: Partial<DiscordNotificationInput> | undefined,
  noWebhookUrlMessage: string,
): Promise<TestAlertTarget> {
  const suppliedUrl = input?.webhookUrl ?? '';
  let targetUrl = suppliedUrl.trim();
  let usedConfiguredWebhook = false;

  if (targetUrl === '') {
    // Unaudited on purpose: this is the alert action resolving the URL it needs, and the alert it
    // goes on to send is the recorded act.
    // Why the same pair the env-file read carried: the fallback still discloses a stored
    // credential, so it stays behind the read gate rather than riding on monitor:test alone.
    await ensurePermission('env:read');
    await ensurePermission('env:list');
    const configToml = await readConfigToml();
    // Why the read failure is reported: an unread config.toml would otherwise resolve to "no
    // webhook configured" and send the operator after a URL the file may well hold.
    if (configToml.kind === 'unreadable') {
      return { ok: false, error: configToml.reason, usedConfiguredWebhook: true, hasRoleId: false };
    }
    targetUrl = configToml.kind === 'absent'
      ? ''
      : readTomlValue(configToml.content, CONFIG_SECTION, WEBHOOK_KEY);
    usedConfiguredWebhook = true;
  }

  const webhook = validateDiscordWebhookUrl(targetUrl);
  if (!webhook.ok) {
    return { ok: false, error: webhook.error, usedConfiguredWebhook, hasRoleId: false };
  }
  if (webhook.value === '') {
    return { ok: false, error: noWebhookUrlMessage, usedConfiguredWebhook, hasRoleId: false };
  }

  const suppliedRole = (input?.roleId ?? '').trim();
  const role = validateDiscordRoleId(suppliedRole === '' ? '' : suppliedRole);
  if (!role.ok) {
    return { ok: false, error: role.error, usedConfiguredWebhook, hasRoleId: false };
  }

  return { ok: true, webhook: webhook.value, usedConfiguredWebhook, hasRoleId: suppliedRole !== '' };
}

/**
 * The test alert's own row. Why it is recorded at all: this is the one action that makes the panel
 * post to an external service on demand, so "who sent a test alert, whose webhook, did it arrive"
 * is a question the log has to answer. Booleans and the delivery status only — the webhook URL is
 * a secret, and a role id is somebody else's mention permission.
 */
async function recordTestAlert(delivered: boolean, target: TestAlertTarget, status: number): Promise<void> {
  await recordAudit({
    verb: 'notification:test',
    entity: 'notification',
    afterValues: {
      delivered,
      usedConfiguredWebhook: target.usedConfiguredWebhook,
      hasRoleId: target.hasRoleId,
      status,
    },
    result: delivered ? 'success' : 'failure',
  });
}

export async function sendTestDiscordAlert(input: Partial<DiscordNotificationInput> | undefined, locale: string) {
  await ensurePermission('monitor:test');
  const discordToasts = (await getDictionary(locale)).toasts.discord;

  const target = await resolveTestAlertTarget(input, discordToasts.noWebhookUrl);
  if (!target.ok) {
    await recordTestAlert(false, target, 0);
    return { success: false as const, error: target.error, status: 0 };
  }

  const payload = buildDiscordAlertPayload({
    title: discordToasts.testAlertTitle,
    description: discordToasts.testAlertDescription,
    roleId: (input?.roleId ?? '').trim(),
    footerText: 'CMS Admin Panel',
  });

  const delivery = await postDiscordPayload(target.webhook, payload);
  await recordTestAlert(delivery.success, target, delivery.status);
  if (!delivery.success) {
    return { success: false as const, error: delivery.error ?? discordToasts.deliveryFailed, status: delivery.status };
  }
  return { success: true as const, status: delivery.status };
}
