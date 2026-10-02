import { mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The progress directory is resolved through node:os on every call, so pointing
 * `tmpdir` at a per-test root is enough to keep these writes out of the real one.
 */
const osRoot = vi.hoisted(() => ({ value: '' }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  osRoot.value = actual.tmpdir();
  return { ...actual, tmpdir: () => osRoot.value };
});

import {
  PROGRESS_DIR_NAME,
  PROGRESS_STALE_MS,
  WAITING_PROGRESS,
  getProgressDir,
  isProgressReportId,
  progressFilePath,
  readPromoteStatus,
  startPromoteProgress,
  sweepStaleProgress,
} from '@/lib/restore-apply-progress';

const REPORT_ID = 'restore_staging_a1b2c3d4e5f60718293a4b5c6d7e8f90-1767225600000';
let realTmp: string;
let root: string;

async function writeBody(reportId: string, body: string): Promise<void> {
  await mkdir(getProgressDir(), { recursive: true });
  await writeFile(progressFilePath(reportId), body, 'utf8');
}

async function ageFile(file: string, ms: number): Promise<void> {
  const when = new Date(Date.now() - ms);
  await utimes(file, when, when);
}

beforeEach(async () => {
  realTmp = tmpdir();
  root = await mkdtemp(path.join(realTmp, 'restore-progress-'));
  osRoot.value = root;
});

afterEach(async () => {
  osRoot.value = realTmp;
  await rm(root, { recursive: true, force: true });
});

describe('isProgressReportId', () => {
  it('accepts the report id the applier builds and rejects anything a file name could escape with', () => {
    expect(isProgressReportId(REPORT_ID)).toBe(true);
    for (const value of ['../x', '../../etc/passwd', 'a/b', '/etc/passwd.json', '..', 'Restore_1', 'a b', 'x.json', '']) {
      expect(isProgressReportId(value), value).toBe(false);
    }
  });
});

describe('progressFilePath', () => {
  it('keys the file inside the dedicated directory and refuses any id outside the allowlist', () => {
    expect(progressFilePath(REPORT_ID)).toBe(path.join(root, PROGRESS_DIR_NAME, `${REPORT_ID}.json`));
    expect(() => progressFilePath('../../escape')).toThrow(/Refusing to key a progress file/);
  });
});

describe('readPromoteStatus', () => {
  it('answers waiting for a run that never wrote a figure', async () => {
    expect(await readPromoteStatus(REPORT_ID)).toEqual(WAITING_PROGRESS);
  });

  it('refuses an id outside the allowlist rather than naming a file with it', async () => {
    await writeFile(path.join(root, 'escape.json'), '{"state":"done","updatedAt":"x"}', 'utf8');
    expect(await readPromoteStatus('../escape')).toEqual(WAITING_PROGRESS);
  });

  it('answers waiting for a half-written or unreadable body instead of throwing', async () => {
    await writeBody(REPORT_ID, '{"state":"running"');
    expect(await readPromoteStatus(REPORT_ID)).toEqual(WAITING_PROGRESS);
    await writeBody(REPORT_ID, JSON.stringify({ state: 'running', phase: 'nonsense', doneTables: [], totalTables: 1, currentTable: null, updatedAt: 'x' }));
    expect(await readPromoteStatus(REPORT_ID)).toEqual(WAITING_PROGRESS);
  });
});

describe('startPromoteProgress', () => {
  it('publishes the first figure before the backup gate and each table as it commits', async () => {
    const writer = await startPromoteProgress(REPORT_ID, 3);
    const first = await readPromoteStatus(REPORT_ID);
    expect(first.state).toBe('running');
    expect(first.state === 'running' && first.phase).toBe('backup');

    await writer.phase('applying');
    await writer.starting('users');
    const current = await readPromoteStatus(REPORT_ID);
    expect(current.state === 'running' && current.currentTable).toBe('users');
    expect(current.state === 'running' && current.doneTables).toEqual([]);

    await writer.tableDone('users');
    await writer.starting('contests');
    const after = await readPromoteStatus(REPORT_ID);
    expect(after.state === 'running' && after.doneTables).toEqual(['users']);
    expect(after.state === 'running' && after.totalTables).toBe(3);
  });

  it('replaces the detail with a terminal marker on finish', async () => {
    const writer = await startPromoteProgress(REPORT_ID, 1);
    await writer.tableDone('users');
    await writer.finish();
    const done = await readPromoteStatus(REPORT_ID);
    expect(done.state).toBe('done');
  });

  it('publishes nothing and never throws for an id outside the allowlist', async () => {
    const writer = await startPromoteProgress('../../escape', 1);
    await expect(writer.phase('applying')).resolves.toBeUndefined();
    await expect(writer.starting('users')).resolves.toBeUndefined();
    await expect(writer.tableDone('users')).resolves.toBeUndefined();
    await expect(writer.finish()).resolves.toBeUndefined();
    expect(await readdir(root)).toEqual([]);
  });

  it('leaves no staged body behind after a successful figure', async () => {
    const writer = await startPromoteProgress(REPORT_ID, 1);
    await writer.phase('applying');
    await writer.finish();
    expect(await readdir(getProgressDir())).toEqual([`${REPORT_ID}.json`]);
  });

  it('stays silent and non-fatal when the figure cannot be written, so the promote carries on', async () => {
    await mkdir(getProgressDir(), { recursive: true });
    await mkdir(progressFilePath(REPORT_ID), { recursive: true });
    const writer = await startPromoteProgress(REPORT_ID, 1);
    await expect(writer.tableDone('users')).resolves.toBeUndefined();
    expect(await readPromoteStatus(REPORT_ID)).toEqual(WAITING_PROGRESS);
  });
});

describe('sweepStaleProgress', () => {
  it('removes a figure older than the stale age and keeps a running one', async () => {
    const stale = `${REPORT_ID}s`;
    const fresh = `${REPORT_ID}f`;
    await startPromoteProgress(stale, 1);
    await startPromoteProgress(fresh, 1);
    await ageFile(progressFilePath(stale), PROGRESS_STALE_MS + 60_000);

    expect(await sweepStaleProgress()).toBe(1);
    expect(await readPromoteStatus(stale)).toEqual(WAITING_PROGRESS);
    expect((await readPromoteStatus(fresh)).state).toBe('running');
  });

  it('sweeps the staged body a crashed write left behind', async () => {
    const staged = `${progressFilePath(REPORT_ID)}.tmp`;
    await mkdir(getProgressDir(), { recursive: true });
    await writeFile(staged, '{"state":"running"', 'utf8');
    await ageFile(staged, PROGRESS_STALE_MS + 60_000);

    expect(await sweepStaleProgress()).toBe(1);
    expect(await readdir(getProgressDir())).toEqual([]);
  });

  it('leaves files it did not write alone, and reports nothing to sweep on a machine that never promoted', async () => {
    expect(await sweepStaleProgress()).toBe(0);
    const foreign = path.join(root, 'unrelated.txt');
    await writeFile(foreign, 'keep me', 'utf8');
    await startPromoteProgress(REPORT_ID, 1);
    await ageFile(progressFilePath(REPORT_ID), PROGRESS_STALE_MS + 60_000);

    expect(await sweepStaleProgress()).toBe(1);
    expect((await stat(foreign)).isFile()).toBe(true);
  });
});