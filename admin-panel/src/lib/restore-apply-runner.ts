/**
 * The statement-runner seam: the byte budget every live statement travels
 * under, and the statements that carry a payload.
 *
 * No docker, no Prisma, no filesystem: the applier runs its statements through
 * an injected runner, so what a statement looks like on the wire — how large its
 * payload may get, and what it carries when `psql -c` has no bind parameter to
 * bind to — is decided here and reachable without a container.
 */

import { qualifiedTable } from '@/lib/restore-preview';
import { LARGE_OBJECT_TABLE, fsobjectInsertSql, sequenceNameQuerySql, sequenceResetSql, setLocalTimeoutSql, stagingLoadSql } from '@/lib/restore-apply-sql';
import type { LargeObjectCopy } from '@/lib/restore-apply-sql';

/**
 * Ceiling on one statement's text, in bytes.
 *
 * A live statement is handed to `psql -c`, so its text rides in the argument
 * list of one `docker exec`. The bound that decides whether the kernel accepts
 * it is `MAX_ARG_STRLEN`, 128 KiB for a single argument on Linux; the stdout cap
 * this applier configures its exec call with bounds what comes back, not what
 * goes out. Every gate below measures text as it will be sent, escaping
 * included: a literal carrying apostrophes is longer on the wire than the
 * payload it was built from, and the fixed SQL around that payload is counted
 * against this same ceiling rather than assumed to fit beside it.
 */
export const ARGV_PAYLOAD_MAX_BYTES = 100 * 1024;

/** How one built statement reaches the live database. */
export interface LiveStatementRunner {
  /** Runs one statement and returns what it printed. */
  readonly runSql: (sql: string, timeoutMs: number) => Promise<string>;
  /** Runs one scalar count query. */
  readonly runCount: (sql: string) => Promise<number>;
}

/** One table's merge or overwrite, as the single statement it runs as. */
export interface TableTransaction {
  readonly table: string;
  /** The merge or the overwrite half, already chosen by the caller. */
  readonly statements: readonly string[];
  readonly pkColumns: readonly string[];
  readonly expectedAfter: number;
  /** The `SET LOCAL` budget for the statements inside the transaction. */
  readonly statementTimeoutMs: number;
  /** The budget for reading which sequence owns the key. */
  readonly queryTimeoutMs: number;
  /** The budget for running the transaction as a whole. */
  readonly runTimeoutMs: number;
}

/**
 * Runs one table's transaction as one statement.
 *
 * The trailing assertion divides by zero when the live row count is not the one
 * the strategy promised, which rolls the table back instead of reporting the
 * table applied. The sequence reset is resolved and run inside the transaction,
 * so a key that cannot be advanced rolls it back too, rather than committing
 * rows against a sequence that would hand out a colliding id.
 */
export async function runTableTransaction(runner: LiveStatementRunner, request: TableTransaction): Promise<void> {
  const sequences = await sequenceResetStatements(runner, request);
  await runner.runSql(
    [
      'BEGIN',
      `${setLocalTimeoutSql(request.statementTimeoutMs)};`,
      ...request.statements,
      ...sequences,
      `SELECT CASE WHEN (SELECT count(*) FROM ${qualifiedTable('public', request.table)}) = ${request.expectedAfter} THEN 1 ELSE 1 / 0 END`,
      'COMMIT',
    ].join('\n'),
    request.runTimeoutMs,
  );
}

async function sequenceResetStatements(runner: LiveStatementRunner, request: TableTransaction): Promise<readonly string[]> {
  if (request.pkColumns.length !== 1) return [];
  const reported = (await runner.runSql(sequenceNameQuerySql(request.table, request.pkColumns[0]), request.queryTimeoutMs)).trim();
  const reset = sequenceResetSql(request.table, request.pkColumns[0], reported.length > 0 ? reported : null);
  return reset === null ? [] : [`${reset};`];
}

