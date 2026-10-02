/**
 * The per-table figure a running promote publishes for the operator watching it:
 * one JSON file per report id under a directory of its own in the OS temp
 * directory, plus the age sweep that drops files no run is writing any more.
 *
 * The file is a progress figure, not a record: the report the promote returns
 * stays the full account of what committed and what stayed pending. Every write
 * and read here is best-effort, so a broken temp directory costs the watcher its
 * figure and never the restore that is mid-commit.
 */

import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** A directory of its own, so the sweep only ever removes files this module wrote. */
export const PROGRESS_DIR_NAME = 'cms-restore-progress';
/** A file older than this belongs to a run no operator is watching any more. */
export const PROGRESS_STALE_MS = 24 * 60 * 60_000;
/** A report id is a staging schema plus the epoch millis it was measured at, and nothing else may key a file name. */
const PROGRESS_REPORT_ID_PATTERN = /^[a-z0-9_-]+$/;
const PROGRESS_FILE_SUFFIX = '.json';
/** The staged body of an in-flight write, which a crash can leave behind for the sweep. */
const PROGRESS_STAGED_SUFFIX = '.tmp';

export type PromotePhase = 'backup' | 'staging' | 'applying' | 'cleanup';

const PROMOTE_PHASES: readonly PromotePhase[] = ['backup', 'staging', 'applying', 'cleanup'];

export type PromoteStatus =
  | { readonly state: 'waiting' }
  | { readonly state: 'done'; readonly updatedAt: string }
  | {
      readonly state: 'running';
      readonly phase: PromotePhase;
      readonly doneTables: readonly string[];
      readonly totalTables: number;
      readonly currentTable: string | null;
      readonly updatedAt: string;
    };

/** The stopped-watching state is the watcher's own observation, never a server answer. */
export type PromoteProgressView = PromoteStatus | { readonly state: 'timeout' };

export const WAITING_PROGRESS: PromoteStatus = { state: 'waiting' };

/** A report id outside the allowlist can name no file: a separator, a dot segment and a capital are all refused. */
export function isProgressReportId(value: unknown): value is string {
  return typeof value === 'string' && PROGRESS_REPORT_ID_PATTERN.test(value);
}

export function getProgressDir(): string {
  return path.join(tmpdir(), PROGRESS_DIR_NAME);
}

export function progressFilePath(reportId: string): string {
  if (!isProgressReportId(reportId)) throw new Error(`Refusing to key a progress file with report id: ${reportId}`);
  return path.join(getProgressDir(), `${reportId}${PROGRESS_FILE_SUFFIX}`);
}

