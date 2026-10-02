/**
 * Chunked keyset relay: how the staging load moves a table's rows without ever
 * holding the table in memory.
 *
 * No docker, no Prisma, no filesystem: the relay owns the pagination rule, the
 * per-chunk accounting and the failure policy, and the caller owns how one page
 * is read and how one batch is written. Rows leave the source in primary-key
 * order, one bounded page at a time, so memory is bounded by the chunk size
 * rather than by the table and a table of any size takes the same path.
 *
 * Every page asks for the rows after the last key tuple of the previous one, so
 * no offset grows with the table and no row is read twice or skipped. Every
 * catalog key covers that: a serial id, a composite of two ids compared
 * row-wise, and the text `fsobjects.digest`.
 */

import { qualifiedTable, quoteIdentifier } from '@/lib/restore-preview';

/** Rows per page, and so the memory bound the relay runs under. */
export const RELAY_CHUNK_SIZE = 5_000;

/**
 * Budget for one chunk, covering the read out of the scratch container and the
 * insert into staging together. Far more than a chunk of this size needs, and
 * short enough that a stalled round trip stops the relay naming the chunk
 * instead of hanging the promote.
 */
export const RELAY_CHUNK_TIMEOUT_MS = 120_000;

export type RelayRow = Record<string, unknown>;
export type RelayRows = readonly RelayRow[];

/** One bounded read request: the relay builds it, the caller runs it. */
export interface RelayPage {
  readonly table: string;
  readonly sql: string;
  readonly chunkSize: number;
  /** The key tuple this page starts after; null for the first page. */
  readonly after: readonly string[] | null;
  readonly timeoutMs: number;
}

/** One bounded write, handed over once its page has been read. */
export interface RelayBatch {
  readonly table: string;
  /** The chunk's rows as one JSON document, ready for `json_populate_recordset`. */
  readonly payload: string;
  readonly rows: number;
}

export interface RelayProgress {
  readonly rowsMoved: number;
  readonly chunksDone: number;
}

export interface RelayOptions {
  readonly table: string;
  readonly columns: readonly string[];
  readonly pkColumns: readonly string[];
  readonly chunkSize?: number;
  readonly chunkTimeoutMs?: number;
  readonly onProgress?: (progress: RelayProgress) => void;
}

/** Reads one page as the JSON document the relay asked for. */
export type RelaySource = (page: RelayPage) => Promise<string>;

/** Writes one chunk's rows. */
export type RelaySink = (batch: RelayBatch) => Promise<void>;

/**
 * The page the relay asks for: the rows after `after`, in primary-key order, at
 * most `chunkSize` of them. A composite key compares row-wise, which postgres
 * evaluates in the same order the `ORDER BY` ranks the same columns, and a key
 * part is a quoted literal so a value carrying a quote cannot close it.
 */
export function relayPageSql(table: string, columns: readonly string[], pkColumns: readonly string[], chunkSize: number, after: readonly string[] | null): string {
  if (columns.length === 0) throw new Error(`Refusing to build a relay page for "${table}" with no columns`);
  if (pkColumns.length === 0) throw new Error(`Refusing to build a relay page for "${table}": keyset pagination needs a primary key to page on`);
  if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new Error(`Refusing to build a relay page for "${table}" that asks for ${chunkSize} row(s)`);
  if (after !== null && after.length !== pkColumns.length) throw new Error(`Refusing to page "${table}" after ${after.length} key part(s) of a ${pkColumns.length}-column key`);
  const key = pkColumns.map(quoteIdentifier).join(', ');
  const resume = after === null ? '' : ` WHERE (${key}) > (${after.map(sqlLiteral).join(', ')})`;
  const page = `SELECT ${columns.map(quoteIdentifier).join(', ')} FROM ${qualifiedTable('public', table)}${resume} ORDER BY ${key} LIMIT ${chunkSize}`;
  return `SELECT coalesce(json_agg(row_to_json(s))::text, '[]') FROM (${page}) AS s`;
}

/**
 * Moves one table from the source to the sink, one bounded chunk at a time.
 *
 * A chunk the source cannot read, the sink cannot write, or that outlives its
 * budget aborts the relay with that failure: the chunks already written stay
 * written, and nothing reports the table as fully relayed.
 */
