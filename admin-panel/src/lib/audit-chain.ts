import { createHash } from 'node:crypto';

/**
 * The audit log's hash chain, in one place.
 *
 * WHY this module exists: `audit.ts` computed a row's hash from the *caller's entry object*, so a
 * row could not be re-derived from the database — the entry omitted whatever the writer resolved
 * from context (`ip`, `session_id`, `actor_id`), and nothing in the log said which fields the hash
 * had actually covered. A verifier written against the rows could therefore disagree with the
 * writer for reasons that were not tampering, which is the same as having no verifier.
 *
 * WHAT changed: the writer now hashes the *row payload* it is about to insert, over a fixed field
 * set, and this module is the only implementation of both the canonical form and the digest. The
 * verifier imports it, so there is no second recipe to drift.
 *
 * WHY legacy rows are still verifiable: rows written before the change committed to the entry
 * object. {@link verifyRowHash} recognises that recipe too and reports it separately — it is
 * weaker (it never covered `ip`/`session_id` when they were resolved from the request), and saying
 * so per row is more honest than either failing the whole log or pretending the coverage is equal.
 */

/** SHA-256 over `previousHash|canonicalPayload`. One recipe, used by the writer and the verifier. */
export function computeEntryHash(previousHash: string | null, canonicalPayload: string): string {
  return createHash('sha256').update(`${previousHash ?? ''}|${canonicalPayload}`).digest('hex');
}

/**
 * Deterministic JSON: object keys sorted, `undefined` members dropped.
 *
 * WHY hand-rolled: two writers hashing the same data must produce the same bytes, and
 * `JSON.stringify` preserves insertion order. This is also what the legacy entry hashes used, so it
 * stays byte-compatible with rows already in the log.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const nested = record[key];
    if (nested === undefined) {
      continue;
    }
    parts.push(`${JSON.stringify(key)}:${stableStringify(nested)}`);
  }
  return `{${parts.join(',')}}`;
}

/** The columns a row's hash commits to. Both recipes cover exactly these; `id`/`timestamp` are
 * database-assigned and never rewritten by a legitimate writer, and the id sequence is checked
 * separately by {@link verifyAuditChain}. */
export interface AuditRowPayload {
  readonly actor_id: number | null;
  readonly after_values: unknown;
  readonly before_values: unknown;
  readonly entity: string;
  readonly entity_id: string | null;
  readonly ip: string | null;
  readonly reason: string | null;
  readonly result: string;
  readonly session_id: string | null;
  readonly verb: string;
}

/** A log row as the verifier reads it. */
export interface AuditLogRow extends AuditRowPayload {
  readonly id: bigint;
  readonly timestamp: Date;
  readonly entry_hash: string | null;
  readonly prev_hash: string | null;
}

/** A prune anchor as the verifier reads it; `cutoff_text` is the SQL `to_char` rendering so the
 * digest matches the one `cms_audit_prune()` wrote, microseconds included. */
export interface AuditAnchorRow {
  readonly id: bigint;
  readonly performed_at: Date;
  readonly window_days: number;
  readonly cutoff_text: string;
  readonly deleted_count: number;
  readonly first_deleted_id: bigint | null;
  readonly last_deleted_id: bigint | null;
  readonly last_deleted_hash: string | null;
  readonly retained_from_id: bigint | null;
  readonly actor: string;
  readonly entry_hash: string | null;
  readonly prev_hash: string | null;
}

/** Canonical form of a log row's payload (the current recipe). */
export function canonicaliseAuditRow(row: AuditRowPayload): string {
  return stableStringify({
    actor_id: row.actor_id,
    after_values: row.after_values,
    before_values: row.before_values,
    entity: row.entity,
    entity_id: row.entity_id,
    ip: row.ip,
    reason: row.reason,
    result: row.result,
    session_id: row.session_id,
    verb: row.verb,
  });
}

