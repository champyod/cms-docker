import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A promote reaches docker, the live database, the manifest and the progress
 * directory before it can be observed at all, so every one of those is replaced
 * here and nothing a test drives depends on real I/O or real time. What is left
 * is the part the findings are about: which exits publish a report, and which
 * manifest entry is allowed to open the pre-promote gate.
 */
const harness = vi.hoisted(() => ({
    discord: [] as { title: string; message: string }[],
    manifestBodies: [] as string[],
    dockerAlive: true,
    planErrors: [] as string[],
    stagingLoadFails: false,
}));

vi.mock('@/lib/restore-apply-progress', () => {
    const silent = { phase: async () => {}, starting: async () => {}, tableDone: async () => {}, finish: async () => {} };
    return {
        WAITING_PROGRESS: { state: 'waiting' },
        readPromoteStatus: async () => ({ state: 'waiting' }),
        startPromoteProgress: async () => silent,
        sweepStaleProgress: async () => 0,
    };
});

vi.mock('node:fs/promises', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs/promises')>();
    return {
        ...actual,
        readFile: async () => {
            const body = harness.manifestBodies.shift();
            if (body === undefined) throw new Error('manifest.json could not be read');
            return body;
        },
    };
});

vi.mock('node:child_process', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:child_process')>();
    return {
        ...actual,
        execFile: (
            _file: string,
            _args: readonly string[],
            _options: unknown,
            callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
        ) => callback(null, { stdout: '', stderr: '' }),
    };
});

vi.mock('@/lib/permissions', () => ({ ensurePermission: async () => undefined }));

vi.mock('@/lib/discord-notifier', () => ({
    logToDiscord: async (title: string, message: string) => {
        harness.discord.push({ title, message });
    },
}));

vi.mock('@/app/actions/restore-apply-measure', () => ({
    DOCKER_TIMEOUT_MS: 60_000,
    DOCKER_MAX_OUTPUT_BYTES: 1024,
    measureFacts: async () => {
        throw new Error('measureFacts is not expected in this test');
    },
    preparePromote: async () => {
        if (!harness.dockerAlive) throw new Error('the live database is unreachable');
        return {
            env: { POSTGRES_USER: 'cmsuser', POSTGRES_PASSWORD: 'secret', POSTGRES_DB: 'cmsdb' },
            facts: {},
            warnings: ['a measured warning'],
            planErrors: harness.planErrors,
        };
    },
}));

vi.mock('@/app/actions/restore-apply-steps', () => ({
    loadStaging: vi.fn(async () => {
        if (harness.stagingLoadFails) throw new Error('users could not be read out of the scratch container');
    }),
    dropStaging: vi.fn(async () => null),
    applyOneTable: vi.fn(async (_env: unknown, _staging: string, table: string, strategy: string) => ({
        table,
        strategy,
        status: 'applied',
        liveBefore: 4,
        liveAfter: 9,
        merged: 5,
    })),
    applyLargeObjects: vi.fn(async (_container: string, _env: unknown, strategy: string) => ({
        table: 'fsobjects',
        strategy,
        status: 'applied',
        liveBefore: 2,
        liveAfter: 4,
        merged: 2,
    })),
}));

vi.mock('@/app/actions/restore-preview-run', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/app/actions/restore-preview-run')>();
    return {
        ...actual,
        runDocker: async () => {
            if (!harness.dockerAlive) throw new Error(`Error response from daemon: container gone`);
            return '';
        },
    };
});

import { LARGE_OBJECT_TABLE, buildReportId, stagingSchemaName } from '@/lib/restore-apply';
import type { ApplyStrategies } from '@/lib/restore-apply';
import { applyOneTable } from '@/app/actions/restore-apply-steps';
import { promotePreview } from '@/app/actions/restore-apply';
import { mergeAll, PREVIEW_ID } from './restore-apply-fixtures';

const STAGING = stagingSchemaName(PREVIEW_ID);
const FULL_ENTRY = 'full:2026-10-03T01:00:00Z';
const SELECTIVE_ENTRY = 'selective:2026-10-03T01:00:00Z';

