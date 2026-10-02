import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { BACKUP_TABLE_NAMES } from '@/lib/backup-table-catalog';
import {
  MAX_SAMPLE_ROWS,
  NEW_ESTIMATE_METHOD,
  UPDATED_ESTIMATE_METHOD,
  buildTableDiff,
  clampSampleRowCount,
  parseRestoreList,
  pkSampleExpression,
  qualifiedTable,
  quoteIdentifier,
  shapeSampleRows,
  summarizeToc,
  tocTableNames,
} from '@/lib/restore-preview';
import type { PkOverlapSample } from '@/lib/restore-preview';
import {
  MAX_PK_SAMPLE_ROWS,
  ORPHAN_SWEEP_COMMAND,
  PREVIEW_ID_PATTERN,
  PREVIEW_ROOT_DIR_NAME,
  SCRATCH_IMAGE,
  UPLOAD_MAX_BYTES_DEFAULT,
  UPLOAD_SIZE_LIMIT_ENV,
  checkUploadFileName,
  getPreviewRoot,
  getUploadMaxBytes,
  isPreviewId,
  previewContainerName,
  previewDumpPath,
  previewQuarantineDir,
  scratchDatabaseEnv,
} from '@/lib/restore-preview-store';

const PREVIEW_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

/**
 * A `pg_restore --list` excerpt in the layout postgres:15 prints for a selective
 * CMS dump: header comment lines, then table definitions, then the TABLE DATA
 * entries, then the non-table entries that must never be read as table names.
 */
const TOC_TEXT = `;
; Archive created at 2026-09-20 03:14:00 UTC
;     dbname:  cmsdb
;     TOC Entries: 9
;     Compression: 8
;     Version: 15
;     Format: CUSTOM (1)
;
;
; Selected TOC Entries:
;
2; 2615 16384 SCHEMA - public cmsuser
6; 1259 16410 SEQUENCE public contests_id_seq cmsuser
214; 1259 16400 TABLE public contests cmsuser
215; 1259 16404 TABLE public users cmsuser
216; 1259 16406 TABLE public announcements cmsuser
3361; 0 16400 TABLE DATA public contests cmsuser
3362; 0 16404 TABLE DATA public users cmsuser
3363; 0 16406 TABLE DATA public announcements cmsuser
3364; 0 0 BLOB 23145
`;

const TOC_WITH_UNKNOWN_TABLE = `${TOC_TEXT}3365; 0 16499 TABLE DATA public orphaned_table cmsuser\n`;

const TOC_ENTRIES = parseRestoreList(TOC_TEXT);

function counts(entries: ReadonlyArray<readonly [string, number]>): Map<string, number> {
  return new Map(entries);
}

function overlap(overlapCount: number, sampleSize: number = 100): PkOverlapSample {
  return { overlap: overlapCount, sampleSize };
}

afterEach(() => {
  delete process.env[UPLOAD_SIZE_LIMIT_ENV];
  delete process.env.POSTGRES_USER;
  delete process.env.POSTGRES_DB;
});

describe('parseRestoreList', () => {
  it('reads the schema and name of table and table-data entries', () => {
    expect(TOC_ENTRIES.filter((entry) => entry.name === 'users')).toEqual([
      { schema: 'public', name: 'users', kind: 'TABLE' },
      { schema: 'public', name: 'users', kind: 'TABLE DATA' },
    ]);
  });

  it('leaves schema and name null for entries that do not name a table', () => {
    expect(TOC_ENTRIES.find((entry) => entry.kind === 'SCHEMA')).toEqual({ schema: null, name: null, kind: 'SCHEMA' });
    expect(TOC_ENTRIES.find((entry) => entry.kind === 'BLOB')).toEqual({ schema: null, name: null, kind: 'BLOB' });
    expect(TOC_ENTRIES.find((entry) => entry.kind === 'SEQUENCE')).toEqual({ schema: null, name: null, kind: 'SEQUENCE' });
  });

  it('drops the header block, which has no table oid to anchor on', () => {
    expect(TOC_ENTRIES).toHaveLength(9);
    expect(TOC_ENTRIES.every((entry) => entry.kind !== 'FORMAT')).toBe(true);
  });

  it('ignores blank lines and an empty listing', () => {
    expect(parseRestoreList('')).toEqual([]);
    expect(parseRestoreList('\n\n   \n')).toEqual([]);
  });

  it('treats the second word of a compound kind as part of the kind, not as a name', () => {
    const [entry] = parseRestoreList('3361; 0 16400 TABLE DATA public contests cmsuser');
    expect(entry).toEqual({ schema: 'public', name: 'contests', kind: 'TABLE DATA' });
  });

  it('returns no name for a table entry whose name fields are missing', () => {
    expect(parseRestoreList('214; 1259 16400 TABLE public')).toEqual([{ schema: null, name: null, kind: 'TABLE' }]);
  });
});

