#!/usr/bin/env bun
/**
 * The audit log's operator surface: verify it, inspect it, prune it.
 *
 * WHY this exists: the log carries a hash chain (`prev_hash` -> `entry_hash`), but until this file
 * there was nothing an operator could run that recomputed it. A chain nobody verifies is a comment.
 * Every question this file answers is one the durability review could not answer from the schema:
 *
 *   bun admin-panel/scripts/audit-log.ts verify [--json]
 *       Recompute every row's digest and check the links and the id sequence. Exits 0 only when
 *       every check ran and passed: 1 when the log is broken (naming each row), 2 when the
 *       verifier could not evaluate the log at all (no permission, no table, no connection) —
 *       "could not check" is never reported as "valid".
 *
 *   bun admin-panel/scripts/audit-log.ts status [--json]
 *       What retention has actually done: the window, the cutoff, how much is eligible, when it
 *       last ran. This is the answer to "has retention run?" — the service is not a cron entry
 *       anybody remembers, so its silence has to be readable.
 *
 *   bun admin-panel/scripts/audit-log.ts prune [--apply] [--batch N]
 *       Dry run by default. `--apply` calls public.cms_audit_prune(), which is the only path that
 *       deletes: it is gated on the `system:audit-retention` actor, refuses rows inside the window
 *       (the trigger refuses them again), and writes one `audit_log_retention` anchor per batch so
 *       the gap it leaves is provable. Run from the `audit-retention` compose service, never from a
 *       request path.
 */
import {
  verifyAuditChain,
  type AuditAnchorRow,
  type AuditLogRow,
} from '@/lib/audit-chain';
import { SYSTEM_IDENTITIES, withActor, type DbActor } from '@/lib/db-actor';
import { prisma } from '@/lib/prisma';

const USAGE = `usage: audit-log.ts <command> [options]

  verify [--json]              recompute the chain; exit 1 on a break, 2 when it cannot be checked
  status [--json]              window, cutoff, eligible rows, last prune
  prune  [--apply] [--batch N] dry run unless --apply (the only path that deletes)`;

class UsageError extends Error {}

const EXIT_OK = 0;
const EXIT_BROKEN = 1;
const EXIT_CANNOT_EVALUATE = 2;

/** The actors these commands run as: named system identities, never a human's. */
const VERIFY_ACTOR: DbActor = { kind: 'system', name: SYSTEM_IDENTITIES.CLI };
const PRUNE_ACTOR: DbActor = { kind: 'system', name: SYSTEM_IDENTITIES.AUDIT_RETENTION };

interface AnchorRaw {
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

interface TotalsRaw {
  readonly rows: bigint;
  readonly oldest: Date | null;
  readonly newest: Date | null;
  readonly eligible: bigint;
  readonly window_days: number;
  readonly anchors: bigint;
  readonly last_prune_at: Date | null;
}

interface PostureRaw {
  readonly audit_owner: string | null;
  readonly fn_owner: string | null;
  readonly current_role: string;
  readonly triggers: bigint;
}

/**
 * Whether the log is owned by something other than the application role, and whether both guard
 * triggers are enabled. Reported, never assumed: an owner that is the app role can disable the
 * guard, so "append-only by trigger" is only a guarantee once the owner is somebody else.
 */
interface OwnerPosture {
  readonly separated: boolean;
  readonly tableOwner: string | null;
  readonly functionOwner: string | null;
  readonly triggersEnabled: boolean;
}

async function readPosture(): Promise<OwnerPosture | null> {
  // WHY null and not a throw: this is a report about the live database's posture, and a restored
  // copy (a scratch database) legitimately has no guard function to ask about. A missing posture
  // must not turn a chain that verified into "cannot verify" — the chain is the evidence, the
  // posture is context. Callers print "unavailable" rather than inventing a value.
  // Ask whether the guard function exists before asking it anything: a restored forensics copy has
  // the tables but not the functions, and a failed query would print a Prisma error for a database
  // that is behaving exactly as expected.
  const [present] = await prisma.$queryRaw<{ ok: boolean }[]>`
    SELECT to_regprocedure('public.cms_audit_log_guard()') IS NOT NULL AS ok`;
  if (!present?.ok) return null;

  let row: PostureRaw | undefined;
  try {
    [row] = await prisma.$queryRaw<PostureRaw[]>`
    SELECT (SELECT tableowner FROM pg_tables WHERE schemaname='public' AND tablename='audit_log') AS audit_owner,
           (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='public.cms_audit_log_guard()'::regprocedure) AS fn_owner,
           current_user AS current_role,
             (SELECT count(*) FROM pg_trigger
               WHERE tgrelid='public.audit_log'::regclass AND NOT tgisinternal AND tgenabled='O') AS triggers`;
  } catch {
    return null;
  }
  const separated =
    row !== undefined && row.audit_owner !== null && row.audit_owner !== row.current_role;
  return {
    separated,
    tableOwner: row?.audit_owner ?? null,
    functionOwner: row?.fn_owner ?? null,
    triggersEnabled: row !== undefined && Number(row.triggers) >= 2,
  };
}

function flagValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new UsageError(`--${name} needs a value`);
  return value;
}

