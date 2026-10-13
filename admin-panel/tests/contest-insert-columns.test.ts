import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The panel writes contests through a hand-maintained raw INSERT (contests-repo.ts),
// so the ORM's schema safety does not apply. A NOT NULL column added by
// scripts/__fix_db_schema.sql that the statement does not name makes every panel
// create fail with 23502 — the throttle family was missed exactly this way.
const REPO = path.resolve(__dirname, '../..');
const FIX_SQL = path.join(REPO, 'scripts/__fix_db_schema.sql');
const REPO_TS = path.join(REPO, 'admin-panel/src/lib/contests-repo.ts');

function notNullContestColumns(): string[] {
  const sql = readFileSync(FIX_SQL, 'utf8');
  const columns: string[] = [];
  for (const match of sql.matchAll(/ALTER TABLE contests ADD COLUMN IF NOT EXISTS ([a-z_]+)([^;]*);/gi)) {
    if (/NOT NULL/i.test(match[2])) columns.push(match[1]);
  }
  return columns;
}

function insertColumns(): string[] {
  const source = readFileSync(REPO_TS, 'utf8');
  const header = 'INSERT INTO contests (';
  const start = source.indexOf(header);
  const end = source.indexOf(') VALUES (', start);
  return source
    .slice(start + header.length, end)
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => /^[a-z_]+$/i.test(entry));
}

describe('contest INSERT vs the patch-owned NOT NULL columns', () => {
  it('names every NOT NULL contests column the schema patch adds', () => {
    const columns = insertColumns();
    const missing = notNullContestColumns().filter((column) => !columns.includes(column));
    expect(missing).toEqual([]);
  });
});