function manifest(...bodies: readonly string[]): void {
    harness.manifestBodies = [...bodies];
}

function manifestWith(...entries: readonly { ts: string; kind?: string }[]): string {
    return JSON.stringify(entries.map((entry) => (entry.kind === undefined ? { ts: entry.ts } : { ts: entry.ts, kind: entry.kind })));
}

function confirmToken(): string {
    return buildReportId(STAGING, Date.now());
}

function promote(strategies: ApplyStrategies = mergeAll(), token: string = confirmToken()): ReturnType<typeof promotePreview> {
    return promotePreview(PREVIEW_ID, strategies, token);
}

beforeEach(() => {
    harness.discord = [];
    harness.manifestBodies = [];
    harness.dockerAlive = true;
    harness.planErrors = [];
    harness.stagingLoadFails = false;
    vi.mocked(applyOneTable).mockReset();
    vi.mocked(applyOneTable).mockImplementation(async (_env, _staging, table, strategy) => ({ table, strategy, status: 'applied', liveBefore: 4, liveAfter: 9, merged: 5 }));
});

afterEach(() => {
    vi.useRealTimers();
});

describe('pre-promote backup gate', () => {
    it('waits for a full backup and opens on it', async () => {
        manifest(manifestWith({ ts: '2026-10-03T00:00:00Z', kind: 'full' }), manifestWith({ ts: '2026-10-03T00:00:00Z', kind: 'full' }, { ts: '2026-10-03T01:00:00Z', kind: 'full' }));
        const report = await promote();
        expect(report.ok).toBe(true);
        expect(report.backupEntry).toBe(FULL_ENTRY);
        expect(harness.discord.at(-1)?.title).toBe('Restore Merge Applied');
    });

    it('does not let a selective run in the window open the gate', async () => {
        vi.useFakeTimers();
        harness.manifestBodies = [
            manifestWith({ ts: '2026-10-03T00:00:00Z', kind: 'full' }),
            manifestWith({ ts: '2026-10-03T00:00:00Z', kind: 'full' }, { ts: '2026-10-03T01:00:00Z', kind: 'selective' }),
        ];
        const waiting = promote();
        for (let poll = 0; poll < 100; poll += 1) await vi.advanceTimersByTimeAsync(10_000);
        const report = await waiting;
        expect(report.ok).toBe(false);
        expect(report.backupEntry).toBeUndefined();
        expect(report.errors[0]).toMatch(/No new full backup appeared/);
        expect(harness.discord.at(-1)?.title).toBe('Restore Merge Stopped');
    });

    it('takes the full entry, not the selective one beside it', async () => {
        manifest(
            manifestWith({ ts: '2026-10-03T00:00:00Z', kind: 'full' }),
            manifestWith({ ts: '2026-10-03T00:00:00Z', kind: 'full' }, { ts: '2026-10-03T01:00:00Z', kind: 'selective' }, { ts: '2026-10-03T01:05:00Z', kind: 'full' }),
        );
        const report = await promote();
        expect(report.backupEntry).toBe('full:2026-10-03T01:05:00Z');
        expect(report.backupEntry).not.toBe(SELECTIVE_ENTRY);
    });

    it('counts an entry written before kinds existed as full', async () => {
        manifest(manifestWith({ ts: '2026-10-03T00:00:00Z' }), manifestWith({ ts: '2026-10-03T00:00:00Z' }, { ts: '2026-10-03T01:00:00Z' }));
        const report = await promote();
        expect(report.backupEntry).toBe(FULL_ENTRY);
        expect(report.ok).toBe(true);
    });
});