/**
 * Loads one page of archive rows into its staging table.
 *
 * The page is carried as a quoted literal rather than as a bound parameter,
 * because `psql -c` speaks the simple query protocol: the statement text is all
 * there is to send, so a `$1` in it would reach the server unbound. The gate
 * measures the statement the builder returns rather than the page handed to it,
 * so a page whose apostrophes are doubled on the way into the literal is
 * measured at the size it is actually asked to carry.
 */
export async function runStagingLoad(runner: LiveStatementRunner, stagingSchema: string, table: string, columns: readonly string[], payload: string, timeoutMs: number): Promise<void> {
  const statement = stagingLoadSql(stagingSchema, table, columns, payload);
  const statementBytes = Buffer.byteLength(statement);
  if (statementBytes > ARGV_PAYLOAD_MAX_BYTES) {
    throw new Error(`"${table}" carries a page whose staging statement is ${statementBytes} byte(s), past the ${ARGV_PAYLOAD_MAX_BYTES} bytes one \`psql -c\` argument can be asked to carry, so it cannot be staged.`);
  }
  await runner.runSql(statement, timeoutMs);
}

/**
 * Bytes one blob row contributes to its batch's insert: all three of its values
 * as `fsobjectInsertSql` copies them, each literal measured after that builder
 * doubles its apostrophes. A row joins a batch that has no statement yet, so
 * this is the only place its cost can be known, and the flush it decides has to
 * know it at the size the insert will really be.
 *
 * The SQL wrapped around those values is not counted here. `blobBatchInsertSql`
 * measures the finished statement before it is sent, so what this leaves out is
 * still refused there rather than reaching the argument list.
 */
export function blobRowBytes(row: LargeObjectCopy): number {
  return escapedLiteralBytes(row.digest) + Buffer.byteLength(row.encoded) + (row.description === null ? 0 : escapedLiteralBytes(row.description));
}

/**
 * Bytes one value costs once quoted: an apostrophe is written twice, so every
 * one it holds costs a byte its plain length does not count. Mirrors the
 * doubling `fsobjectInsertSql` and `stagingLoadSql` apply to a literal.
 */
function escapedLiteralBytes(value: string): number {
  return Buffer.byteLength(value) + (value.match(/'/g)?.length ?? 0);
}

/** Whether appending one blob keeps its batch's insert inside one argument. */
export function blobBatchFits(bytes: number, row: LargeObjectCopy): boolean {
  return bytes + blobRowBytes(row) <= ARGV_PAYLOAD_MAX_BYTES;
}

/**
 * The insert for one blob batch, refused when it cannot travel as one argument.
 * No batch size can split a statement's own payload, so a file past the ceiling
 * is the file itself that has to give, and it is named here rather than arriving
 * as an opaque exec failure.
 */
export function blobBatchInsertSql(rows: readonly LargeObjectCopy[]): string {
  const oversized = rows.find((row) => blobRowBytes(row) > ARGV_PAYLOAD_MAX_BYTES);
  if (oversized !== undefined) {
    throw new Error(`"${LARGE_OBJECT_TABLE}" carries the file "${oversized.digest}" at ${blobRowBytes(oversized)} byte(s), past the ${ARGV_PAYLOAD_MAX_BYTES} bytes one \`psql -c\` argument can be asked to carry, so its bytes cannot be copied in one statement.`);
  }
  const statement = `BEGIN;\n${fsobjectInsertSql(rows)};\nCOMMIT;\n`;
  if (Buffer.byteLength(statement) > ARGV_PAYLOAD_MAX_BYTES) {
    throw new Error(`"${LARGE_OBJECT_TABLE}" carries a batch of ${rows.length} blob(s) whose insert is ${Buffer.byteLength(statement)} byte(s), past the ${ARGV_PAYLOAD_MAX_BYTES} bytes one \`psql -c\` argument can be asked to carry.`);
  }
  return statement;
}