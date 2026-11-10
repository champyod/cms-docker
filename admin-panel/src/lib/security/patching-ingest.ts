import { Prisma } from '@prisma/client';

import { moduleStateMap, type HostModuleFacts } from '@/lib/security/host-module-state';
import {
  classifyReachability,
  SUBSYSTEM_MODULE_NAMES,
  type HostModuleState,
  type Reachability,
} from '@/lib/security/kernel-reachability';
import { MAX_FINDING_KEY_LENGTH } from '@/lib/security/patching';
import type { FeedFindingInput, FeedPush } from '@/lib/security/patching-feed-push';

// Part of this boundary's contract; the number lives beside the vocabulary.
export { MAX_FINDING_KEY_LENGTH };

export interface FeedPushResult {
  readonly received: number;
  readonly resolved: number;
  // Reports whose row a later run already resolved, counted so a racing producer can read why it lost.
  readonly held: number;
  // Whether this push carried a host module snapshot, and so replaced that host's row.
  readonly hostModulesRecorded: boolean;
}

// The host's stored row is the source; the body's snapshot only seeds a host the table has no row for.
async function resolveModuleFacts(
  client: Prisma.TransactionClient,
  push: FeedPush,
): Promise<HostModuleFacts | null> {
  if (push.host === null) return push.hostModules ?? null;
  const stored = await client.security_host_modules.findUnique({
    where: { host: push.host },
    select: { kernel_release: true, loaded: true, blocked: true },
  });
  if (stored === null) return push.hostModules ?? null;
  return {
    kernelRelease: stored.kernel_release,
    loaded: stored.loaded,
    blocked: stored.blocked,
  };
}

// Built once per push: a module question the host never answered stays open rather than guessed.
function moduleStateOf(facts: HostModuleFacts | null): HostModuleState {
  return facts === null ? {} : moduleStateMap(SUBSYSTEM_MODULE_NAMES, facts);
}

// The verdict for one row: its own title, against the module state of the host that reported it.
function reachabilityOf(
  finding: FeedFindingInput,
  pushHost: string | null,
  state: HostModuleState,
): Reachability {
  const host = finding.host ?? pushHost;
  return classifyReachability(finding.title ?? '', host === pushHost ? state : {});
}

function findingData(
  finding: FeedFindingInput,
  envelopeHost: string | null,
  reachability: Reachability,
): Omit<Prisma.security_findingsUncheckedCreateInput, 'source' | 'key'> {
  return {
    kind: finding.kind,
    severity: finding.severity,
    subject: finding.subject,
    installed: finding.installed,
    available: finding.available,
    title: finding.title,
    url: finding.url,
    // No mapper emits a per-finding host, so the envelope's host is the row's only provenance.
    host: finding.host ?? envelopeHost,
    // Stored here and never re-derived on read; a row no longer reported keeps its last verdict.
    reachability,
    detail: finding.detail === null ? Prisma.DbNull : finding.detail,
    // A re-report revives a row an earlier complete push resolved.
    resolved_at: null,
  };
}

// One statement per finding; the returned map holds the keys that have no row yet.
async function writeFindings(
  client: Prisma.TransactionClient,
  push: FeedPush,
  now: Date,
  state: HostModuleState,
): Promise<Map<string, Prisma.security_findingsUncheckedCreateInput>> {
  const unseen = new Map<string, Prisma.security_findingsUncheckedCreateInput>();
  for (const finding of push.findings) {
    const data = findingData(finding, push.host, reachabilityOf(finding, push.host, state));
    // Causal, not last-writer-wins: a row moves only when this run is at least as new as its resolution.
    const touched = await client.security_findings.updateMany({
      where: {
        source: push.source,
        key: finding.key,
        OR: [{ resolved_at: null }, { resolved_at: { lt: push.runStartedAt } }],
      },
      data: { ...data, last_seen: now },
    });
    if (touched.count > 0) continue;
    unseen.set(finding.key, {
      source: push.source,
      key: finding.key,
      ...data,
      first_seen: now,
      last_seen: now,
    });
  }
  return unseen;
}

// Replaces this host's row: the table answers "what is this box running now", stamped by the panel's clock.
async function recordHostModules(
  client: Prisma.TransactionClient,
  host: string,
  facts: HostModuleFacts,
  now: Date,
): Promise<void> {
  await client.security_host_modules.upsert({
    where: { host },
    create: {
      host,
      kernel_release: facts.kernelRelease,
      // Copied into mutable arrays because Prisma's list input is `string[]`, not `readonly string[]`.
      loaded: [...facts.loaded],
      blocked: [...facts.blocked],
      recorded_at: now,
    },
    update: {
      kernel_release: facts.kernelRelease,
      loaded: [...facts.loaded],
      blocked: [...facts.blocked],
      recorded_at: now,
    },
  });
}

// Writes one accepted push; `first_seen` survives a re-push, so the age the audit trail names stays real.
export async function applyFeedPush(
  client: Prisma.TransactionClient,
  push: FeedPush,
  now: Date = new Date(),
): Promise<FeedPushResult> {
  // One read and one map per push: the scan sends its module snapshot once and its findings in batches.
  const state = moduleStateOf(await resolveModuleFacts(client, push));
  const unseen = await writeFindings(client, push, now, state);

  // `unseen` is keyed by finding key, so a producer that repeats a key in one push counts once.
  const created = unseen.size === 0
    ? 0
    : (await client.security_findings.createMany({
        data: [...unseen.values()],
        skipDuplicates: true,
      })).count;
  const held = unseen.size - created;

  // Same transaction as the findings, so a push cannot record CVEs without recording what the kernel runs.
  const modules = push.hostModules ?? null;
  const hostModulesRecorded = push.host !== null && modules !== null;
  if (push.host !== null && modules !== null) {
    await recordHostModules(client, push.host, modules, now);
  }

  if (!push.complete) {
    return { received: push.findings.length, resolved: 0, held, hostModulesRecorded };
  }

  // Resolution is scoped by the run: resolving "everything not in this batch" would erase earlier batches.
  const resolved = await client.security_findings.updateMany({
    where: {
      source: push.source,
      ...(push.host === null
        ? {}
        : {
            // Rows written before the envelope host reached them carry NULL, and no producer can say which box.
            OR: [{ host: push.host }, { host: null }],
          }),
      resolved_at: null,
      last_seen: { lt: push.runStartedAt },
    },
    data: { resolved_at: now },
  });
  return { received: push.findings.length, resolved: resolved.count, held, hostModulesRecorded };
}
