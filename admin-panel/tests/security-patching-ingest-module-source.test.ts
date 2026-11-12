import type { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { applyFeedPush } from '@/lib/security/patching-ingest';
import type { FeedPush } from '@/lib/security/patching-feed-push';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const HOST = 'como-main';

interface StoredModules {
  readonly kernel_release: string;
  readonly loaded: readonly string[];
  readonly blocked: readonly string[];
}

interface WrittenFinding {
  readonly key: string;
  readonly reachability: string;
}

interface HostWrite {
  readonly host: string;
  readonly kernel_release: string;
  readonly loaded: readonly string[];
  readonly blocked: readonly string[];
}

// A client that keeps both writes applyFeedPush makes, so a verdict is read back, not assumed.
function fakeClient(hostRows: Map<string, StoredModules>): {
  client: Prisma.TransactionClient;
  written: WrittenFinding[];
  reads: () => number;
  hostRow: () => StoredModules | undefined;
} {
  const written: WrittenFinding[] = [];
  let reads = 0;
  const client = {
    security_host_modules: {
      findUnique: async (args: { where: { host: string } }): Promise<StoredModules | null> => {
        reads += 1;
        return hostRows.get(args.where.host) ?? null;
      },
      upsert: async (args: { where: { host: string }; create: HostWrite; update: HostWrite }): Promise<HostWrite> => {
        const row: HostWrite = {
          host: args.where.host,
          kernel_release: args.update.kernel_release,
          loaded: [...args.update.loaded],
          blocked: [...args.update.blocked],
        };
        hostRows.set(args.where.host, row);
        return row;
      },
    },
    security_findings: {
      // Every finding here is new, so the create path is the one that carries the verdict.
      updateMany: async (): Promise<{ count: number }> => ({ count: 0 }),
      findMany: async (): Promise<ReadonlyArray<{ id: number; key: string; reachability: string }>> => [],
      createMany: async (args: { data: WrittenFinding[] }): Promise<{ count: number }> => {
        written.push(...args.data);
        return { count: args.data.length };
      },
    },
    // A flip needs a stored verdict to change FROM; with none, the waiver read is never reached.
    security_waivers: { findMany: async (): Promise<ReadonlyArray<unknown>> => [] },
    security_finding_flips: {
      upsert: async (): Promise<Record<string, never>> => ({}),
      updateMany: async (): Promise<{ count: number }> => ({ count: 0 }),
    },
  };
  return {
    client: client as unknown as Prisma.TransactionClient,
    written,
    reads: (): number => reads,
    hostRow: (): StoredModules | undefined => hostRows.get(HOST),
  };
}

function finding(key: string, title: string): FeedPush['findings'][number] {
  return {
    key,
    kind: 'os-package',
    severity: 'HIGH',
    subject: 'linux',
    installed: '5.15.0-203',
    available: '5.15.0-204',
    title,
    url: null,
    host: null,
    detail: null,
  };
}

function push(overrides: Partial<FeedPush> = {}): FeedPush {
  return {
    source: 'rootfs',
    host: HOST,
    findings: [finding('CVE-2026-1|linux', 'kernel: ksmbd: use-after-free')],
    complete: false,
    runStartedAt: NOW,
    ...overrides,
  };
}

// What the production scan left in security_host_modules: cifs runs, ksmbd and ceph are blacklisted.
const STORED: StoredModules = {
  kernel_release: '5.15.0-203-generic',
  loaded: ['cifs'],
  blocked: ['ksmbd', 'ceph'],
};

describe('reachability is classified from the host module state this push can see', () => {
  it('classifies a batch that carries no host_modules from the stored row for its host', async () => {
    const hostRows = new Map<string, StoredModules>([[HOST, STORED]]);
    const { client, written, reads } = fakeClient(hostRows);

    await applyFeedPush(
      client,
      push({
        findings: [
          finding('a', 'kernel: ksmbd: use-after-free'),
          finding('b', 'kernel: ceph: heap overflow'),
          finding('c', 'kernel: smb: client: use-after-free'),
        ],
      }),
      NOW,
    );

    // ksmbd and ceph are blacklisted, cifs is loaded, and nothing is asked of the empty body.
    expect(written.map((row) => row.reachability)).toEqual(['unreachable', 'unreachable', 'reachable']);
    expect(reads()).toBe(1);
  });

  it('uses the snapshot the body carries when the table has no row for the host yet', async () => {
    const hostRows = new Map<string, StoredModules>();
    const { client, written, hostRow } = fakeClient(hostRows);

    await applyFeedPush(
      client,
      push({
        findings: [finding('a', 'kernel: ksmbd: use-after-free'), finding('b', 'kernel: can: ...')],
        hostModules: { kernelRelease: '5.15.0-203-generic', loaded: ['can'], blocked: ['ksmbd'] },
      }),
      NOW,
    );

    expect(written.map((row) => row.reachability)).toEqual(['unreachable', 'reachable']);
    // The fallback also seeds the row, so the findings batches that follow need no snapshot of their own.
    expect(hostRow()?.blocked).toEqual(['ksmbd']);
  });

  it('keeps the stored row authoritative when a later body disagrees with it', async () => {
    const hostRows = new Map<string, StoredModules>([[HOST, STORED]]);
    const { client, written } = fakeClient(hostRows);

    await applyFeedPush(
      client,
      push({ hostModules: { kernelRelease: '5.15.0-203-generic', loaded: ['ksmbd'], blocked: [] } }),
      NOW,
    );

    expect(written[0].reachability).toBe('unreachable');
  });

  it('gives two batches of one run the verdicts one batch would have given', async () => {
    const titles = [
      'kernel: ksmbd: use-after-free',
      'kernel: smb: client: use-after-free',
      'kernel: btrfs: double free in extent',
      'kernel: ceph: heap overflow',
    ];
    const single = fakeClient(new Map<string, StoredModules>([[HOST, STORED]]));
    await applyFeedPush(single.client, push({ findings: titles.map((t, i) => finding(`k${i}`, t)) }), NOW);

    const split = fakeClient(new Map<string, StoredModules>([[HOST, STORED]]));
    await applyFeedPush(split.client, push({ findings: [finding('k0', titles[0]), finding('k1', titles[1])] }), NOW);
    await applyFeedPush(split.client, push({ findings: [finding('k2', titles[2]), finding('k3', titles[3])] }), NOW);

    const verdicts = split.written.map((row) => row.reachability);
    expect(verdicts).toEqual(single.written.map((row) => row.reachability));
    expect(verdicts).toEqual(['unreachable', 'reachable', 'unreachable', 'unreachable']);
    // One read per request, never one per finding.
    expect(split.reads()).toBe(2);
  });
});
