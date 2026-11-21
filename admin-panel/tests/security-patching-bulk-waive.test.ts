import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The bulk waiver, at the module the server action calls.
 *
 * WHY through the module and not the action: the action adds the permission check and the refresh,
 * which its own test covers. What has to be proven here is the decision — a reachable row is refused,
 * two findings of one CVE produce one waiver, a dry run writes nothing, and the reason names the
 * module state that made the code path unreachable.
 */
const mocks = vi.hoisted(() => ({
  findings: vi.fn(),
  waivers: vi.fn(),
  hostModules: vi.fn(),
  create: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    security_findings: { findMany: mocks.findings },
    security_waivers: { findMany: mocks.waivers, create: mocks.create },
    security_host_modules: { findMany: mocks.hostModules },
  },
}));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));

// The gate, the actor and the refresh the action adds around the module; asserted below.
const gates = vi.hoisted(() => ({
  keys: [] as string[],
  refused: new Set<string>(),
  revalidated: [] as string[],
}));

vi.mock('@/lib/permissions', () => ({
  ensurePermission: async (key: string) => {
    gates.keys.push(key);
    if (gates.refused.has(key)) throw new Error(`Forbidden: Missing ${key} permission`);
  },
}));
vi.mock('@/app/actions/auth', () => ({
  getCurrentUser: async () => ({ id: 7, name: 'Operator', username: 'root' }),
}));
vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => {
    gates.revalidated.push(path);
  },
}));

import { bulkWaiveUnreachable } from '@/app/actions/securityPatching';
import { waiveUnreachableFindings } from '@/lib/panel-actions';

const NOW = new Date('2026-10-24T12:00:00.000Z');
const ACTOR = 7;
const REVIEW = '2026-12-31';

/** The production shape: ksmbd is blacklisted on both hosts and absent from /proc/modules. */
const KSMBD_TITLE = 'kernel: ksmbd: use-after-free in smb2 session setup';
const BPF_TITLE = 'kernel: bpf: verifier bypass in map value pruning';

interface RowInput {
  readonly id: number;
  readonly key: string;
  readonly title: string;
  readonly host: string;
  readonly reachability: string;
}

function row(input: RowInput) {
  return { ...input };
}

function hostRow(host: string) {
  return {
    host,
    kernel_release: '6.12.9-1-cachyos',
    loaded: ['ext4', 'loop'],
    blocked: ['ksmbd', 'cifs', 'ntfs3'],
  };
}

let nextId = 100;