/**
 * The pre-2026-10-26 recipe: the hash covered the caller's `AuditEntry`, whose optional members
 * were present only when the caller supplied them. Reconstructing "which ones" is a search over the
 * seven optional members, which is bounded (128) and exact — every candidate is built from the
 * row's own values, so a candidate can only match if the row is what was hashed.
 */
const LEGACY_OPTIONAL_FIELDS = [
  'entityId',
  'beforeValues',
  'afterValues',
  'reason',
  'actorId',
  'ip',
  'sessionId',
] as const;

function legacyEntryObject(row: AuditRowPayload): Record<string, unknown> {
  return {
    entityId: row.entity_id ?? undefined,
    beforeValues: row.before_values ?? undefined,
    afterValues: row.after_values ?? undefined,
    reason: row.reason ?? undefined,
    actorId: row.actor_id ?? undefined,
    ip: row.ip ?? undefined,
    sessionId: row.session_id ?? undefined,
  };
}

/** Every payload the legacy recipe could have produced for this row (always includes the empty set). */
export function legacyPayloadCandidates(row: AuditRowPayload): string[] {
  const source = legacyEntryObject(row);
  const payloads: string[] = [];
  for (let mask = 0; mask < 1 << LEGACY_OPTIONAL_FIELDS.length; mask += 1) {
    const entry: Record<string, unknown> = {
      verb: row.verb,
      entity: row.entity,
      result: row.result,
    };
    LEGACY_OPTIONAL_FIELDS.forEach((field, index) => {
      if ((mask & (1 << index)) !== 0) {
        const value = source[field];
        if (value !== undefined) entry[field] = value;
      }
    });
    payloads.push(stableStringify(entry));
  }
  return payloads;
}

export type HashRecipe = 'row' | 'legacy-entry' | 'none';

export interface RowHashVerdict {
  readonly recipe: HashRecipe;
  readonly computed: string | null;
}

/** Which recipe, if either, reproduces the row's stored `entry_hash`. */
export function verifyRowHash(row: AuditLogRow): RowHashVerdict {
  if (row.entry_hash === null || row.entry_hash === '') {
    return { recipe: 'none', computed: null };
  }
  const current = computeEntryHash(row.prev_hash, canonicaliseAuditRow(row));
  if (current === row.entry_hash) {
    return { recipe: 'row', computed: current };
  }
  for (const payload of legacyPayloadCandidates(row)) {
    const legacy = computeEntryHash(row.prev_hash, payload);
    if (legacy === row.entry_hash) {
      return { recipe: 'legacy-entry', computed: legacy };
    }
  }
  return { recipe: 'none', computed: current };
}

/**
 * Canonical line for a prune anchor. MUST stay byte-identical to the concatenation in
 * `public.cms_audit_prune()` (20261026120100_audit_log_durable): the database writes the digest,
 * this recomputes it, and a difference in either direction would read as tampering.
 */
export function canonicaliseAnchor(anchor: AuditAnchorRow): string {
  return [
    String(anchor.window_days),
    anchor.cutoff_text,
    String(anchor.deleted_count),
    anchor.first_deleted_id === null ? '' : String(anchor.first_deleted_id),
    anchor.last_deleted_id === null ? '' : String(anchor.last_deleted_id),
    anchor.last_deleted_hash ?? '',
    anchor.retained_from_id === null ? '' : String(anchor.retained_from_id),
    anchor.actor,
  ].join('|');
}

export interface AuditChainVerdict {
  /** True only when every check ran and every one passed. */
  readonly ok: boolean;
  readonly rowsChecked: number;
  readonly anchorsChecked: number;
  /** Rows that verified under the weaker pre-2026-10-26 recipe. */
  readonly legacyRows: number;
  /** One line per violation, naming the row id and what was wrong. */
  readonly failures: string[];
  /** Gaps in the id sequence that no anchor accounts for. */
  readonly unexplainedGaps: string[];
}

const EMPTY_VERDICT: AuditChainVerdict = {
  ok: false,
  rowsChecked: 0,
  anchorsChecked: 0,
  legacyRows: 0,
  failures: [],
  unexplainedGaps: [],
};

