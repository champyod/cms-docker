'use server';

import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';

import { getCurrentUser } from '@/app/actions/auth';
import { recordAudit } from '@/lib/audit';
import { ensurePermission } from '@/lib/permissions';
import { getRepoRoot } from '@/lib/repo-root';
import { describeLineage, type CertificateStatus } from '@/lib/security/cert-status';
import {
  SECURITY_AGENT_DIR,
  SECURITY_AGENT_QUEUE_DIR,
  SECURITY_AGENT_RESULTS_DIR,
  buildRenewRequest,
  serializeRequest,
} from '@/lib/security/security-agent-protocol';

const TLS_PAGE_PATH = '/[locale]/security/tls';
const LETSENCRYPT_DIR = 'config/letsencrypt/live';
const PROXY_CONTAINER = 'grader-nginx-proxy';
const CERTBOT_CONTAINER = 'grader-certbot';

export interface TlsState {
  readonly lineages: readonly CertificateStatus[];
  readonly unreadableLineages: readonly string[];
  readonly proxyStatus: string | null;
  readonly certbotStatus: string | null;
}

export interface TlsActionResult {
  readonly success: boolean;
  readonly error?: string;
  readonly message?: string;
}

function letsencryptDirectory(): string {
  return path.join(getRepoRoot(), LETSENCRYPT_DIR);
}

async function containerStatus(name: string): Promise<string | null> {
  const { exec } = await import('child_process');
  const util = await import('util');
  try {
    const { stdout } = await util.promisify(exec)(`docker inspect ${name} --format '{{.State.Status}}'`, { timeout: 15_000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function readLineage(pemPath: string, lineage: string): Promise<CertificateStatus | null> {
  try {
    return describeLineage(lineage, await fs.readFile(pemPath, 'utf-8'));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Reads the lineages under config/letsencrypt/live plus both ingress container states. */
export async function readTlsState(): Promise<TlsState> {
  await ensurePermission('security:read');
  await ensurePermission('tls:read');
  const directory = letsencryptDirectory();
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const lineageNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const statuses = await Promise.all(
    lineageNames.map((lineage) => readLineage(path.join(directory, lineage, 'fullchain.pem'), lineage)),
  );
  const [proxyStatus, certbotStatus] = await Promise.all([
    containerStatus(PROXY_CONTAINER),
    containerStatus(CERTBOT_CONTAINER),
  ]);
  const state: TlsState = {
    lineages: statuses.filter((status): status is CertificateStatus => status !== null),
    unreadableLineages: lineageNames.filter((_, index) => statuses[index] === null),
    proxyStatus,
    certbotStatus,
  };
  await recordAudit({
    verb: 'tls:view',
    entity: 'security',
    afterValues: { lineages: state.lineages.length, proxyStatus, certbotStatus },
    result: 'success',
  });
  return state;
}

/** Renewal runs on the host (scripts/__domain.sh renew); the panel only queues it. */
export async function requestCertificateRenewal(reason: string): Promise<TlsActionResult> {
  await ensurePermission('tls:renew');
  if (reason.trim().length === 0) return { success: false, error: 'A reason is required to renew certificates' };
  const admin = await getCurrentUser();
  const built = buildRenewRequest({
    id: randomUUID(),
    requestedBy: admin?.username ?? 'unknown',
    reason,
    requestedAt: new Date().toISOString(),
  });
  if (built.request === null) return { success: false, error: built.errors.join('; ') };
  const queueDirectory = path.join(getRepoRoot(), SECURITY_AGENT_DIR, SECURITY_AGENT_QUEUE_DIR);
  await fs.mkdir(queueDirectory, { recursive: true });
  await fs.mkdir(path.join(getRepoRoot(), SECURITY_AGENT_DIR, SECURITY_AGENT_RESULTS_DIR), { recursive: true });
  await fs.writeFile(path.join(queueDirectory, `${built.request.id}.json`), serializeRequest(built.request), 'utf-8');
  await recordAudit({
    verb: 'tls:renew:queue',
    entity: 'security',
    entityId: built.request.id,
    afterValues: { requestId: built.request.id },
    reason,
    result: 'success',
  });
  revalidatePath(TLS_PAGE_PATH, 'page');
  return { success: true, message: 'Renewal queued; the host agent runs scripts/__domain.sh renew on its next tick.' };
}
