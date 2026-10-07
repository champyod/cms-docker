/**
 * The blocking conflicts a promote reports, and the vocabulary an operator
 * resolves them with.
 *
 * Two things stop a promote that the measurement can see before a live row is
 * written. The first is a table set to overwrite while an applied child still
 * references it: this schema's foreign keys are not deferrable, so a per-table
 * delete would break them and the child cannot be deferred out of the way. The
 * second is a unique value the archive and the live table both hold under
 * different primary keys: the merge upserts on the primary key alone, so it
 * never sees the collision and goes on to violate the unique index, which rolls
 * the whole table back.
 *
 * A unique value is carried as the column values themselves, never as text
 * joined by a separator. `@@unique([task_id, filename])` is in this schema, and a
 * filename may contain any character a separator could use, so joined text would
 * let two different rows compare as one. Values and keys are compared as whole
 * arrays.
 *
 * No docker, no Prisma, no filesystem: every rule here is decided from text and
 * arrays, so the conflict vocabulary is testable without a database. The
 * statement that resolves one against the scratch copy lives in
 * `restore-apply-sql.ts`, the read-only query that measures one in
 * `restore-apply-sql-queries.ts`, and the decisions that raise one in
 * `restore-apply-plan.ts`.
 */

import { ADMIN_TABLE } from '@/lib/backup-table-catalog';
// The identifier rules come from the leaf module, not from `restore-preview`:
// that one reaches `node:os`, and the confirmation popup imports this module, so
// anything it pulls in has to be bundleable for the browser.
import { IDENTIFIER_PATTERN } from '@/lib/sql-identifier';
import type { ApplyStrategies, TableStrategy } from '@/lib/restore-apply';

// ---------------------------------------------------------------------------
// Unique-index reading
// ---------------------------------------------------------------------------

/**
 * Rows read per side of one unique-index check.
 *
 * The check is bounded so a table of millions cannot make validation unbounded
 * in time or memory. A side that reaches the cap is reported as truncated rather
 * than passed in silence: a conflict beyond the cap would otherwise surface as a
 * rolled-back table during the promote instead of a prompt during validation.
 */
export const UNIQUE_CHECK_ROW_LIMIT = 5_000;

/** One unique index as `pg_indexes` describes it. */
export interface UniqueIndexRow {
  readonly table: string;
  readonly name: string;
  readonly definition: string;
}

/** One unique index reduced to the table and columns a check can read. */
export interface UniqueIndex {
  readonly table: string;
  readonly name: string;
  readonly columns: readonly string[];
}

const UNIQUE_INDEX_PREFIX = 'CREATE UNIQUE INDEX';
const USING_TOKEN = 'USING ';
const PARTIAL_MARKER = ' WHERE ';

/**
 * Reads the unique indexes a check can actually compare.
 *
 * Three shapes are dropped rather than guessed at. A partial index constrains
 * only the rows its predicate selects, so the applier cannot decide which rows
 * it governs. An expression index keys on a computed value, which is not a
 * column that can be read out and compared. And an index whose column list will
 * not parse as plain identifiers is either of the above in a form this parser
 * did not recognize, which is itself a reason not to act on it.
 */
export function parseUniqueIndexes(rows: readonly UniqueIndexRow[]): readonly UniqueIndex[] {
  const parsed: UniqueIndex[] = [];
  for (const row of rows) {
    const columns = columnsOf(row.definition);
    if (columns === null) continue;
    parsed.push({ table: row.table, name: row.name, columns });
  }
  return parsed;
}

function columnsOf(definition: string): readonly string[] | null {
  if (!definition.toUpperCase().startsWith(UNIQUE_INDEX_PREFIX)) return null;
  if (definition.toUpperCase().includes(PARTIAL_MARKER)) return null;
  const list = columnListOf(definition);
  if (list === null || list.includes('(')) return null;
  const names = list.split(',').map((part) => unquote(part.trim()));
  if (names.length === 0) return null;
  return names.every((name) => IDENTIFIER_PATTERN.test(name)) ? names : null;
}