describe('tocTableNames and summarizeToc', () => {
  it('lists every table the archive carries, deduplicated across TABLE and TABLE DATA', () => {
    expect(tocTableNames(TOC_ENTRIES)).toEqual(['announcements', 'contests', 'users']);
  });

  it('separates catalog tables from tables the catalog does not know', () => {
    expect(summarizeToc(TOC_ENTRIES)).toEqual({ catalogTables: ['announcements', 'contests', 'users'], unknownTables: [], otherEntryCount: 3 });
    expect(summarizeToc(parseRestoreList(TOC_WITH_UNKNOWN_TABLE)).unknownTables).toEqual(['orphaned_table']);
  });

  it('keeps every TOC table name inside the catalog allowlist check', () => {
    for (const name of tocTableNames(TOC_ENTRIES)) expect(BACKUP_TABLE_NAMES).toContain(name);
  });

  it('reports nothing catalog-shaped for a listing without table data', () => {
    expect(summarizeToc([])).toEqual({ catalogTables: [], unknownTables: [], otherEntryCount: 0 });
  });
});

describe('buildTableDiff', () => {
  const order = ['contests', 'users', 'teams'];

  it('keeps catalog order regardless of map insertion order', () => {
    const rows = buildTableDiff(order, counts([['teams', 5]]), counts([['contests', 7]]));
    expect(rows.map((row) => row.table)).toEqual(['contests', 'users', 'teams']);
  });

  it('estimates added rows from the count difference', () => {
    const [contests] = buildTableDiff(order, counts([['contests', 120]]), counts([['contests', 100]]));
    expect(contests.newEstimate).toBe(20);
    expect(contests.newEstimateMethod).toBe(NEW_ESTIMATE_METHOD);
  });

  it('never estimates added rows when the live table is larger', () => {
    const [contests] = buildTableDiff(order, counts([['contests', 10]]), counts([['contests', 40]]));
    expect(contests.newEstimate).toBe(0);
    expect(contests.liveRows).toBe(40);
  });

  it('projects the primary-key overlap sample onto the full archive row count', () => {
    const [contests] = buildTableDiff(order, counts([['contests', 200]]), counts([['contests', 190]]), buildOverlapMap(50, 100));
    expect(contests.updatedEstimate).toBe(100);
    expect(contests.updatedEstimateMethod).toBe(UPDATED_ESTIMATE_METHOD);
    expect(contests.updatedEstimateMeasured).toBe(true);
  });

  it('reports an unmeasured update estimate as zero rather than guessing', () => {
    const [contests] = buildTableDiff(order, counts([['contests', 200]]), counts([['contests', 190]]));
    expect(contests.updatedEstimate).toBe(0);
    expect(contests.updatedEstimateMeasured).toBe(false);
  });

  it('caps the update estimate at the archive row count', () => {
    const rows = buildTableDiff(order, counts([['contests', 4]]), counts([['contests', 4]]), buildOverlapMap(100, 100, 'contests'));
    expect(rows[0].updatedEstimate).toBe(4);
  });

  it('marks a table the archive does not carry as absent instead of empty', () => {
    const [, users] = buildTableDiff(order, counts([['contests', 3]]), counts([['contests', 3], ['users', 8]]));
    expect(users).toMatchObject({ archivePresent: false, archiveRows: 0, liveRows: 8, newEstimate: 0 });
  });
});

function buildOverlapMap(overlapCount = 50, sampleSize = 100, ...tables: string[]): Map<string, PkOverlapSample> {
  const names = tables.length > 0 ? tables : ['contests'];
  return new Map(names.map((name) => [name, overlap(overlapCount, sampleSize)]));
}

describe('pkSampleExpression', () => {
  it('quotes a single-column primary key', () => {
    expect(pkSampleExpression(['id'])).toBe('"id"');
  });

  it('joins a composite key as text with a separator no key value can contain', () => {
    expect(pkSampleExpression(['submission_id', 'dataset_id'])).toBe(`("submission_id"::text || '|' || "dataset_id"::text)`);
  });

  it('refuses an identifier that would break out of the quoting', () => {
    expect(() => pkSampleExpression(['id" ; DROP TABLE users; --'])).toThrow(/Refusing to build SQL/);
  });
});

