'use server';

import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';

import { getCurrentUser } from '@/app/actions/auth';
import { recordAudit } from '@/lib/audit';
import { clearLoginLockout } from '@/lib/login-lockouts';
import { ensurePermission } from '@/lib/permissions';
import { lockoutRedisUrl } from '@/lib/redis-lockouts';
import { getRepoRoot } from '@/lib/repo-root';
import { expireStaleBlocks, listBlocks, type SecurityBlock } from '@/lib/security/block-ledger';
import {
  listCounterAttempts,
  listLoginActivity,
  type CounterAttemptsResult,
  type LoginActivity,
} from '@/lib/security/login-activity';
import { releaseLoginLockout } from '@/lib/security/lockouts';
import {
  FAIL2BAN_JAIL_FILE,
  SECURITY_AGENT_DIR,
  SECURITY_AGENT_QUEUE_DIR,
  SECURITY_AGENT_RESULTS_DIR,
  SECURITY_AGENT_STATE_FILE,
  buildUnbanRequest,
  isKnownUnbanned,
  isValidIpAddress,
  parseFail2banState,
  parseJailNames,
  serializeRequest,
  type Fail2banState,
  type SecurityAgentRequest,
} from '@/lib/security/security-agent-protocol';

const BLOCKS_PAGE_PATH = '/[locale]/security/blocks';
const LOOPBACK_IP = 'local';

export interface BannedAddress {
  readonly jail: string;
  readonly ip: string;
  readonly bannedAt: string | null;
  readonly expiresAt: string | null;
}

export interface BannedAddressView {
  readonly bans: readonly BannedAddress[];
  readonly jailNames: readonly string[];
  readonly agentStateUpdatedAt: string | null;
  readonly agentReported: boolean;
}

export interface BlocksActionResult {
  readonly success: boolean;
  readonly error?: string;
  readonly message?: string;
}

function agentDirectory(...segments: string[]): string {
  return path.join(getRepoRoot(), SECURITY_AGENT_DIR, ...segments);
}

async function readTextOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function readJailNames(): Promise<readonly string[]> {
  const content = await readTextOrNull(path.join(getRepoRoot(), FAIL2BAN_JAIL_FILE));
  return content === null ? [] : parseJailNames(content);
}

async function readAgentState(): Promise<Fail2banState | null> {
  return parseFail2banState(await readTextOrNull(agentDirectory(SECURITY_AGENT_STATE_FILE)));
}

async function currentUsername(): Promise<string> {
  const admin = await getCurrentUser();
  return admin?.username ?? 'unknown';
}

export async function readBannedAddresses(): Promise<BannedAddressView> {
  await ensurePermission('security:read');
  await ensurePermission('ban:read');
  const [jailNames, state] = await Promise.all([readJailNames(), readAgentState()]);
  await recordAudit({
    verb: 'ban:view',
    entity: 'security',
    afterValues: { jails: jailNames, bans: state?.bans.length ?? 0, agentReported: state !== null },
    result: 'success',
  });
  return {
    bans: state?.bans ?? [],
    jailNames,
    agentStateUpdatedAt: state?.updatedAt ?? null,
    agentReported: state !== null,
  };
}

/**
 * Every login lockout, read from the ledger the web servers write to. The counter a
 * lockout is enforced from lives in the shared store; this row is the operator's record
 * of it, so a row whose expiry has passed is closed before the list is read rather than
 * shown as a live lockout nobody can lift.
 */
export async function readLoginLockouts(): Promise<readonly SecurityBlock[]> {
  await ensurePermission('security:read');
  await ensurePermission('lockout:read');
  await expireStaleBlocks();
  const open = await listBlocks({ kind: 'login_lockout', active: true });
  await recordAudit({
    verb: 'lockout:view',
    entity: 'security',
    afterValues: { open: open.length },
    result: 'success',
  });
  return open;
}

async function writeQueueRequest(request: SecurityAgentRequest): Promise<void> {
  await fs.mkdir(agentDirectory(SECURITY_AGENT_QUEUE_DIR), { recursive: true });
  await fs.mkdir(agentDirectory(SECURITY_AGENT_RESULTS_DIR), { recursive: true });
  await fs.writeFile(agentDirectory(SECURITY_AGENT_QUEUE_DIR, `${request.id}.json`), serializeRequest(request), 'utf-8');
}