/** The text between the parentheses that follow `USING`, matched by depth so an expression cannot end it early. */
function columnListOf(definition: string): string | null {
  const usingAt = definition.indexOf(USING_TOKEN);
  if (usingAt < 0) return null;
  const openAt = definition.indexOf('(', usingAt + USING_TOKEN.length);
  if (openAt < 0) return null;
  let depth = 0;
  for (let index = openAt; index < definition.length; index += 1) {
    const character = definition[index];
    if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0) return definition.slice(openAt + 1, index);
    }
  }
  return null;
}

/** Postgres quotes an identifier only when it has to, so both forms reach the same name. */
function unquote(name: string): string {
  return name.length > 1 && name.startsWith('"') && name.endsWith('"') ? name.slice(1, -1) : name;
}

/**
 * An index whose columns already contain the whole primary key can never
 * conflict: two rows with different keys differ in the key part, and two rows
 * with the same key are one row the upsert updates. Reading such an index only
 * costs rows, so the measurement skips it.
 */
export function uniqueIndexNeedsCheck(index: UniqueIndex, primaryKey: readonly string[]): boolean {
  return primaryKey.length > 0 && !primaryKey.every((column) => index.columns.includes(column));
}

/**
 * Whether the privilege rules already report this index.
 *
 * `admins.username` is measured from the privilege rows, which have both sides in
 * hand without a table read, and it is reported as an account conflict. A generic
 * check on the same index would report the same fact a second time, under a
 * different conflict id, so the operator would be prompted twice for one
 * problem.
 */
export function isPrivilegeOwnedIndex(index: UniqueIndex): boolean {
  return index.table === ADMIN_TABLE && index.columns.length === 1 && index.columns[0] === 'username';
}

// ---------------------------------------------------------------------------
// Unique-value conflicts
// ---------------------------------------------------------------------------

/** One unique value as one side of the comparison reads it, with the row that carries it. */
export interface UniqueValueRow {
  /** The shared column values, aligned to the index's columns. */
  readonly values: readonly string[];
  /** The row's primary-key values, aligned to that table's primary key. */
  readonly key: readonly string[];
}

/** An archive value the live table already holds under a different primary key. */
export interface UniqueValueConflict {
  /** Stable across re-measurement, so a resolution the operator already made can be recognized. */
  readonly id: string;
  readonly kind: 'unique-value';
  readonly table: string;
  readonly index: string;
  readonly columns: readonly string[];
  /** The column values both rows carry, aligned to `columns`. */
  readonly values: readonly string[];
  /** Primary-key values of the archive row that carries the value. */
  readonly stagedKey: readonly string[];
  /** Primary-key values of the live row that already carries it. */
  readonly liveKey: readonly string[];
}

/** Two values are the same row value only when every column matches, so the comparison is the whole array. */
function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Finds the archive values live already holds under a different row.
 *
 * A value on both sides under the same primary key is not a conflict: that is
 * one row the merge updates in place, which is exactly what the upsert is for.
 * Only a value whose rows differ collides on the unique index while matching on
 * nothing the upsert keys on.
 */
export function detectUniqueConflicts(
  index: UniqueIndex,
  staged: readonly UniqueValueRow[],
  live: readonly UniqueValueRow[],
): readonly UniqueValueConflict[] {
  const liveRows = live.map((row) => ({ row, identity: JSON.stringify(row.values) }));
  const liveByIdentity = new Map(liveRows.map((entry) => [entry.identity, entry.row]));
  const conflicts: UniqueValueConflict[] = [];
  for (const row of staged) {
    const existing = liveByIdentity.get(JSON.stringify(row.values));
    if (existing === undefined || sameValues(existing.key, row.key)) continue;
    conflicts.push({
      id: uniqueConflictId(index, row.values),
      kind: 'unique-value',
      table: index.table,
      index: index.name,
      columns: [...index.columns],
      values: [...row.values],
      stagedKey: [...row.key],
      liveKey: [...existing.key],
    });
  }
  return conflicts.sort((left, right) => displayValues(left.values).localeCompare(displayValues(right.values)));
}