describe('every abort reaches Discord', () => {
    it('reports a refusal without touching anything', async () => {
        const report = await promote(mergeAll(), 'not-a-token');
        expect(report.ok).toBe(false);
        expect(harness.discord).toHaveLength(1);
        expect(harness.discord[0].message).toMatch(/aborted before any table was applied/);
        expect(harness.discord[0].message).toMatch(/Confirm token/);
    });

    it('reports a scratch container that is gone', async () => {
        harness.dockerAlive = false;
        const report = await promote();
        expect(report.errors[0]).toMatch(/is gone/);
        expect(harness.discord).toHaveLength(1);
        expect(harness.discord[0].message).toMatch(/aborted before any table was applied/);
    });

    it('reports a re-plan that no longer passes', async () => {
        harness.planErrors = ['"users" is merged but live has no primary key id'];
        const report = await promote();
        expect(report.errors).toEqual(['"users" is merged but live has no primary key id']);
        expect(report.warnings).toEqual(['a measured warning']);
        expect(harness.discord).toHaveLength(1);
        expect(harness.discord[0].message).toMatch(/"users" is merged but live has no primary key id/);
    });

    it('reports a backup gate that never opened, with the reason it could not be read', async () => {
        manifest();
        const report = await promote();
        expect(report.errors[0]).toMatch(/Pre-promote backup gate/);
        expect(report.errors[0]).toMatch(/manifest.json could not be read/);
        expect(harness.discord).toHaveLength(1);
        expect(harness.discord[0].message).toMatch(/Pre-promote backup gate/);
    });

    it('reports a staging load that failed, keeping the backup entry it took', async () => {
        manifest(
            manifestWith({ ts: '2026-10-03T00:00:00Z', kind: 'full' }),
            manifestWith({ ts: '2026-10-03T00:00:00Z', kind: 'full' }, { ts: '2026-10-03T01:00:00Z', kind: 'full' }),
        );
        harness.stagingLoadFails = true;
        const report = await promote();
        expect(report.ok).toBe(false);
        expect(report.backupEntry).toBe(FULL_ENTRY);
        expect(report.errors[0]).toMatch(/Staging load failed; no live row was written/);
        expect(harness.discord).toHaveLength(1);
        expect(harness.discord[0].message).toMatch(/No live row was written/);
    });
});

describe('a run that stops on a table', () => {
    it('reports the failed table with no figures rather than zeros', async () => {
        manifest(
            manifestWith({ ts: '2026-10-03T00:00:00Z', kind: 'full' }),
            manifestWith({ ts: '2026-10-03T00:00:00Z', kind: 'full' }, { ts: '2026-10-03T01:00:00Z', kind: 'full' }),
        );
        vi.mocked(applyOneTable).mockImplementation(async (_env, _staging, table, strategy) => {
            if (table === 'datasets') throw new Error('"datasets" ended with 3 live row(s) where 4 were expected.');
            return { table, strategy, status: 'applied', liveBefore: 4, liveAfter: 9, merged: 5 };
        });
        const report = await promote();
        expect(report.ok).toBe(false);
        expect(report.appliedTables).toContain('contests');
        expect(report.appliedTables).not.toContain('datasets');
        expect(report.tableRecords.find((record) => record.table === 'datasets')).toMatchObject({
            status: 'failed',
            liveBefore: null,
            liveAfter: null,
            merged: null,
            note: '"datasets" ended with 3 live row(s) where 4 were expected.',
        });
        expect(harness.discord.at(-1)?.title).toBe('Restore Merge Stopped');
        expect(harness.discord.at(-1)?.message).toMatch(/stopped on/);
    });

    it('keeps every table after the failure pending, including the blobs', async () => {
        manifest(
            manifestWith({ ts: '2026-10-03T00:00:00Z', kind: 'full' }),
            manifestWith({ ts: '2026-10-03T00:00:00Z', kind: 'full' }, { ts: '2026-10-03T01:00:00Z', kind: 'full' }),
        );
        vi.mocked(applyOneTable).mockRejectedValueOnce(new Error('contests rolled back'));
        const report = await promote();
        expect(report.pendingTables).toContain(LARGE_OBJECT_TABLE);
        expect(report.tableRecords.some((record) => record.status === 'failed')).toBe(true);
    });
});
