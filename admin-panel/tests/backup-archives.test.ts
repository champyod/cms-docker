import { mkdir, mkdtemp, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  archiveKind,
  capArchives,
  getBackupRoot,
  isArchiveName,
  listArchives,
  resolveArchivePath,
  sortNewestFirst,
} from '@/lib/backup-archives';
import type { BackupArchive } from '@/lib/backup-archives';

const DUMP_NAME = 'cmsdb-20260101-120000.dump';
const TARBALL_NAME = 'cms-data-20260101-120000.tar.gz';
const SQL_NAME = 'cmsdb-20260101-120000.sql.gz';

let backupRoot: string;
let outsideRoot: string;
const originalBackupDir = process.env.BACKUP_DIR;

async function seed(root: string): Promise<void> {
  await mkdir(path.join(root, 'db'), { recursive: true });
  await mkdir(path.join(root, 'volumes'), { recursive: true });
  await writeFile(path.join(root, 'db', DUMP_NAME), 'dump-bytes');
  await writeFile(path.join(root, 'volumes', TARBALL_NAME), 'tar-bytes');
  await utimes(path.join(root, 'db', DUMP_NAME), new Date('2026-01-01T12:00:00Z'), new Date('2026-01-01T12:00:00Z'));
  await utimes(path.join(root, 'volumes', TARBALL_NAME), new Date('2026-01-01T13:00:00Z'), new Date('2026-01-01T13:00:00Z'));
}

async function plantEscapingSymlink(linkPath: string): Promise<void> {
  const target = path.join(outsideRoot, 'outside.dump');
  await writeFile(target, 'secret');
  await symlink(target, linkPath);
}

function archiveAt(name: string, modifiedAt: string): BackupArchive {
  return { name, kind: archiveKind(name) ?? 'db', relativePath: name, sizeBytes: 1, modifiedAt };
}

beforeEach(async () => {
  backupRoot = await mkdtemp(path.join(tmpdir(), 'backup-archives-'));
  outsideRoot = await mkdtemp(path.join(tmpdir(), 'backup-outside-'));
  process.env.BACKUP_DIR = backupRoot;
});

afterEach(() => {
  if (originalBackupDir === undefined) delete process.env.BACKUP_DIR;
  else process.env.BACKUP_DIR = originalBackupDir;
});

describe('isArchiveName', () => {
  it('accepts the three artifact shapes the backup script writes', () => {
    expect([DUMP_NAME, TARBALL_NAME, SQL_NAME].every(isArchiveName)).toBe(true);
  });

  it('rejects every name that carries a path separator', () => {
    for (const name of ['../x', '../../etc/passwd.dump', '/etc/passwd.dump', 'db/cmsdb-1.dump', '..', './x.dump']) {
      expect(isArchiveName(name), name).toBe(false);
    }
  });

  it('rejects sidecars, manifests and names the script never produces', () => {
    for (const name of [`${DUMP_NAME}.sha256`, `${TARBALL_NAME}.sha256`, 'manifest.json', 'cms db.dump', '', 'x.dumpz', 'x.gnupg']) {
      expect(isArchiveName(name), name).toBe(false);
    }
  });
});

describe('archiveKind', () => {
  it('maps each artifact extension to its kind', () => {
    expect(archiveKind(DUMP_NAME)).toBe('db');
    expect(archiveKind(TARBALL_NAME)).toBe('volume');
    expect(archiveKind(SQL_NAME)).toBe('sql');
  });

  it('returns null for anything outside the allowlist', () => {
    expect(archiveKind('manifest.json')).toBeNull();
  });
});

describe('sortNewestFirst and capArchives', () => {
  it('orders by mtime, newest first', () => {
    const sorted = sortNewestFirst([archiveAt('old.dump', '2026-01-01T00:00:00.000Z'), archiveAt('new.dump', '2026-02-01T00:00:00.000Z')]);
    expect(sorted.map((archive) => archive.name)).toEqual(['new.dump', 'old.dump']);
  });

  it('breaks an mtime tie by name so the order never depends on readdir', () => {
    const tie = '2026-01-01T00:00:00.000Z';
    const sorted = sortNewestFirst([archiveAt('b.dump', tie), archiveAt('a.dump', tie)]);
    expect(sorted.map((archive) => archive.name)).toEqual(['b.dump', 'a.dump']);
  });

  it('does not mutate its input', () => {
    const archives = [archiveAt('old.dump', '2026-01-01T00:00:00.000Z'), archiveAt('new.dump', '2026-02-01T00:00:00.000Z')];
    sortNewestFirst(archives);
    expect(archives.map((archive) => archive.name)).toEqual(['old.dump', 'new.dump']);
  });

  it('caps at 200 archives and drops the oldest beyond it', () => {
    const many = Array.from({ length: 205 }, (_, index) => archiveAt(`dump-${index}.dump`, new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()));
    const capped = capArchives(many);
    expect(capped).toHaveLength(200);
    expect(capped[0]?.name).toBe('dump-204.dump');
    expect(capped.at(-1)?.name).toBe('dump-5.dump');
  });

  it('returns nothing for a limit of zero', () => {
    expect(capArchives([archiveAt('a.dump', '2026-01-01T00:00:00.000Z')], 0)).toEqual([]);
  });
});