/** A name this module wrote: an allowlisted report id plus the suffixes it chose around it. */
function isProgressFileName(name: string): boolean {
  const withoutStaged = name.endsWith(PROGRESS_STAGED_SUFFIX) ? name.slice(0, -PROGRESS_STAGED_SUFFIX.length) : name;
  return withoutStaged.endsWith(PROGRESS_FILE_SUFFIX) && isProgressReportId(withoutStaged.slice(0, -PROGRESS_FILE_SUFFIX.length));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function isTableList(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isPromoteStatus(value: unknown): value is PromoteStatus {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.state === 'done') return typeof record.updatedAt === 'string';
  if (record.state !== 'running') return false;
  return (
    typeof record.phase === 'string' &&
    PROMOTE_PHASES.includes(record.phase as PromotePhase) &&
    isTableList(record.doneTables) &&
    Number.isInteger(record.totalTables) &&
    (record.currentTable === null || typeof record.currentTable === 'string') &&
    typeof record.updatedAt === 'string'
  );
}

/** An unreadable or half-written body reads as waiting, because a figure nobody can parse is not a figure. */
function parsePromoteStatus(text: string): PromoteStatus {
  try {
    const parsed: unknown = JSON.parse(text);
    return isPromoteStatus(parsed) ? parsed : WAITING_PROGRESS;
  } catch (error) {
    console.warn(`Restore promote progress could not be parsed: ${describe(error)}`);
    return WAITING_PROGRESS;
  }
}

export async function readPromoteStatus(reportId: string): Promise<PromoteStatus> {
  if (!isProgressReportId(reportId)) return WAITING_PROGRESS;
  try {
    return parsePromoteStatus(await readFile(progressFilePath(reportId), 'utf8'));
  } catch (error) {
    if (!isMissingFile(error)) console.warn(`Restore promote progress for ${reportId} could not be read: ${describe(error)}`);
    return WAITING_PROGRESS;
  }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Best-effort by construction: the caller is a promote between commits and cannot
 * afford to fail here. The body is written beside its target and renamed over
 * it, so a watcher reading every two seconds never sees a half-written figure.
 */
async function writePromoteStatus(reportId: string, status: PromoteStatus): Promise<void> {
  try {
    const target = progressFilePath(reportId);
    const staged = `${target}${PROGRESS_STAGED_SUFFIX}`;
    await mkdir(getProgressDir(), { recursive: true });
    await writeFile(staged, `${JSON.stringify(status)}\n`, 'utf8');
    await rename(staged, target);
  } catch (error) {
    console.warn(`Restore promote progress for ${reportId} could not be written: ${describe(error)}`);
  }
}

export interface PromoteProgressWriter {
  readonly phase: (next: PromotePhase) => Promise<void>;
  /** The table being worked on, which has not committed yet and must not be counted as done. */
  readonly starting: (table: string) => Promise<void>;
  readonly tableDone: (table: string) => Promise<void>;
  /** Replaces the detail with a terminal marker, so a watcher stops on evidence rather than on a missing file. */
  readonly finish: () => Promise<void>;
}

interface RunningProgress {
  readonly state: 'running';
  phase: PromotePhase;
  doneTables: readonly string[];
  readonly totalTables: number;
  currentTable: string | null;
}

const UNPUBLISHED_WRITER: PromoteProgressWriter = {
  phase: () => Promise.resolve(),
  starting: () => Promise.resolve(),
  tableDone: () => Promise.resolve(),
  finish: () => Promise.resolve(),
};

/** Publishes the first figure of a run, before the pre-promote backup that can hold the operator for minutes. */
export async function startPromoteProgress(reportId: string, totalTables: number): Promise<PromoteProgressWriter> {
  if (!isProgressReportId(reportId)) return UNPUBLISHED_WRITER;
  const running: RunningProgress = { state: 'running', phase: 'backup', doneTables: [], totalTables, currentTable: null };
  const publish = () => writePromoteStatus(reportId, { ...running, updatedAt: new Date().toISOString() });
  await publish();
  return {
    phase: async (next) => {
      running.phase = next;
      running.currentTable = null;
      await publish();
    },
    starting: async (table) => {
      running.currentTable = table;
      await publish();
    },
    tableDone: async (table) => {
      running.currentTable = null;
      running.doneTables = [...running.doneTables, table];
      await publish();
    },
    finish: async () => {
      await writePromoteStatus(reportId, { state: 'done', updatedAt: new Date().toISOString() });
    },
  };
}

// ---------------------------------------------------------------------------
// Age sweep
// ---------------------------------------------------------------------------

async function listProgressFiles(dir: string): Promise<readonly string[]> {
  try {
    return (await readdir(dir)).filter(isProgressFileName);
  } catch (error) {
    if (!isMissingFile(error)) console.warn(`Restore progress directory could not be listed: ${describe(error)}`);
    return [];
  }
}

/** Drops the figures no run is writing any more. A file a promote is still appending to is never this old. */
export async function sweepStaleProgress(nowMs: number = Date.now()): Promise<number> {
  const dir = getProgressDir();
  let swept = 0;
  for (const entry of await listProgressFiles(dir)) {
    const file = path.join(dir, entry);
    try {
      if (nowMs - (await stat(file)).mtimeMs <= PROGRESS_STALE_MS) continue;
      await rm(file);
      swept += 1;
    } catch (error) {
      console.warn(`Stale restore progress ${entry} could not be swept: ${describe(error)}`);
    }
  }
  return swept;
}