export async function relayTable(source: RelaySource, sink: RelaySink, options: RelayOptions): Promise<RelayProgress> {
  const plan = resolveRelayPlan(options);
  const moved: RelayCounters = { rowsMoved: 0, chunksDone: 0 };
  let after: readonly string[] | null = null;
  for (;;) {
    const chunk = chunkRef(plan, moved, moved.chunksDone + 1);
    const rows = parseChunkRows(await withChunkBudget(source(pageOf(plan, after)), plan, chunk), plan.table);
    if (rows.length === 0) return moved;
    const batch: RelayBatch = { table: plan.table, payload: JSON.stringify(rows), rows: rows.length };
    await withChunkBudget(sink(batch), plan, chunk);
    after = nextKey(rows, plan.pkColumns, plan.table);
    moved.rowsMoved += rows.length;
    moved.chunksDone += 1;
    options.onProgress?.({ ...moved });
    if (rows.length < plan.chunkSize) return moved;
  }
}

// ---------------------------------------------------------------------------
// The plan, and the chunk in flight
// ---------------------------------------------------------------------------

interface RelayPlan {
  readonly table: string;
  readonly columns: readonly string[];
  readonly pkColumns: readonly string[];
  readonly chunkSize: number;
  readonly timeoutMs: number;
}

interface RelayCounters {
  rowsMoved: number;
  chunksDone: number;
}

/** Which chunk of which table is in flight, so an abort names it. */
interface RelayChunkRef {
  readonly table: string;
  readonly chunkNumber: number;
  readonly chunkSize: number;
  readonly timeoutMs: number;
  readonly rowsMoved: number;
  readonly chunksDone: number;
}

function resolveRelayPlan(options: RelayOptions): RelayPlan {
  const plan: RelayPlan = {
    table: options.table,
    columns: options.columns,
    pkColumns: options.pkColumns,
    chunkSize: options.chunkSize ?? RELAY_CHUNK_SIZE,
    timeoutMs: options.chunkTimeoutMs ?? RELAY_CHUNK_TIMEOUT_MS,
  };
  if (!Number.isInteger(plan.chunkSize) || plan.chunkSize < 1) throw new Error(`Refusing to relay "${plan.table}" ${plan.chunkSize} row(s) per chunk; the chunk size must be a positive whole number`);
  if (!Number.isInteger(plan.timeoutMs) || plan.timeoutMs < 1) throw new Error(`Refusing to relay "${plan.table}" on a ${plan.timeoutMs} ms chunk budget; the budget must be a positive whole number`);
  return plan;
}

function pageOf(plan: RelayPlan, after: readonly string[] | null): RelayPage {
  return { table: plan.table, sql: relayPageSql(plan.table, plan.columns, plan.pkColumns, plan.chunkSize, after), chunkSize: plan.chunkSize, after, timeoutMs: plan.timeoutMs };
}

function chunkRef(plan: RelayPlan, moved: RelayCounters, chunkNumber: number): RelayChunkRef {
  return { table: plan.table, chunkNumber, chunkSize: plan.chunkSize, timeoutMs: plan.timeoutMs, rowsMoved: moved.rowsMoved, chunksDone: moved.chunksDone };
}

async function withChunkBudget<T>(work: Promise<T>, plan: RelayPlan, chunk: RelayChunkRef): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`"${chunk.table}" chunk ${chunk.chunkNumber} did not finish within ${chunk.timeoutMs} ms (at most ${chunk.chunkSize} row(s) read and written). ${chunk.rowsMoved} row(s) of ${chunk.chunksDone} chunk(s) are already written and this run stops here.`)),
      plan.timeoutMs,
    );
  });
  try {
    return await Promise.race([work, expiry]);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Rows and keys
// ---------------------------------------------------------------------------

function parseChunkRows(payload: string, table: string): RelayRows {
  const text = payload.trim();
  if (text.length === 0) return [];
  const rows: unknown = JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error(`"${table}" returned a chunk that is not a JSON array of rows, so its row count is unknown`);
  return rows;
}

/** Where the next page starts: the key of the last row this one returned. */
function nextKey(rows: RelayRows, pkColumns: readonly string[], table: string): readonly string[] {
  const last = rows[rows.length - 1];
  return pkColumns.map((column) => keyLiteral(last[column], table, column));
}

function keyLiteral(value: unknown, table: string, column: string): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new Error(`"${table}" carries a row whose "${column}" is ${describeKeyValue(value)}, so it cannot be paged: keyset pagination needs a scalar key on every row`);
}

function describeKeyValue(value: unknown): string {
  if (value === undefined) return 'missing';
  if (value === null) return 'NULL';
  return `a ${Array.isArray(value) ? 'list' : typeof value}`;
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