describe('waiveUnreachableFindings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nextId = 100;
    mocks.waivers.mockResolvedValue([]);
    mocks.hostModules.mockResolvedValue([hostRow('como-main')]);
    mocks.create.mockImplementation(async () => ({ id: nextId++ }));
  });

  it('refuses a reachable row and creates no waiver for it', async () => {
    mocks.findings.mockResolvedValue([
      row({ id: 1, key: 'CVE-2026-1|linux-image-5.15.0-203', title: BPF_TITLE, host: 'como-main', reachability: 'reachable' }),
    ]);

    const result = await waiveUnreachableFindings(ACTOR, { reviewBy: REVIEW }, NOW);

    expect(mocks.create).not.toHaveBeenCalled();
    expect(result.counts.waived).toBe(0);
    expect(result.counts.refusedReachable).toBe(1);
    expect(result.refusals).toEqual([
      { key: 'CVE-2026-1|linux-image-5.15.0-203', cve: 'CVE-2026-1', host: 'como-main', verdict: 'reachable', own: 'reachable' },
    ]);
    expect(result.plan).toEqual([]);
  });

  it('refuses an unknown row too, and never folds it into the unreachable set', async () => {
    mocks.findings.mockResolvedValue([
      row({ id: 2, key: 'CVE-2026-2|linux-libc-dev', title: 'CVE-2026-2 in the kernel', host: 'como-main', reachability: 'unknown' }),
    ]);

    const result = await waiveUnreachableFindings(ACTOR, { reviewBy: REVIEW }, NOW);

    expect(mocks.create).not.toHaveBeenCalled();
    expect(result.counts.refusedUnknown).toBe(1);
    expect(result.counts.refusedReachable).toBe(0);
  });

  it('produces exactly one waiver for two findings of the same CVE', async () => {
    mocks.findings.mockResolvedValue([
      row({ id: 3, key: 'CVE-2026-3|linux-image-5.15.0-203', title: KSMBD_TITLE, host: 'como-main', reachability: 'unreachable' }),
      row({ id: 4, key: 'CVE-2026-3|linux-modules-5.15.0-203-generic', title: KSMBD_TITLE, host: 'como-main', reachability: 'unreachable' }),
    ]);

    const result = await waiveUnreachableFindings(ACTOR, { reviewBy: REVIEW }, NOW);

    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ source: 'rootfs', match: 'CVE-2026-3', created_by: ACTOR }) }),
    );
    expect(result.plan).toHaveLength(1);
    expect(result.plan[0]?.findings).toHaveLength(2);
    expect(result.counts).toMatchObject({ candidates: 2, planned: 1, waived: 1, findingsWaived: 2 });
    // One audit row per waiver, from createWaiver itself — not one per finding.
    expect(mocks.recordAudit.mock.calls.filter(([entry]) => entry.verb === 'security.waiver.create')).toHaveLength(1);
  });

  it('returns the plan on a dry run and writes nothing', async () => {
    mocks.findings.mockResolvedValue([
      row({ id: 5, key: 'CVE-2026-5|linux-image-5.15.0-203', title: KSMBD_TITLE, host: 'como-main', reachability: 'unreachable' }),
    ]);

    const result = await waiveUnreachableFindings(ACTOR, { reviewBy: REVIEW, dryRun: true }, NOW);

    expect(result.dryRun).toBe(true);
    expect(result.plan).toHaveLength(1);
    expect(result.plan[0]?.match).toBe('CVE-2026-5');
    expect(result.counts).toMatchObject({ planned: 1, waived: 0 });
    expect(result.waiverIds).toEqual([]);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('names the subsystem and the module state that made the code path unreachable', async () => {
    mocks.findings.mockResolvedValue([
      row({ id: 6, key: 'CVE-2026-6|linux-image-5.15.0-203', title: KSMBD_TITLE, host: 'como-main', reachability: 'unreachable' }),
    ]);

    const result = await waiveUnreachableFindings(ACTOR, { reviewBy: REVIEW }, NOW);

    const reason = result.plan[0]?.reason ?? '';
    expect(reason).toContain('ksmbd=blacklisted');
    expect(reason).toContain('como-main');
    expect(reason).toContain('6.12.9-1-cachyos');
    expect(reason).toContain(REVIEW);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reason }) }));
  });

  it('leaves a CVE alone when a live waiver already covers one of its findings', async () => {
    mocks.waivers.mockResolvedValue([{ source: 'rootfs', match: 'CVE-2026-7', ended_at: null }]);
    mocks.findings.mockResolvedValue([
      row({ id: 7, key: 'CVE-2026-7|linux-image-5.15.0-203', title: KSMBD_TITLE, host: 'como-main', reachability: 'unreachable' }),
    ]);

    const result = await waiveUnreachableFindings(ACTOR, { reviewBy: REVIEW }, NOW);

    expect(mocks.create).not.toHaveBeenCalled();
    expect(result.counts.alreadyWaived).toBe(1);
    expect(result.plan).toEqual([]);
  });

  it('refuses the CVE when an already-waived sibling row is reachable', async () => {
    // The live waiver covers the reachable row only, yet a new waiver for the CVE would cover it too.
    mocks.waivers.mockResolvedValue([{ source: 'rootfs', match: 'CVE-2026-30|linux-image-5.15.0-203', ended_at: null }]);
    mocks.findings.mockResolvedValue([
      row({ id: 30, key: 'CVE-2026-30|linux-image-5.15.0-203', title: BPF_TITLE, host: 'como-box', reachability: 'reachable' }),
      row({ id: 31, key: 'CVE-2026-30|linux-modules-5.15.0-203-generic', title: KSMBD_TITLE, host: 'como-main', reachability: 'unreachable' }),
    ]);

    const result = await waiveUnreachableFindings(ACTOR, { reviewBy: REVIEW }, NOW);

    expect(mocks.create).not.toHaveBeenCalled();
    expect(result.counts.alreadyWaived).toBe(1);
    expect(result.counts.refusedReachable).toBe(1);
    expect(result.refusals).toEqual([
      expect.objectContaining({ key: 'CVE-2026-30|linux-modules-5.15.0-203-generic', verdict: 'reachable', own: 'unreachable' }),
    ]);
  });

  it('refuses a plan the operator confirmed against a different count', async () => {
    mocks.findings.mockResolvedValue([
      row({ id: 40, key: 'CVE-2026-40|linux-image-5.15.0-203', title: KSMBD_TITLE, host: 'como-main', reachability: 'unreachable' }),
    ]);

    const result = await waiveUnreachableFindings(ACTOR, { reviewBy: REVIEW, expectedWaivers: 3 }, NOW);

    expect(result.success).toBe(false);
    expect(result.error).toContain('plan changed');
    expect(result.plan).toHaveLength(1);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('writes when the confirmed count still matches the plan', async () => {
    mocks.findings.mockResolvedValue([
      row({ id: 41, key: 'CVE-2026-41|linux-image-5.15.0-203', title: KSMBD_TITLE, host: 'como-main', reachability: 'unreachable' }),
    ]);

    const result = await waiveUnreachableFindings(ACTOR, { reviewBy: REVIEW, expectedWaivers: 1 }, NOW);

    expect(result.success).toBe(true);
    expect(result.counts.waived).toBe(1);
  });

  it('refuses a past review date before reading the feed', async () => {
    const result = await waiveUnreachableFindings(ACTOR, { reviewBy: '2020-01-01' }, NOW);

    expect(result.success).toBe(false);
    expect(result.error).toContain('future');
    expect(mocks.findings).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('reports a CVE whose waiver was refused instead of stopping the run', async () => {
    const longCve = `CVE-2026-${'9'.repeat(220)}`;
    mocks.findings.mockResolvedValue([
      row({ id: 8, key: 'CVE-2026-8|linux-image-5.15.0-203', title: KSMBD_TITLE, host: 'como-main', reachability: 'unreachable' }),
      row({ id: 9, key: `${longCve}|linux-image-5.15.0-203`, title: KSMBD_TITLE, host: 'como-main', reachability: 'unreachable' }),
    ]);

    const result = await waiveUnreachableFindings(ACTOR, { reviewBy: REVIEW }, NOW);

    expect(result.counts.waived).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain(longCve);
    expect(result.failures[0]).toContain('exceeds 200 characters');
  });
});

describe('bulkWaiveUnreachable (the server action)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gates.keys.length = 0;
    gates.refused.clear();
    gates.revalidated.length = 0;
    nextId = 300;
    mocks.waivers.mockResolvedValue([]);
    mocks.hostModules.mockResolvedValue([hostRow('como-main')]);
    mocks.create.mockImplementation(async () => ({ id: nextId++ }));
    mocks.findings.mockResolvedValue([
      row({ id: 20, key: 'CVE-2026-20|linux-image-5.15.0-203', title: KSMBD_TITLE, host: 'como-main', reachability: 'unreachable' }),
    ]);
  });

  it('demands patching:waive as well as the read key, and writes nothing without it', async () => {
    gates.refused.add('patching:waive');

    await expect(bulkWaiveUnreachable({ reviewBy: '2026-12-31' })).rejects.toThrow(/patching:waive/);

    expect(gates.keys).toEqual(['security:read', 'patching:waive']);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('refreshes the page once after an applied plan', async () => {
    const result = await bulkWaiveUnreachable({ reviewBy: '2026-12-31' });

    expect(result.counts.waived).toBe(1);
    expect(gates.revalidated).toEqual(['/[locale]/security/patching']);
  });

  it('refreshes nothing on a dry run', async () => {
    const result = await bulkWaiveUnreachable({ reviewBy: '2026-12-31', dryRun: true });

    expect(result.plan).toHaveLength(1);
    expect(result.counts.waived).toBe(0);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(gates.revalidated).toEqual([]);
  });
});