describe('quoteIdentifier and qualifiedTable', () => {
  it('quotes a plain identifier', () => {
    expect(quoteIdentifier('submissions')).toBe('"submissions"');
    expect(qualifiedTable('public', 'submissions')).toBe('"public"."submissions"');
  });

  it('refuses a qualified name, a quote or a whitespace', () => {
    expect(() => qualifiedTable('public', 'users; DROP TABLE x')).toThrow(/Refusing to build SQL/);
    expect(() => qualifiedTable('public', '"users"')).toThrow(/Refusing to build SQL/);
    expect(() => quoteIdentifier('users users')).toThrow(/Refusing to build SQL/);
  });

  it('admits every catalog table name and primary key column', () => {
    for (const name of BACKUP_TABLE_NAMES) expect(() => quoteIdentifier(name)).not.toThrow();
    expect(() => pkSampleExpression(['submission_id', 'dataset_id'])).not.toThrow();
  });
});

describe('shapeSampleRows', () => {
  const columns = ['id', 'score', 'payload', 'submitted_at'];

  it('aligns positional rows to the declared column order', () => {
    const shape = shapeSampleRows(columns, [[1, 10, null, '2026-09-20T03:14:00Z']]);
    expect(shape.columns).toEqual(columns);
    expect(shape.rows).toEqual([[1, 10, null, '2026-09-20T03:14:00Z']]);
  });

  it('aligns record rows by column name and fills a missing column with null', () => {
    const shape = shapeSampleRows(columns, [{ id: 7, score: 3 }]);
    expect(shape.rows).toEqual([[7, 3, null, null]]);
  });

  it('renders a bigint as a decimal string because JSON has no bigint', () => {
    const [row] = shapeSampleRows(['count'], [[BigInt('9007199254740993')]]).rows;
    expect(row).toEqual(['9007199254740993']);
  });

  it('renders a bytea buffer as base64 with its length', () => {
    const [row] = shapeSampleRows(['blob'], [[Buffer.from('hi')]]).rows;
    expect(row).toEqual([{ type: 'bytes', byteLength: 2, base64: 'aGk=' }]);
  });

  it('renders dates as ISO strings and non-finite numbers as null', () => {
    const [row] = shapeSampleRows(['at', 'ratio'], [[new Date('2026-09-20T03:14:00Z'), Number.NaN]]).rows;
    expect(row).toEqual(['2026-09-20T03:14:00.000Z', null]);
  });

  it('never returns a value that breaks JSON.stringify', () => {
    const shape = shapeSampleRows(['nested'], [[{ a: [BigInt('1'), new Date(0)], b: Buffer.from([0xff]) }]]);
    expect(() => JSON.stringify(shape)).not.toThrow();
    expect(JSON.parse(JSON.stringify(shape)).rows[0][0].a[0]).toBe('1');
  });

  it('stops nesting at a bounded depth instead of recursing forever', () => {
    let deep: Record<string, unknown> = { end: true };
    for (let level = 0; level < 20; level += 1) deep = { child: deep };
    const [row] = shapeSampleRows(['deep'], [[deep]]).rows;
    expect(JSON.stringify(row)).toContain('null');
  });

  it('caps the rows at ten and never returns zero rows for a positive request', () => {
    const rows = Array.from({ length: 25 }, (_, index) => [index]);
    expect(shapeSampleRows(['id'], rows, MAX_SAMPLE_ROWS).rows).toHaveLength(MAX_SAMPLE_ROWS);
    expect(shapeSampleRows(['id'], rows, 4).rows).toHaveLength(4);
    expect(shapeSampleRows(['id'], rows, 1).rows).toHaveLength(1);
  });
});

describe('clampSampleRowCount', () => {
  it('clamps every request into the one-to-ten range', () => {
    expect(clampSampleRowCount(10)).toBe(10);
    expect(clampSampleRowCount(11)).toBe(MAX_SAMPLE_ROWS);
    expect(clampSampleRowCount(0)).toBe(1);
    expect(clampSampleRowCount(-3)).toBe(1);
    expect(clampSampleRowCount(2.9)).toBe(2);
    expect(clampSampleRowCount('5')).toBe(1);
    expect(clampSampleRowCount(Number.NaN)).toBe(1);
    expect(clampSampleRowCount(undefined)).toBe(1);
  });
});

