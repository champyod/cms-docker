'use server';

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import { revalidatePath } from 'next/cache';

import { recordAudit } from '@/lib/audit';
import { resolveHostComposeLocation } from '@/lib/compose-location';
import { CONFIG_TOML_FILE } from '@/lib/config-toml';
import { runConfigSync } from '@/lib/deploy-config';
import { readDeploymentModeSetting } from '@/lib/deployment-mode-file';
import { logToDiscord } from '@/lib/discord-notifier';
import { ensurePermission } from '@/lib/permissions';
import { getRepoRoot } from '@/lib/repo-root';
import { buildComposeFileFlags } from '@/lib/restart-planner';
import { parseWafAuditEntries, type WafAlert } from '@/lib/security/waf-audit-log';
import { WAF_SERVICE, buildWafRecreateCommand, buildWafRestartCommand } from '@/lib/security/waf-compose';
import {
  WAF_CRS_FILE,
  readWafCrsSettings,
  readWafTomlSettings,
  validateWafSettings,
  writeWafCrsSettings,
  writeWafTomlSettings,
  type WafCrsSettings,
  type WafSettings,
  type WafSettingsInput,
} from '@/lib/security/waf-config';

const execPromise = util.promisify(exec);

const COMMAND_TIMEOUT_MS = 180_000;
const INSPECT_TIMEOUT_MS = 15_000;
const WAF_PAGE_PATH = '/[locale]/security/waf';
const WAF_CRS_BACKUP_SUFFIX = '.bak';
const WAF_AUDIT_PATH_ENV = 'WAF_AUDIT_LOG_PATH';
const DEFAULT_WAF_AUDIT_PATH = '/var/log/waf/modsec_audit.log';
const AUDIT_TAIL_LINES = 2000;

export interface WafState {
  readonly settings: WafSettings;
  readonly crs: WafCrsSettings | null;
  readonly containerStatus: string | null;
  readonly alerts: readonly WafAlert[];
  readonly skippedAlertLines: number;
}

export interface WafActionResult {
  readonly success: boolean;
  readonly error?: string;
  readonly output?: string;
}

function settingsFile(): string {
  return path.join(getRepoRoot(), CONFIG_TOML_FILE);
}

function crsFile(): string {
  return path.join(getRepoRoot(), WAF_CRS_FILE);
}

function auditLogPath(): string {
  const configured = process.env[WAF_AUDIT_PATH_ENV]?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_WAF_AUDIT_PATH;
}

async function readTextOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function readWafAuditTail(): Promise<string> {
  try {
    const { stdout } = await execPromise(`tail -n ${AUDIT_TAIL_LINES} ${auditLogPath()}`, { timeout: INSPECT_TIMEOUT_MS });
    return stdout;
  } catch {
    return '';
  }
}

