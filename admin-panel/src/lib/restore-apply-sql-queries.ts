/**
 * The read-only queries the applier measures with: what the live database holds
 * right now, and what the scratch container's archive holds beside it. None of
 * these statements writes, and none of them is ever sent to the live database
 * inside an apply transaction.
 *
 * No docker, no Prisma, no filesystem: the queries are built here, and the
 * caller decides what their results mean. The statements an apply runs live in
 * `restore-apply-sql.ts`.
 */

import { qualifiedTable, quoteIdentifier } from '@/lib/restore-preview';
import { LARGE_OBJECT_CHUNK_BYTES, LARGE_OBJECT_DESCRIPTION_COLUMN, LARGE_OBJECT_DIGEST_COLUMN, LARGE_OBJECT_OID_COLUMN, LARGE_OBJECT_TABLE } from '@/lib/restore-apply-sql';

// ---------------------------------------------------------------------------
// Live read-only measurement queries
// ---------------------------------------------------------------------------

export function stagingSchemaTableCountSql(stagingSchema: string): string {
  return `SELECT count(*)::bigint::text FROM information_schema.tables WHERE table_schema = '${stagingSchema}'`;
}

/**
 * `tables` is a catalog table list the caller already validated, so it is
 * embedded as a quoted literal list rather than bound as an array: it selects
 * information_schema rows and never interpolates a value.
 */
export function nameListLiteral(tables: readonly string[]): string {
  return tables.map((table) => `'${quoteIdentifier(table).slice(1, -1)}'`).join(', ');
}

export function liveColumnsQuerySql(tables: readonly string[]): string {
  const names = nameListLiteral(tables);
  return `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN (${names}) ORDER BY table_name, ordinal_position`;
}

export function livePrimaryKeyQuerySql(tables: readonly string[]): string {
  const names = nameListLiteral(tables);
  return `SELECT k.table_name, k.column_name FROM information_schema.table_constraints AS c JOIN information_schema.key_column_usage AS k ON k.constraint_name = c.constraint_name AND k.table_schema = c.table_schema WHERE c.table_schema = 'public' AND c.constraint_type = 'PRIMARY KEY' AND c.table_name IN (${names}) ORDER BY k.table_name, k.ordinal_position`;
}

export function liveFkParentQuerySql(tables: readonly string[]): string {
  const names = nameListLiteral(tables);
  return `SELECT DISTINCT child.table_name, parent.table_name AS parent_name FROM information_schema.referential_constraints AS rc JOIN information_schema.key_column_usage AS child ON child.constraint_name = rc.constraint_name AND child.constraint_schema = rc.constraint_schema JOIN information_schema.key_column_usage AS parent ON parent.constraint_name = rc.unique_constraint_name AND parent.constraint_schema = rc.unique_constraint_schema WHERE rc.constraint_schema = 'public' AND child.table_name IN (${names}) ORDER BY child.table_name, parent.table_name`;
}

export function liveDigestQuerySql(): string {
  return `SELECT count(*)::bigint::text FROM ${qualifiedTable('public', LARGE_OBJECT_TABLE)}`;
}

export function liveDigestListQuerySql(): string {
  return `SELECT ${quoteIdentifier(LARGE_OBJECT_DIGEST_COLUMN)} FROM ${qualifiedTable('public', LARGE_OBJECT_TABLE)}`;
}

/**
 * Archive-side checks, run against the scratch container. The blob bytes live
 * there, so the integrity and size checks belong to that database: a staging
 * `loid` would name a large object in the live database, which is exactly the
 * assumption this applier refuses to make.
 */
export function archiveDigestIntegritySql(): string {
  return `SELECT count(*)::bigint::text FROM ${qualifiedTable('public', LARGE_OBJECT_TABLE)} AS f WHERE NOT EXISTS (SELECT 1 FROM pg_largeobject AS l WHERE l.loid = f.${quoteIdentifier(LARGE_OBJECT_OID_COLUMN)})`;
}