/**
 * Verify anchors, then the log: `prev_hash` links, the recomputed digest of every row, and the id
 * sequence (a hole is a failure unless an anchor says retention made it).
 *
 * Never returns ok for an input it could not fully judge: an empty result set is not "valid", it is
 * "nothing was checked", and the caller is told so by `rowsChecked`.
 */
export function verifyAuditChain(
  rows: readonly AuditLogRow[],
  anchors: readonly AuditAnchorRow[],
): AuditChainVerdict {
  const failures: string[] = [];
  const unexplainedGaps: string[] = [];
  let legacyRows = 0;

  const sortedAnchors = [...anchors].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let previousAnchorHash: string | null = null;
  for (const anchor of sortedAnchors) {
    if (anchor.prev_hash !== previousAnchorHash) {
      failures.push(
        `anchor ${anchor.id}: prev_hash ${anchor.prev_hash ?? 'null'} does not link to the previous anchor (${previousAnchorHash ?? 'null'})`,
      );
    }
    const computed = computeEntryHash(anchor.prev_hash, canonicaliseAnchor(anchor));
    if (computed !== anchor.entry_hash) {
      failures.push(`anchor ${anchor.id}: entry_hash does not match its own fields (recomputed ${computed})`);
    }
    previousAnchorHash = anchor.entry_hash;
  }

  const sortedRows = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (let index = 0; index < sortedRows.length; index += 1) {
    const row = sortedRows[index]!;
    const previous = index === 0 ? null : sortedRows[index - 1]!;

    if (previous === null) {
      // The first surviving row either starts the chain or is the boundary a prune cut at.
      const boundary = sortedAnchors.find(
        (anchor) => anchor.retained_from_id === row.id && anchor.last_deleted_hash === row.prev_hash,
      );
      if (row.prev_hash !== null && boundary === undefined) {
        failures.push(
          `row ${row.id}: prev_hash ${row.prev_hash ?? 'null'} names no row in the log and no retention anchor explains the boundary`,
        );
      }
    } else if (row.prev_hash !== previous.entry_hash) {
      const anchor = sortedAnchors.find(
        (candidate) =>
          candidate.retained_from_id === row.id && candidate.last_deleted_hash === row.prev_hash,
      );
      const gap = row.id !== previous.id + BigInt(1);
      if (anchor === undefined) {
        const detail = `row ${row.id}: prev_hash ${row.prev_hash ?? 'null'} does not link to row ${previous.id} (${previous.entry_hash ?? 'null'})`;
        if (gap) {
          unexplainedGaps.push(
            `rows ${previous.id}..${row.id}: ${row.id - previous.id - BigInt(1)} id(s) missing and no retention anchor accounts for them`,
          );
        }
        failures.push(detail);
      }
    } else if (row.id !== previous.id + BigInt(1)) {
      // Linked, but ids jumped: only a prune can do that, and a prune writes an anchor.
      const anchor = sortedAnchors.find(
        (candidate) =>
          candidate.retained_from_id === row.id && candidate.last_deleted_id === row.id - BigInt(1),
      );
      if (anchor === undefined) {
        unexplainedGaps.push(
          `rows ${previous.id}..${row.id}: ${row.id - previous.id - BigInt(1)} id(s) missing and no retention anchor accounts for them`,
        );
      }
    }

    const verdict = verifyRowHash(row);
    if (verdict.recipe === 'none') {
      failures.push(
        `row ${row.id}: entry_hash ${row.entry_hash ?? 'null'} matches neither the current recipe (${verdict.computed}) nor the pre-2026-10-26 entry recipe — the row was altered or written by something else`,
      );
    } else if (verdict.recipe === 'legacy-entry') {
      legacyRows += 1;
    }
  }

  return {
    ...EMPTY_VERDICT,
    ok: failures.length === 0 && unexplainedGaps.length === 0,
    rowsChecked: sortedRows.length,
    anchorsChecked: sortedAnchors.length,
    legacyRows,
    failures,
    unexplainedGaps,
  };
}