export function uniqueConflictId(index: UniqueIndex, values: readonly string[]): string {
  return `unique:${index.table}:${index.name}:${JSON.stringify(values)}`;
}

/** The column values as one line of text for a prompt; identity comparisons never use this. */
export function displayValues(values: readonly string[]): string {
  return values.map((value) => (value === '' ? '(empty)' : value)).join(', ');
}

export function displayKey(key: readonly string[]): string {
  return key.join(', ');
}

/**
 * Reads the pair rows a check query returns: one JSON array per row, the index
 * column values then the primary-key values.
 *
 * The transport is JSON rather than delimited text because an index column can
 * hold any character at all — `@@unique([task_id, filename])` is in this schema —
 * so no separator could be trusted to keep two rows apart. A row whose values
 * would arrive as a non-string is refused rather than coerced: the check query
 * excludes NULL values, so a non-string means the query and this parser disagree
 * about the shape.
 */
export function parseUniqueValueRows(raw: string): readonly UniqueValueRow[] {
  const trimmed = raw.trim();
  const parsed: unknown = JSON.parse(trimmed.length === 0 ? '[]' : trimmed);
  if (!Array.isArray(parsed)) throw new Error('A unique-index check did not return a JSON array.');
  return parsed.map((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2 || !Array.isArray(entry[0]) || !Array.isArray(entry[1])) {
      throw new Error('A unique-index check returned a row that is not a value-and-key pair.');
    }
    return { values: entry[0].map(textOf), key: entry[1].map(textOf) };
  });
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new Error(`A unique-index check returned a value that is not text: ${JSON.stringify(value)}`);
}

/** A side that read as many rows as it was allowed may have more, so the conflicts found are a lower bound. */
export function uniqueCheckWasTruncated(rows: readonly UniqueValueRow[], limit: number): boolean {
  return rows.length >= limit;
}

export function uniqueValueConflictMessage(conflict: UniqueValueConflict): string {
  return `"${conflict.table}" already holds "${displayValues(conflict.values)}" in ${conflict.index}: the archive row ${displayKey(conflict.stagedKey)} and the live row ${displayKey(conflict.liveKey)} both carry it, and "${conflict.columns.join(', ')}" is unique, so the merge cannot land it without violating that index and rolling the table back.`;
}

// ---------------------------------------------------------------------------
// Overwrite-parent conflicts
// ---------------------------------------------------------------------------

/** A table set to overwrite while an applied child still references it. */
export interface FkOverwriteConflict {
  readonly id: string;
  readonly kind: 'fk-overwrite';
  readonly table: string;
  readonly children: readonly string[];
}

export function fkOverwriteConflictId(table: string): string {
  return `fk:${table}`;
}

/** Byte-for-byte the message `overwriteParentConflicts` has always reported. */
export function fkOverwriteConflictMessage(conflict: FkOverwriteConflict): string {
  return `"${conflict.table}" cannot be overwritten while ${conflict.children.join(', ')} reference it: this schema's foreign keys are not deferrable, so a per-table delete would break them. Skip ${conflict.children.join(', ')} or merge them instead.`;
}

// ---------------------------------------------------------------------------
// The account-username conflict the privilege rules own
// ---------------------------------------------------------------------------

/**
 * An archive username live already holds under a different id.
 *
 * This is a unique-value conflict on `admins.username`, reported from the
 * privilege rows rather than from a `pg_indexes` read because the privilege
 * measurement already has both sides in hand. The generic unique check does not
 * look at this index, so the two never report the same fact twice.
 *
 * One username is one conflict, so a promote with several conflicting usernames
 * raises several prompts. A resolution acts on a single archive row, and
 * reporting them together would offer one choice that had to mean something
 * different for each row in it.
 */