export function archiveDigestBytesSql(): string {
  return `SELECT (count(*)::bigint * ${LARGE_OBJECT_CHUNK_BYTES})::bigint::text FROM pg_largeobject AS l WHERE EXISTS (SELECT 1 FROM ${qualifiedTable('public', LARGE_OBJECT_TABLE)} AS f WHERE f.${quoteIdentifier(LARGE_OBJECT_OID_COLUMN)} = l.loid)`;
}

export function archiveDigestListSql(): string {
  return `SELECT ${quoteIdentifier(LARGE_OBJECT_DIGEST_COLUMN)} FROM ${qualifiedTable('public', LARGE_OBJECT_TABLE)} ORDER BY ${quoteIdentifier(LARGE_OBJECT_DIGEST_COLUMN)}`;
}

/** Bytes for one named digest, read out of the scratch container's own large object. */
export function archiveDigestBytesForSql(digest: string): string {
  const escaped = digest.replace(/'/g, "''");
  return `SELECT encode(lo_get(f.${quoteIdentifier(LARGE_OBJECT_OID_COLUMN)}), 'base64') FROM ${qualifiedTable('public', LARGE_OBJECT_TABLE)} AS f WHERE f.${quoteIdentifier(LARGE_OBJECT_DIGEST_COLUMN)} = '${escaped}'`;
}

export function archiveDigestDescriptionSql(digest: string): string {
  const escaped = digest.replace(/'/g, "''");
  return `SELECT coalesce(f.${quoteIdentifier(LARGE_OBJECT_DESCRIPTION_COLUMN)}, '') FROM ${qualifiedTable('public', LARGE_OBJECT_TABLE)} AS f WHERE f.${quoteIdentifier(LARGE_OBJECT_DIGEST_COLUMN)} = '${escaped}'`;
}

export function databaseSizeQuerySql(): string {
  return 'SELECT pg_database_size(current_database())::bigint::text';
}

// ---------------------------------------------------------------------------
// Privilege rows, read on both sides of the comparison
// ---------------------------------------------------------------------------

/**
 * Accounts are read as `username`+`enabled` rather than by id, because the delta
 * the operator must see is "does this login exist, and can it be used", not
 * "did the surrogate key change". The id is carried alongside so a username that
 * lives under a different id on each side can be reported as a conflict instead
 * of silently merged.
 *
 * Username and group name are the operator-facing text; a permission key is a
 * dotted token. Neither can contain a tab, which is what makes this safe to read
 * as one delimited column: `Codename` usernames and group names are drawn from a
 * restricted charset, and a key never contains whitespace.
 */
const FIELD_SEPARATOR = '|';

function delimited(fields: readonly string[]): string {
  return `${fields.map((field) => `${field}::text`).join(` || '${FIELD_SEPARATOR}' || `)}`;
}

export function accountRowsSql(): string {
  return `SELECT ${delimited(['id', 'username', 'enabled'])} FROM public.admins ORDER BY username, id`;
}

/**
 * Archive usernames that already exist live under a different id are found by
 * comparing the two halves of this row set rather than by one statement spanning
 * both: the archive lives in the scratch container and the live rows do not, so
 * no single query can see the pair. `accountConflictsBetween` in
 * `restore-apply-privileges.ts` is where that comparison lives.
 */
export function membershipRowsSql(): string {
  return [
    `SELECT ${delimited(['a.username', 'g.name'])}`,
    'FROM public.admin_groups AS m JOIN public.admins AS a ON a.id = m.admin_id JOIN public.groups AS g ON g.id = m.group_id',
    'ORDER BY a.username, g.name',
  ].join(' ');
}

export function overrideRowsSql(): string {
  return [
    `SELECT ${delimited(['a.username', 'p.key', 'o.effect'])}`,
    'FROM public.admin_permission_overrides AS o JOIN public.admins AS a ON a.id = o.admin_id JOIN public.permissions AS p ON p.id = o.permission_id',
    'ORDER BY a.username, p.key',
  ].join(' ');
}