/** Queues an unban for the host agent; the panel never runs fail2ban itself. */
export async function queueUnban(jail: string, ip: string, reason: string): Promise<BlocksActionResult> {
  await ensurePermission('ban:unban');
  if (reason.trim().length === 0) return { success: false, error: 'A reason is required to unban an address' };
  const built = buildUnbanRequest({
    id: randomUUID(),
    jail,
    ip,
    requestedBy: await currentUsername(),
    reason,
    knownJails: await readJailNames(),
    requestedAt: new Date().toISOString(),
  });
  if (built.request === null) return { success: false, error: built.errors.join('; ') };
  // WHY a missing agent report is not a refusal: the request is consumed when the
  // agent next runs, so a panel that has never seen state can still queue one.
  // Refusing without state is what made every unban dead on a host whose agent was
  // down, leaving an operator no recovery path but a manual edit.
  const state = await readAgentState();
  if (isKnownUnbanned(state, jail, ip)) {
    return { success: false, error: `${ip} is not currently banned in ${jail}` };
  }
  await writeQueueRequest(built.request);
  await recordAudit({
    verb: 'ban:unban:queue',
    entity: 'security',
    entityId: `${jail}/${ip}`,
    afterValues: { requestId: built.request.id, jail, ip },
    reason,
    result: 'success',
  });
  revalidatePath(BLOCKS_PAGE_PATH, 'page');
  return { success: true, message: 'Unban queued; the host agent applies it on its next tick.' };
}

export async function unlockLoginLockout(username: string, ip: string, reason: string): Promise<BlocksActionResult> {
  await ensurePermission('lockout:unlock');
  if (reason.trim().length === 0) return { success: false, error: 'A reason is required to lift a lockout' };
  if (username.trim().length === 0) return { success: false, error: 'A username is required' };
  if (ip !== LOOPBACK_IP && !isValidIpAddress(ip)) return { success: false, error: 'Not a valid IP address' };
  const admin = await getCurrentUser();
  const closed = await releaseLoginLockout(username, ip, admin?.id ?? 0, reason);
  revalidatePath(BLOCKS_PAGE_PATH, 'page');
  return {
    success: true,
    message: closed > 0 ? `Lockout lifted for ${username}` : `No open lockout row for ${username} — the in-memory counter was cleared`,
  };
}

export type LoginActivityResult =
  | { readonly ok: true; readonly rows: readonly LoginActivity[] }
  | { readonly ok: false; readonly error: string };

/**
 * Every live login-failure counter, read from the shared store. The counters are
 * the enforcement; the ledger read above is the record of the lockouts they
 * produced. Absent Redis the counters are unreadable, which is reported rather
 * than shown as an empty list.
 */
export async function readLoginActivity(): Promise<LoginActivityResult> {
  await ensurePermission('security:read');
  await ensurePermission('lockout:read');
  const url = lockoutRedisUrl();
  if (url === null) return { ok: false, error: 'REDIS_URL is not configured' };
  try {
    return { ok: true, rows: await listLoginActivity(url) };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/**
 * The attempts behind one live counter, read lazily when an operator expands the
 * row. It is a detail of the already-audited list above, so it writes no audit row
 * of its own.
 */
export async function readCounterAttempts(key: string): Promise<CounterAttemptsResult> {
  await ensurePermission('security:read');
  await ensurePermission('lockout:read');
  return listCounterAttempts(key);
}

/**
 * Lifts one live counter. The clear routes through the counter's own namespace,
 * so a ranking-surface key is cleared from this page exactly as a contest one is
 * — the divergence the ranking screen used to paper over with its own prefix.
 */
export async function clearLoginActivity(key: string, reason: string): Promise<BlocksActionResult> {
  await ensurePermission('lockout:unlock');
  if (reason.trim().length === 0) return { success: false, error: 'A reason is required to lift a lockout' };
  const url = lockoutRedisUrl();
  if (url === null) return { success: false, error: 'REDIS_URL is not configured' };
  const cleared = await clearLoginLockout(url, key);
  await recordAudit({
    verb: 'lockout:unlock',
    entity: 'security',
    entityId: key,
    afterValues: { cleared },
    reason,
    result: 'success',
  });
  revalidatePath(BLOCKS_PAGE_PATH, 'page');
  return { success: true, message: cleared > 0 ? `Cleared the counter for ${key}` : 'No counter held that key' };
}