describe('getBackupRoot', () => {
  it('prefers BACKUP_DIR over the repository default', () => {
    expect(getBackupRoot()).toBe(backupRoot);
  });

  it('falls back to backups/ inside the repository', () => {
    delete process.env.BACKUP_DIR;
    expect(getBackupRoot()).toBe(path.join(process.cwd(), '..', 'backups'));
  });
});

describe('listArchives', () => {
  it('returns nothing for an empty backup root', async () => {
    expect(await listArchives()).toEqual([]);
  });

  it('returns nothing when the backup root does not exist', async () => {
    process.env.BACKUP_DIR = path.join(backupRoot, 'absent');
    expect(await listArchives()).toEqual([]);
  });

  it('reads db and volume artifacts newest first with size and relative path', async () => {
    await seed(backupRoot);
    expect(await listArchives()).toEqual([
      { name: TARBALL_NAME, kind: 'volume', relativePath: `volumes/${TARBALL_NAME}`, sizeBytes: 'tar-bytes'.length, modifiedAt: '2026-01-01T13:00:00.000Z' },
      { name: DUMP_NAME, kind: 'db', relativePath: `db/${DUMP_NAME}`, sizeBytes: 'dump-bytes'.length, modifiedAt: '2026-01-01T12:00:00.000Z' },
    ]);
  });

  it('skips checksum sidecars and the manifest', async () => {
    await seed(backupRoot);
    await writeFile(path.join(backupRoot, 'db', `${DUMP_NAME}.sha256`), 'digest');
    await writeFile(path.join(backupRoot, 'manifest.json'), '[]');
    expect((await listArchives()).map((archive) => archive.name)).toEqual([TARBALL_NAME, DUMP_NAME]);
  });

  it('never lists more than 200 archives', async () => {
    await mkdir(path.join(backupRoot, 'db'), { recursive: true });
    for (let index = 0; index < 205; index += 1) {
      const file = path.join(backupRoot, 'db', `cmsdb-2026010${index % 9}-1200${String(index).padStart(2, '0')}.dump`);
      await writeFile(file, 'x');
      await utimes(file, new Date(Date.UTC(2026, 0, 1, 0, index)), new Date(Date.UTC(2026, 0, 1, 0, index)));
    }
    expect(await listArchives()).toHaveLength(200);
  });

  it('does not list a symlink that points outside the backup root', async () => {
    await seed(backupRoot);
    await plantEscapingSymlink(path.join(backupRoot, 'db', 'cmsdb-link.dump'));
    expect((await listArchives()).map((archive) => archive.name)).toEqual([TARBALL_NAME, DUMP_NAME]);
  });
});

describe('resolveArchivePath', () => {
  it('resolves an existing db dump inside the backup root', async () => {
    await seed(backupRoot);
    expect(await resolveArchivePath(DUMP_NAME)).toBe(path.join(backupRoot, 'db', DUMP_NAME));
  });

  it('resolves a volume artifact', async () => {
    await seed(backupRoot);
    expect(await resolveArchivePath(TARBALL_NAME)).toBe(path.join(backupRoot, 'volumes', TARBALL_NAME));
  });

  it('refuses a name outside the allowlist before touching the filesystem', async () => {
    await seed(backupRoot);
    for (const name of ['../outside.dump', '/etc/passwd', 'manifest.json', `${DUMP_NAME}.sha256`]) {
      expect(await resolveArchivePath(name), name).toBeNull();
    }
  });

  it('returns null for an archive that is not there', async () => {
    await seed(backupRoot);
    expect(await resolveArchivePath('cmsdb-20260102-000000.dump')).toBeNull();
  });

  it('returns null when the backup root is absent', async () => {
    process.env.BACKUP_DIR = path.join(backupRoot, 'absent');
    expect(await resolveArchivePath(DUMP_NAME)).toBeNull();
  });

  it('refuses a symlink inside the backup root that escapes it', async () => {
    await seed(backupRoot);
    await plantEscapingSymlink(path.join(backupRoot, 'db', 'cmsdb-link.dump'));
    expect(await resolveArchivePath('cmsdb-link.dump')).toBeNull();
  });
});