'use server';

import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';

import { getCurrentUser } from '@/app/actions/auth';
import { recordAudit } from '@/lib/audit';
import { ensurePermission } from '@/lib/permissions';
import { getRepoRoot } from '@/lib/repo-root';
import { listBlocks, type SecurityBlock } from '@/lib/security/block-ledger';
import { releaseLoginLockout } from '@/lib/security/lockouts';
import {
  FAIL2BAN_JAIL_FILE,
  SECURITY_AGENT_DIR,
  SECURITY_AGENT_QUEUE_DIR,
  SECURITY_AGENT_RESULTS_DIR,
  SECURITY_AGENT_STATE_FILE,
  buildUnbanRequest,
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

export async function readLoginLockouts(): Promise<readonly SecurityBlock[]> {
  await ensurePermission('security:read');
  await ensurePermission('lockout:read');
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
  const state = await readAgentState();
  if (state === null) {
    return { success: false, error: 'The host security agent has not reported any state, so no unban was queued' };
  }
  if (!state.bans.some((ban) => ban.jail === jail && ban.ip === ip)) {
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