async function readRows(): Promise<AuditLogRow[]> {
  const rows = await prisma.audit_log.findMany({ orderBy: { id: 'asc' } });
  return rows.map((row) => ({
    id: row.id,
    timestamp: row.timestamp,
    actor_id: row.actor_id,
    verb: row.verb,
    entity: row.entity,
    entity_id: row.entity_id,
    before_values: row.before_values,
    after_values: row.after_values,
    reason: row.reason,
    ip: row.ip,
    session_id: row.session_id,
    result: row.result,
    entry_hash: row.entry_hash,
    prev_hash: row.prev_hash,
  }));
}

async function readAnchors(): Promise<AuditAnchorRow[]> {
  // `cutoff_text` is rendered by the database so the digest matches the one cms_audit_prune()
  // wrote, microseconds included — a JS Date would only carry milliseconds.
  return await prisma.$queryRaw<AnchorRaw[]>`
    SELECT id,
           performed_at,
           window_days,
           to_char(cutoff, 'YYYY-MM-DD"T"HH24:MI:SS.US') AS cutoff_text,
           deleted_count,
           first_deleted_id,
           last_deleted_id,
           last_deleted_hash,
           retained_from_id,
           actor,
           entry_hash,
           prev_hash
      FROM public.audit_log_retention
     ORDER BY id ASC`;
}

async function readTotals(): Promise<TotalsRaw> {
  const [row] = await prisma.$queryRaw<TotalsRaw[]>`
    SELECT (SELECT count(*) FROM public.audit_log) AS rows,
           (SELECT min(timestamp) FROM public.audit_log) AS oldest,
           (SELECT max(timestamp) FROM public.audit_log) AS newest,
           (SELECT count(*) FROM public.audit_log
             WHERE timestamp < public.cms_audit_retention_cutoff()) AS eligible,
           public.cms_audit_retention_days() AS window_days,
           (SELECT count(*) FROM public.audit_log_retention) AS anchors,
           (SELECT max(performed_at) FROM public.audit_log_retention) AS last_prune_at`;
  if (row === undefined) throw new Error('retention totals query returned no row');
  return row;
}

function iso(value: Date | null): string {
  return value === null ? 'never' : value.toISOString();
}