export interface AccountUsernameConflict {
  readonly id: string;
  readonly kind: 'account-username';
  readonly table: string;
  readonly index: string;
  /** The column the uniqueness is on, which is what a regenerate would replace. */
  readonly columns: readonly string[];
  readonly pair: AccountUsernamePair;
}

export interface AccountUsernamePair {
  readonly username: string;
  readonly stagedId: number;
  readonly liveId: number;
}

/** One conflict per archive row, so two usernames under one id cannot collide as one id. */
export function accountUsernameConflictId(table: string, stagedId: number): string {
  return `account:${table}:username:${stagedId}`;
}

/** Byte-for-byte the refusal `accountConflictErrors` has always reported for one username. */
export function accountUsernameConflictMessage(conflict: AccountUsernameConflict): string {
  const { username, stagedId, liveId } = conflict.pair;
  return `"${conflict.table}" cannot be applied: "${username}" (archive id ${stagedId}, live id ${liveId}) exists in the archive and live under different ids, and "username" is unique, so the merge would violate it and roll the whole table back. Rename or remove one side of each pair, then validate again.`;
}

// ---------------------------------------------------------------------------
// The conflict the operator is prompted about
// ---------------------------------------------------------------------------

export type RestoreConflict = FkOverwriteConflict | UniqueValueConflict | AccountUsernameConflict;

export function conflictMessage(conflict: RestoreConflict): string {
  if (conflict.kind === 'fk-overwrite') return fkOverwriteConflictMessage(conflict);
  if (conflict.kind === 'account-username') return accountUsernameConflictMessage(conflict);
  return uniqueValueConflictMessage(conflict);
}

// ---------------------------------------------------------------------------
// Regenerating a value the operator wants to keep
// ---------------------------------------------------------------------------

/**
 * A replacement value for a conflicting column, or null when there is no rule
 * for it.
 *
 * A uuid is replaced by a fresh one, and a username by a suffixed variant of the
 * one the archive row already carries — `ada` becomes `ada-restored`, which is
 * readable in a report where an opaque id would not be. Anything else returns
 * null, because guessing a shape for a column this does not understand would put
 * a value in the archive that nobody chose.
 *
 * The uuid source is injected so a caller can make the value reproducible; a
 * component passes the platform's generator.
 */
export function regenerateSuggestion(column: string, current: string, makeUuid: () => string): string | null {
  if (column === 'uuid' || column.endsWith('_uuid')) return makeUuid();
  if (column === 'username') return `${current}-restored`;
  return null;
}

// ---------------------------------------------------------------------------
// The cascade a key rename has to reach
// ---------------------------------------------------------------------------

/** One foreign-key edge in the scratch copy: which child columns point at which parent columns. */
export interface FkEdge {
  readonly constraint: string;
  readonly childTable: string;
  readonly childColumns: readonly string[];
  readonly parentTable: string;
  readonly parentColumns: readonly string[];
}

/** One foreign-key column pair, as the catalog query returns it. */
export interface FkEdgeRow {
  readonly constraint: string;
  readonly childTable: string;
  readonly childColumn: string;
  readonly parentTable: string;
  readonly parentColumn: string;
}

/**
 * Groups the catalog's one-row-per-column answer back into edges, keeping the
 * column order the constraint declared. Order is what pairs a composite child
 * column with its parent column, so the rows are grouped by constraint and read
 * in the order the query returned them.
 */
export function parseFkEdges(rows: readonly FkEdgeRow[]): readonly FkEdge[] {
  const grouped = new Map<string, { edge: Omit<FkEdge, 'childColumns' | 'parentColumns'>; child: string[]; parent: string[] }>();
  for (const row of rows) {
    const key = `${row.childTable}::${row.constraint}`;
    const entry = grouped.get(key) ?? {
      edge: { constraint: row.constraint, childTable: row.childTable, parentTable: row.parentTable },
      child: [],
      parent: [],
    };
    entry.child.push(row.childColumn);
    entry.parent.push(row.parentColumn);
    grouped.set(key, entry);
  }
  return [...grouped.values()].map((entry) => ({ ...entry.edge, childColumns: entry.child, parentColumns: entry.parent }));
}

