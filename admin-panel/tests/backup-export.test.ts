import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { exportFileName, parseExportSelection } from '@/lib/backup-export';
import { dumpArgv, openDumpStream } from '@/lib/backup-export-stream';
import { BACKUP_TABLE_NAMES } from '@/lib/backup-table-catalog';

/** A docker process the test drives by hand, so no container is involved. */
class FakeProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  kill(): boolean {
    return true;
  }
}

/** Lets a stream write land before the next assertion reads it. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function readAll(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text;
    text += decoder.decode(value);
  }
}

describe('exportFileName', () => {
  it('names the download the way an archive is named, so it can be uploaded back', () => {
    expect(exportFileName(Date.UTC(2026, 9, 7, 1, 2, 3))).toBe('cmsdb-20261007-010203.dump');
    expect(exportFileName(Date.UTC(2026, 0, 1, 0, 0, 0))).toMatch(/^cmsdb-\d{8}-\d{6}\.dump$/);
  });

  it('pads every field so the name sorts and parses', () => {
    expect(exportFileName(Date.UTC(2026, 0, 2, 3, 4, 5))).toBe('cmsdb-20260102-030405.dump');
  });
});

describe('parseExportSelection', () => {
  it('puts the selection in catalog order, which is parent-before-child', () => {
    const result = parseExportSelection('users,contests');
    expect(result.ok).toBe(true);
    expect(result.ok && result.tables).toEqual(['contests', 'users']);
  });

  it('tolerates whitespace, ignores empties and de-duplicates', () => {
    const result = parseExportSelection(' users ,, contests ,users, ');
    expect(result.ok && result.tables).toEqual(['contests', 'users']);
  });

  it('refuses a missing or empty selection instead of dumping everything', () => {
    for (const raw of [null, '', '   ', ',,,']) {
      const result = parseExportSelection(raw);
      expect(result.ok, String(raw)).toBe(false);
      expect(result.ok === false && result.error).toMatch(/Name the tables to export/);
    }
  });

  it('refuses a name outside the catalog before it can reach a shell argument', () => {
    const result = parseExportSelection('users; DROP TABLE admins');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/Not in the backup table catalog/);
  });

  it('refuses a name the catalog does not know', () => {
    const result = parseExportSelection('users,monitor_targets');
    expect(result.ok === false && result.error).toContain('monitor_targets');
  });

  it('carries the catalog warnings for a selection that needs them', () => {
    // `statements` stores digests that resolve to fsobjects, so a dump without it warns.
    const result = parseExportSelection('statements');
    expect(result.ok && result.warnings.some((warning) => warning.includes('fsobjects'))).toBe(true);
  });

  it('warns about nothing for a selection the catalog has no caveat for', () => {
    const result = parseExportSelection('users');
    expect(result.ok && result.warnings).toEqual([]);
  });

  it('accepts every catalog table at once', () => {
    const result = parseExportSelection(BACKUP_TABLE_NAMES.join(','));
    expect(result.ok && result.tables).toHaveLength(BACKUP_TABLE_NAMES.length);
  });
});

describe('dumpArgv', () => {
  it('streams a selective dump and archives nothing', () => {
    const args = dumpArgv(['contests', 'users'], false);
    expect(args).toEqual(['exec', 'cms-monitor', 'bash', '/usr/local/bin/cms-backup.sh', '--tables', 'contests,users', '--stdout']);
    expect(args).not.toContain('--root');
    expect(args).not.toContain('-d');
  });

  it('adds the large-object flag only when a selected table needs it', () => {
    expect(dumpArgv(['statements'], true)).toContain('--large-objects');
    expect(dumpArgv(['contests'], false)).not.toContain('--large-objects');
  });
});

describe('openDumpStream', () => {
  it('streams the dump once it starts producing bytes', async () => {
    const child = new FakeProcess();
    const pending = openDumpStream(['exec'], () => child);
    child.stdout.end(Buffer.from('DUMPBYTES'));
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(result.ok && (await readAll(result.body))).toBe('DUMPBYTES');
  });

  it('reports a run that fails before any byte rather than answering with an empty download', async () => {
    const child = new FakeProcess();
    const pending = openDumpStream(['exec'], () => child);
    child.stderr.write('pg_dump: connection to server failed');
    await flush();
    child.emit('close', 1);
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('connection to server failed');
  });

  it('reports a process that could not be spawned at all', async () => {
    const child = new FakeProcess();
    const pending = openDumpStream(['exec'], () => child);
    child.emit('error', new Error('spawn docker ENOENT'));
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('ENOENT');
  });

  it('does not turn a dump that already started into a failure when the process then fails', async () => {
    const child = new FakeProcess();
    const pending = openDumpStream(['exec'], () => child);
    child.stdout.write(Buffer.from('PARTIAL'));
    await flush();
    child.emit('close', 1);
    const result = await pending;
    expect(result.ok).toBe(true);
    child.stdout.end();
    expect(result.ok && (await readAll(result.body))).toBe('PARTIAL');
  });

  it('answers a healthy exit with no output as a failure, because nothing was dumped', async () => {
    const child = new FakeProcess();
    const pending = openDumpStream(['exec'], () => child);
    child.emit('close', 0);
    const result = await pending;
    expect(result.ok).toBe(false);
  });
});