describe('checkUploadFileName', () => {
  it('accepts a db dump named like the archive script writes it', () => {
    expect(checkUploadFileName('cmsdb-20260920-031400.dump')).toEqual({ ok: true });
  });

  it('rejects a volume archive and says why', () => {
    const result = checkUploadFileName('cmsvol-20260920-031400.tar.gz');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('volume archive');
  });

  it('rejects a gzipped sql listing and says why', () => {
    const result = checkUploadFileName('cmsdb-20260920-031400.sql.gz');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('.dump');
  });

  it('accepts any archive-pattern dump name, and rejects a name outside the pattern', () => {
    expect(checkUploadFileName('payload.dump').ok).toBe(true);
    expect(checkUploadFileName('../../etc/passwd').ok).toBe(false);
    expect(checkUploadFileName('').ok).toBe(false);
    expect(checkUploadFileName('dump').ok).toBe(false);
  });
});

describe('upload size cap', () => {
  it('defaults to 5 GB', () => {
    expect(getUploadMaxBytes()).toBe(5 * 1024 * 1024 * 1024);
    expect(UPLOAD_MAX_BYTES_DEFAULT).toBe(5368709120);
  });

  it('is overridable by RESTORE_PREVIEW_MAX_UPLOAD_BYTES', () => {
    process.env[UPLOAD_SIZE_LIMIT_ENV] = '1048576';
    expect(getUploadMaxBytes()).toBe(1048576);
  });

  it('falls back to the default for a missing or nonsensical override', () => {
    for (const value of ['', '   ', '0', '-1', 'many', '1.5']) {
      process.env[UPLOAD_SIZE_LIMIT_ENV] = value;
      expect(getUploadMaxBytes()).toBe(UPLOAD_MAX_BYTES_DEFAULT);
    }
  });
});

describe('preview identity and quarantine paths', () => {
  it('accepts only a 32-character lowercase hex id', () => {
    expect(isPreviewId(PREVIEW_ID)).toBe(true);
    expect(isPreviewId('A1B2C3D4E5F60718293A4B5C6D7E8F90')).toBe(false);
    expect(isPreviewId('a1b2c3d4')).toBe(false);
    expect(isPreviewId('../etc')).toBe(false);
    expect(isPreviewId(undefined)).toBe(false);
    expect(PREVIEW_ID_PATTERN.source).toBe('^[0-9a-f]{32}$');
  });

  it('quarantines in the OS temp directory, never in the backup root', () => {
    expect(getPreviewRoot()).toBe(path.join(os.tmpdir(), PREVIEW_ROOT_DIR_NAME));
    expect(previewQuarantineDir(PREVIEW_ID)).toBe(path.join(os.tmpdir(), PREVIEW_ROOT_DIR_NAME, PREVIEW_ID));
    expect(previewDumpPath(PREVIEW_ID, 'cmsdb-20260920-031400.dump')).toBe(
      path.join(os.tmpdir(), PREVIEW_ROOT_DIR_NAME, PREVIEW_ID, 'cmsdb-20260920-031400.dump'),
    );
    expect(getPreviewRoot().startsWith(os.tmpdir())).toBe(true);
  });

  it('names the scratch container after the preview so an orphan sweep can find it', () => {
    expect(previewContainerName(PREVIEW_ID)).toBe(`cms-restore-preview-${PREVIEW_ID}`);
    expect(ORPHAN_SWEEP_COMMAND).toContain(previewContainerName(PREVIEW_ID).slice(0, 'cms-restore-preview-'.length));
    expect(SCRATCH_IMAGE).toBe('postgres:15');
  });
});

describe('scratchDatabaseEnv', () => {
  it('mirrors the live user and database names so dumped ownership still resolves', () => {
    process.env.POSTGRES_USER = 'cmsadmin';
    process.env.POSTGRES_DB = 'cmsprod';
    expect(scratchDatabaseEnv()).toEqual({
      POSTGRES_USER: 'cmsadmin',
      POSTGRES_DB: 'cmsprod',
      POSTGRES_PASSWORD: expect.any(String),
    });
  });

  it('defaults to the same names the restore script defaults to', () => {
    expect(scratchDatabaseEnv().POSTGRES_USER).toBe('cmsuser');
    expect(scratchDatabaseEnv().POSTGRES_DB).toBe('cmsdb');
  });

  it('never reads the live database password', () => {
    process.env.POSTGRES_PASSWORD = 'live-secret';
    expect(scratchDatabaseEnv().POSTGRES_PASSWORD).not.toBe('live-secret');
  });
});

describe('sampling constants', () => {
  it('caps a preview at ten sample rows and bounds the overlap sample', () => {
    expect(MAX_SAMPLE_ROWS).toBe(10);
    expect(MAX_PK_SAMPLE_ROWS).toBe(200);
  });
});