/** One key rewritten from one value set to another. */
export interface KeyRenameStep {
  readonly table: string;
  readonly columns: readonly string[];
  readonly fromValues: readonly string[];
  readonly toValues: readonly string[];
}

/**
 * How far a rename may be followed before it is refused. A cycle is already
 * broken by remembering what has been rewritten, so this bounds a chain that is
 * merely very long — past which refusing is safer than rewriting something the
 * operator did not see listed.
 */
export const MAX_CASCADE_DEPTH = 16;

/** The positions of `step`'s columns inside an edge's parent columns, paired with the child column that follows each. */
function followingColumns(edge: FkEdge, step: KeyRenameStep): readonly { readonly childColumn: string; readonly position: number }[] {
  if (edge.parentTable !== step.table) return [];
  return edge.parentColumns
    .map((parentColumn, index) => ({ childColumn: edge.childColumns[index] ?? '', position: step.columns.indexOf(parentColumn) }))
    .filter((entry) => entry.position >= 0 && entry.childColumn.length > 0);
}

/**
 * The rename and every rewrite it cascades into, breadth-first from the archive
 * row's key toward the rows that point at it.
 *
 * An edge is followed when it references *any* of the rewritten columns, and only
 * the matching child columns are rewritten. Requiring the whole parent column
 * list to match would miss a child that references a composite key when only one
 * column of that key changed, which is the common case: `evaluations` points at
 * `submission_results` by both key columns, while a rename of the archive row's
 * `submission_id` touches one of them.
 *
 * That a referencing column can itself be part of the child's own key is why one
 * pass is not enough — the rows pointing at the child's new key have to follow
 * too. Only tables being applied are followed, because a skipped table's scratch
 * rows are never merged and so cannot dangle, and a (table, columns) pair already
 * rewritten is never rewritten twice, which is what terminates a reference cycle.
 */
export function planKeyRenameCascade(
  edges: readonly FkEdge[],
  appliedTables: readonly string[],
  start: KeyRenameStep,
): readonly KeyRenameStep[] {
  const steps: KeyRenameStep[] = [start];
  const rewritten = new Set([`${start.table}:${start.columns.join(',')}`]);
  let frontier: readonly KeyRenameStep[] = [start];
  for (let depth = 1; depth < MAX_CASCADE_DEPTH && frontier.length > 0; depth += 1) {
    const next: KeyRenameStep[] = [];
    for (const step of frontier) {
      for (const edge of edges) {
        const following = followingColumns(edge, step);
        if (following.length === 0 || !appliedTables.includes(edge.childTable)) continue;
        const columns = following.map((entry) => entry.childColumn);
        const key = `${edge.childTable}:${columns.join(',')}`;
        if (rewritten.has(key)) continue;
        rewritten.add(key);
        next.push({
          table: edge.childTable,
          columns,
          fromValues: following.map((entry) => step.fromValues[entry.position] ?? ''),
          toValues: following.map((entry) => step.toValues[entry.position] ?? ''),
        });
      }
    }
    steps.push(...next);
    frontier = next;
  }
  return steps;
}

// ---------------------------------------------------------------------------
// The two-button mode
// ---------------------------------------------------------------------------

/** Apply Append merges every selected table; Apply Replace overwrites every one. */
export type RestoreMode = 'append' | 'replace';

/**
 * The one strategy the confirmation popup resolves the whole selection to. The
 * server contract is untouched: the popup produces the same per-table
 * `ApplyStrategies` record the applier has always consumed, with every table
 * given the same choice.
 */
export function buildRestoreStrategies(tables: readonly string[], mode: RestoreMode): ApplyStrategies {
  const strategy: TableStrategy = mode === 'replace' ? 'overwrite' : 'merge';
  return Object.fromEntries(tables.map((table) => [table, strategy] as const));
}