async function inspectWafStatus(): Promise<string | null> {
  try {
    const { stdout } = await execPromise(`docker inspect ${WAF_SERVICE} --format '{{.State.Status}}'`, {
      timeout: INSPECT_TIMEOUT_MS,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Reads what the panel may show: config.toml keys, the mounted CRS file, container state and alerts. */
export async function readWafState(): Promise<WafState> {
  await ensurePermission('security:read');
  await ensurePermission('waf:read');
  const [tomlContent, crsContent, containerStatus, auditTail] = await Promise.all([
    readTextOrNull(settingsFile()),
    readTextOrNull(crsFile()),
    inspectWafStatus(),
    readWafAuditTail(),
  ]);
  const parsed = parseWafAuditEntries(auditTail);
  const state: WafState = {
    settings: readWafTomlSettings(tomlContent ?? ''),
    crs: crsContent === null ? null : readWafCrsSettings(crsContent),
    containerStatus,
    alerts: parsed.alerts,
    skippedAlertLines: parsed.skippedLines,
  };
  await recordAudit({
    verb: 'waf:view',
    entity: 'security',
    afterValues: { file: CONFIG_TOML_FILE, containerStatus, alerts: state.alerts.length },
    result: 'success',
  });
  return state;
}

async function writeAtomic(filePath: string, content: string): Promise<void> {
  const temporary = `${filePath}.tmp`;
  await fs.writeFile(temporary, content, 'utf-8');
  await fs.rename(temporary, filePath);
}

async function persistWafSettings(input: WafSettingsInput, tomlContent: string, crsContent: string | null): Promise<WafSettings> {
  const { settings, errors } = validateWafSettings(input);
  if (settings === null) throw new Error(errors.join('; '));
  await writeAtomic(settingsFile(), writeWafTomlSettings(tomlContent, settings));
  if (crsContent !== null) {
    await fs.copyFile(crsFile(), `${crsFile()}${WAF_CRS_BACKUP_SUFFIX}`);
    await writeAtomic(crsFile(), writeWafCrsSettings(crsContent, {
      paranoia: settings.paranoia,
      anomalyInbound: settings.anomalyInbound,
      anomalyOutbound: settings.anomalyOutbound,
    }));
  }
  return settings;
}

export async function saveWafSettings(input: WafSettingsInput, reason: string): Promise<WafActionResult> {
  await ensurePermission('waf:config');
  if (reason.trim().length === 0) return { success: false, error: 'A reason is required to change WAF settings' };
  try {
    const [tomlContent, crsContent] = await Promise.all([readTextOrNull(settingsFile()), readTextOrNull(crsFile())]);
    if (tomlContent === null) return { success: false, error: `${CONFIG_TOML_FILE} not found — run config sync once` };
    const settings = await persistWafSettings(input, tomlContent, crsContent);
    await recordAudit({
      verb: 'waf:config:update',
      entity: 'security',
      entityId: WAF_SERVICE,
      afterValues: { file: CONFIG_TOML_FILE, settings },
      reason,
      result: 'success',
    });
    revalidatePath(WAF_PAGE_PATH, 'page');
    return { success: true };
  } catch (error: unknown) {
    await recordAudit({ verb: 'waf:config:update', entity: 'security', entityId: WAF_SERVICE, reason, result: 'failure' });
    return { success: false, error: (error as Error).message };
  }
}

async function runWafCommand(command: string): Promise<WafActionResult> {
  const rootDir = getRepoRoot();
  try {
    const { stdout, stderr } = await execPromise(command, { cwd: rootDir, timeout: COMMAND_TIMEOUT_MS });
    if (stderr.includes('error')) return { success: false, error: stderr };
    return { success: true, output: stdout };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

/** Regenerates .env from config.toml and recreates the WAF container, so a mode change takes effect. */
export async function applyWafSettings(reason: string): Promise<WafActionResult> {
  await ensurePermission('waf:control');
  if (reason.trim().length === 0) return { success: false, error: 'A reason is required to apply WAF settings' };
  const location = await resolveHostComposeLocation();
  if (!location.ok) return { success: false, error: location.error };
  try {
    await runConfigSync();
    const files = await buildComposeFileFlags();
    const mode = (await readDeploymentModeSetting()).mode;
    const command = buildWafRecreateCommand(files, mode, location.location);
    const result = await runWafCommand(command);
    await recordAudit({
      verb: 'waf:control:apply',
      entity: 'security',
      entityId: WAF_SERVICE,
      afterValues: { mode },
      reason,
      result: result.success ? 'success' : 'failure',
    });
    if (result.success) {
      await logToDiscord('WAF Applied', `WAF recreated (${mode}) by the admin panel`, 15105570, true);
      revalidatePath(WAF_PAGE_PATH, 'page');
    }
    return result;
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

/** Restarts the container only, which is enough for a CRS threshold change (the file is remounted). */
export async function restartWaf(reason: string): Promise<WafActionResult> {
  await ensurePermission('waf:control');
  if (reason.trim().length === 0) return { success: false, error: 'A reason is required to restart the WAF' };
  const result = await runWafCommand(buildWafRestartCommand());
  await recordAudit({
    verb: 'waf:control:restart',
    entity: 'security',
    entityId: WAF_SERVICE,
    reason,
    result: result.success ? 'success' : 'failure',
  });
  if (result.success) revalidatePath(WAF_PAGE_PATH, 'page');
  return result;
}
