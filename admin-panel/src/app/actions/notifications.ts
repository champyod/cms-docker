'use server';

import fs from 'fs/promises';
import path from 'path';

import { ensurePermission } from '@/lib/permissions';
import { getRepoRoot } from '@/lib/repo-root';
import { recordAudit } from '@/lib/audit';
import { readEnvFile, readEnvFileCore, updateEnvFile } from '@/app/actions/env';
import { getDictionary } from '@/i18n';
import { interpolate } from '@/lib/interpolate';
import {
  buildDiscordAlertPayload,
  postDiscordPayload,
  readTomlValue,
  upsertTomlValue,
  validateDiscordRoleId,
  validateDiscordWebhookUrl,
} from '@/lib/discord-webhook';

const CONFIG_TOML = 'config.toml';
const ENV_FILE = '.env';
const CONFIG_SECTION = 'infra';
const WEBHOOK_KEY = 'DISCORD_WEBHOOK_URL';
const ROLE_KEY = 'DISCORD_ROLE_ID';

interface DiscordNotificationInput {
  webhookUrl: string;
  roleId: string;
}

async function readConfigToml(): Promise<string | null> {
  try {
    return await fs.readFile(path.join(getRepoRoot(), CONFIG_TOML), 'utf-8');
  } catch {
    // Absent config.toml is a normal state on a fresh worktree: callers decide what to do.
    return null;
  }
}

/**
 * Reads the saved webhook settings from config.toml (source of truth) next to the value the
 * running monitor actually consumes from .env, so the operator can see when they diverge.
 */
export async function getDiscordNotificationSettings() {
  await ensurePermission('env:read');
  try {
    const configToml = await readConfigToml();
    // The audited read, unlike the test-alert path below: this is the settings screen showing the
    // operator the effective webhook URL, so the disclosure is the point of the call.
    const envResult = await readEnvFile(ENV_FILE);
    const envConfig = envResult.success && envResult.config ? envResult.config : {};

    return {
      success: true as const,
      configTomlPresent: configToml !== null,
      configWebhookUrl: configToml === null ? '' : readTomlValue(configToml, CONFIG_SECTION, WEBHOOK_KEY),
      effectiveWebhookUrl: envConfig[WEBHOOK_KEY] ?? '',
    };
  } catch (error) {
    return { success: false as const, error: (error as Error).message };
  }
}

/**
 * Persists the webhook settings to config.toml (so `./cms config sync` keeps them) and to
 * .env (so the next container start picks them up immediately). Invalid values are rejected
 * rather than stored: a wrong URL silently disables every alert.
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
    if (configToml === null) {
      return {
        success: false as const,
        error: interpolate(discordToasts.configTomlMissing, { configToml: CONFIG_TOML }),
      };
    }

    const updatedToml = upsertTomlValue(
      upsertTomlValue(configToml, CONFIG_SECTION, WEBHOOK_KEY, webhook.value),
      CONFIG_SECTION,
      ROLE_KEY,
      role.value,
    );
    await fs.writeFile(path.join(getRepoRoot(), CONFIG_TOML), updatedToml, 'utf-8');

    const envResult = await updateEnvFile(ENV_FILE, {
      [WEBHOOK_KEY]: webhook.value,
      [ROLE_KEY]: role.value,
    });
    if (!envResult.success) {
      return {
        success: false as const,
        error: interpolate(discordToasts.envWriteFailed, {
          configToml: CONFIG_TOML,
          envFile: ENV_FILE,
          error: envResult.error,
        }),
      };
    }

    // Why: the webhook URL is a credential — record that it changed, never its value.
    await recordAudit({
      verb: 'env:update',
      entity: 'discord_notification',
      afterValues: {
        configToml: CONFIG_TOML,
        envFile: ENV_FILE,
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
export async function sendTestDiscordAlert(input: Partial<DiscordNotificationInput> | undefined, locale: string) {
  await ensurePermission('monitor:test');
  const discordToasts = (await getDictionary(locale)).toasts.discord;

  const suppliedUrl = input?.webhookUrl ?? '';
  let targetUrl = suppliedUrl.trim();

  if (targetUrl === '') {
    // Unaudited on purpose: this is the alert action resolving the URL it needs, not a read of
    // the env file, and the test alert it goes on to send is the recorded act.
    const envResult = await readEnvFileCore(ENV_FILE);
    targetUrl = (envResult.success && envResult.config ? envResult.config[WEBHOOK_KEY] : '') ?? '';
  }

  const webhook = validateDiscordWebhookUrl(targetUrl);
  if (!webhook.ok) {
    return { success: false as const, error: webhook.error, status: 0 };
  }
  if (webhook.value === '') {
    return {
      success: false as const,
      error: discordToasts.noWebhookUrl,
      status: 0,
    };
  }

  const suppliedRole = input?.roleId ?? '';
  const role = validateDiscordRoleId(suppliedRole.trim() === '' ? '' : suppliedRole);
  if (!role.ok) {
    return { success: false as const, error: role.error, status: 0 };
  }

  const payload = buildDiscordAlertPayload({
    title: discordToasts.testAlertTitle,
    description: discordToasts.testAlertDescription,
    roleId: role.value,
    footerText: 'CMS Admin Panel',
  });

  const delivery = await postDiscordPayload(webhook.value, payload);
  if (!delivery.success) {
    return { success: false as const, error: delivery.error ?? discordToasts.deliveryFailed, status: delivery.status };
  }
  return { success: true as const, status: delivery.status };
}