async function commandVerify(args: readonly string[]): Promise<number> {
  const json = args.includes('--json');
  let rows: AuditLogRow[];
  let anchors: AuditAnchorRow[];
  let posture: OwnerPosture | null;
  try {
    ({ rows, anchors, posture } = await withActor(VERIFY_ACTOR, async () => ({
      rows: await readRows(),
      anchors: await readAnchors(),
      posture: await readPosture(),
    })));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (json) {
      console.log(JSON.stringify({ ok: false, evaluated: false, error: detail }, null, 2));
    } else {
      console.error(`CANNOT VERIFY: the audit log could not be read — ${detail}`);
      console.error('An unreadable log is not a valid one. Nothing about this run says the chain holds.');
    }
    return EXIT_CANNOT_EVALUATE;
  }

  const verdict = verifyAuditChain(rows, anchors);
  if (json) {
    console.log(
      JSON.stringify(
        {
          ok: verdict.ok,
          evaluated: true,
          rows: verdict.rowsChecked,
          anchors: verdict.anchorsChecked,
          legacyRows: verdict.legacyRows,
          failures: verdict.failures,
          unexplainedGaps: verdict.unexplainedGaps,
          ownerSeparated: posture?.separated ?? null,
          tableOwner: posture?.tableOwner ?? null,
          functionOwner: posture?.functionOwner ?? null,
          triggersEnabled: posture?.triggersEnabled ?? null,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `rows=${verdict.rowsChecked} anchors=${verdict.anchorsChecked} legacyRecipe=${verdict.legacyRows}`,
    );
    console.log(
      posture === null
        ? 'prevention : not inspectable here (no guard function in this database — a restored copy?)'
        : `prevention : owner=${posture.tableOwner ?? '?'} functions=${posture.functionOwner ?? '?'} triggers=${posture.triggersEnabled ? 'enabled' : 'MISSING'} ownerSeparated=${posture.separated}`,
    );
    if (posture !== null && !posture.separated) {
      console.error(
        'WARN     the audit log is owned by the role that writes it, so that role could DISABLE the guard trigger. ' +
          'Detection is intact; prevention is not. Run scripts/__audit_owner_bootstrap.sh in a maintenance window.',
      );
    }
    if (posture !== null && !posture.triggersEnabled) {
      console.error('WARN     the append-only guard triggers are not both enabled — run the migration.');
    }
    for (const gap of verdict.unexplainedGaps) console.error(`GAP      ${gap}`);
    for (const failure of verdict.failures) console.error(`BROKEN   ${failure}`);
    console.log(verdict.ok ? 'audit chain intact' : 'AUDIT CHAIN BROKEN');
  }
  return verdict.ok ? EXIT_OK : EXIT_BROKEN;
}

async function commandStatus(args: readonly string[]): Promise<number> {
  const json = args.includes('--json');
  let totals: TotalsRaw;
  try {
    totals = await withActor(VERIFY_ACTOR, readTotals);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (json) console.log(JSON.stringify({ ok: false, evaluated: false, error: detail }, null, 2));
    else console.error(`CANNOT READ RETENTION STATE: ${detail}`);
    return EXIT_CANNOT_EVALUATE;
  }

  const eligible = Number(totals.eligible);
  const overdue = eligible > 0;
  if (json) {
    console.log(
      JSON.stringify(
        {
          ok: !overdue,
          evaluated: true,
          windowDays: totals.window_days,
          rows: Number(totals.rows),
          oldest: totals.oldest,
          newest: totals.newest,
          eligible,
          anchors: Number(totals.anchors),
          lastPruneAt: totals.last_prune_at,
          overdue,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`window      : ${totals.window_days} days (public.cms_audit_retention_days())`);
    console.log(`rows        : ${totals.rows}`);
    console.log(`oldest      : ${iso(totals.oldest)}`);
    console.log(`newest      : ${iso(totals.newest)}`);
    console.log(`eligible    : ${eligible} row(s) older than the cutoff`);
    console.log(`last prune  : ${iso(totals.last_prune_at)} (${totals.anchors} anchor(s))`);
    console.log(
      overdue
        ? `RETENTION OVERDUE: ${eligible} row(s) are past the ${totals.window_days}-day window. Run the audit-retention service (make audit-retention).`
        : 'retention current: nothing is older than the window',
    );
    const posture = await withActor(VERIFY_ACTOR, readPosture);
    if (posture === null) {
      console.log('append-only : not inspectable here (no guard function in this database)');
    } else {
      console.log(
        `append-only : triggers=${posture.triggersEnabled ? 'enabled' : 'MISSING'} owner=${posture.tableOwner ?? '?'} ownerSeparated=${posture.separated}`,
      );
      if (!posture.separated) {
        console.log('              (owner is the app role: run scripts/__audit_owner_bootstrap.sh)');
      }
    }
  }
  return overdue ? EXIT_BROKEN : EXIT_OK;
}

interface PruneRaw {
  readonly deleted: bigint;
  readonly anchor_id: bigint;
  readonly cutoff: Date;
  readonly retained_from: bigint | null;
}

async function commandPrune(args: readonly string[]): Promise<number> {
  const apply = args.includes('--apply');
  const batch = Number.parseInt(flagValue(args, 'batch') ?? '5000', 10);
  if (!Number.isInteger(batch) || batch < 1 || batch > 100_000) {
    throw new UsageError('--batch must be an integer between 1 and 100000');
  }

  return await withActor(PRUNE_ACTOR, async () => {
    const totals = await readTotals();
    if (Number(totals.eligible) === 0) {
      console.log('retention current: nothing older than the cutoff — no anchor written');
      return EXIT_OK;
    }
    if (!apply) {
      console.log(
        `DRY RUN: ${totals.eligible} row(s) older than ${totals.window_days} days would be pruned in batches of ${batch}.`,
      );
      console.log('Re-run with --apply (the audit-retention service does). Nothing was deleted.');
      return EXIT_OK;
    }

    let total = 0;
    for (;;) {
      const result = await prisma.$queryRaw<PruneRaw[]>`
        SELECT deleted, anchor_id, cutoff, retained_from FROM public.cms_audit_prune(${batch}::integer)`;
      const row = result[0];
      if (row === undefined || row.deleted === BigInt(0)) break;
      total += Number(row.deleted);
      console.log(
        `pruned ${row.deleted} row(s) older than ${row.cutoff.toISOString()} — anchor ${row.anchor_id}, retained from id ${row.retained_from ?? 'none'}`,
      );
      if (Number(row.deleted) < batch) break;
    }
    console.log(`prune complete: ${total} row(s) removed, ${total > 0 ? 'anchored' : 'nothing to anchor'}`);
    return EXIT_OK;
  });
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'verify':
      return await commandVerify(rest);
    case 'status':
      return await commandStatus(rest);
    case 'prune':
      return await commandPrune(rest);
    case undefined:
    case '--help':
    case '-h':
      console.log(USAGE);
      return command === undefined ? EXIT_CANNOT_EVALUATE : EXIT_OK;
    default:
      console.error(`unknown command ${JSON.stringify(command)}\n\n${USAGE}`);
      return EXIT_CANNOT_EVALUATE;
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`${error.message}\n\n${USAGE}`);
    process.exitCode = EXIT_CANNOT_EVALUATE;
  } else {
    // A crash is "could not evaluate", never a pass.
    console.error(`audit-log: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    process.exitCode = EXIT_CANNOT_EVALUATE;
  }
} finally {
  await prisma.$disconnect();
}
