// The bulk waiver: one auditor-approved decision per CVE the hosts provably cannot reach.
import { recordAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { moduleStateMap } from '@/lib/security/host-module-state';
import {
  parseKernelSubsystem,
  isReachability,
  SUBSYSTEM_MODULES,
  type Reachability,
} from '@/lib/security/kernel-reachability';
import { waiverCovers } from '@/lib/security/patching';
import { readBulkWaiveFeed, type BulkWaiveCandidate, type BulkWaiveWaiver } from '@/lib/security/patching-read';
import { createWaiver, parseReviewDate } from './patching-waivers';

/**
 * WHY this module and not the server action: the plan, the refusals and the writes are the same
 * decision whether an operator triggers them or a CLI does with the `root` actor, exactly like the
 * single waiver beside it. The action adds the permission check, the actor and the refresh.
 *
 * WHY the source is pinned to rootfs: kernel CVEs arrive from the host scan, and the classifier only
 * ever judges a `kernel: <subsystem>: …` title. A diun or osv row is stored `unknown` by definition,
 * so counting them here would turn every image row into a refusal and drown the answer.
 *
 * WHY a CVE is the unit: a Trivy key is `CVE-…|package`, and Ubuntu ships the same CVE for five
 * kernel packages. One waiver per finding would be 2,395 rows nobody reviews; one per CVE is 479.
 */

/** The producer whose rows this action judges. */
const WAIVED_SOURCE = 'rootfs';

/** The refusal vocabulary, in the order the counts are reported. */
const RANK: Record<Reachability, number> = { unreachable: 0, unknown: 1, reachable: 2 };

export interface BulkWaiveInput {
  /** ISO date or date-only; must be after now, exactly as the single waiver requires. */
  readonly reviewBy: string;
  /** The plan only: true writes nothing and still reports what would be refused. */
  readonly dryRun?: boolean;
  /** The waiver count the operator confirmed; a different plan is refused instead of written. */
  readonly expectedWaivers?: number;
}

/** One waiver the plan holds, or would hold: the CVE it covers and the rows it covers with it. */
export interface BulkWaivePlanEntry {
  readonly match: string;
  readonly reason: string;
  readonly findings: readonly string[];
}

/**
 * A row that is not waived.
 *
 * WHY two verdicts: `verdict` is why the row is refused (the whole CVE is blocked when any sibling is
 * reachable or unknown, because one waiver would cover that sibling too), and `own` is what the
 * ingest stored for this row — a row can be `unreachable` itself and still be refused with its CVE.
 */
export interface BulkWaiveRefusal {
  readonly key: string;
  readonly cve: string;
  readonly host: string | null;
  readonly verdict: 'reachable' | 'unknown';
  readonly own: Reachability;
}

/** The numbers the confirmation states, in the units the operator counts in. */
export interface BulkWaiveCounts {
  /** Unresolved rootfs rows examined. */
  readonly candidates: number;
  /** Unresolved rootfs rows already under a live waiver; their CVE is left alone. */
  readonly alreadyWaived: number;
  /** Rows refused because their CVE is reachable on some host. */
  readonly refusedReachable: number;
  /** Rows refused because their CVE could not be judged. */
  readonly refusedUnknown: number;
  /** Findings the plan's waivers cover. */
  readonly findingsWaived: number;
  /** Waiver rows the plan holds. */
  readonly planned: number;
  /** Waiver rows written by this call: zero on a dry run, which is what "dry" means. */
  readonly waived: number;
}

export interface BulkWaiveResult {
  readonly success: boolean;
  readonly error?: string;
  readonly dryRun: boolean;
  /** The review date as stored, or the unparsable input when it was refused. */
  readonly reviewBy: string;
  readonly counts: BulkWaiveCounts;
  readonly plan: readonly BulkWaivePlanEntry[];
  readonly refusals: readonly BulkWaiveRefusal[];
  readonly waiverIds: readonly number[];
  /** CVEs createWaiver refused: reported, never swallowed, so a partial run reads as partial. */
  readonly failures: readonly string[];
}

interface CveGroup {
  readonly cve: string;
  readonly rows: readonly BulkWaiveCandidate[];
  /** The worst verdict among the group: one reachable sibling blocks the whole CVE. */
  readonly verdict: Reachability;
}

/** One host's recorded module state, as the scanner pushed it. */
interface HostRow {
  readonly host: string;
  readonly kernel_release: string;
  readonly loaded: readonly string[];
  readonly blocked: readonly string[];
}

interface Draft {
  readonly entries: readonly BulkWaivePlanEntry[];
  readonly refusals: readonly BulkWaiveRefusal[];
  readonly counts: BulkWaiveCounts;
}

/** What a write left behind; a dry run leaves nothing, which is a value here rather than a branch. */
interface Written {
  readonly ids: readonly number[];
  readonly failures: readonly string[];
}

const NO_WRITES: Written = { ids: [], failures: [] };

const PLAN_CHANGED = 'the plan changed since it was previewed; preview it again before writing';

/** The result shape every path returns, so a refusal and a success describe the same plan alike. */
function resultOf(dryRun: boolean, reviewBy: string, draft: Draft, written: Written): BulkWaiveResult {
  return {
    success: true,
    dryRun,
    reviewBy,
    plan: draft.entries,
    refusals: draft.refusals,
    waiverIds: written.ids,
    failures: written.failures,
    counts: { ...draft.counts, waived: written.ids.length },
  };
}

/** The refusal shape for a failed call, so every early return has the same fields. */
export function refusedBulkWaive(error: string, dryRun: boolean, reviewBy = ''): BulkWaiveResult {
  return {
    success: false,
    error,
    dryRun,
    reviewBy,
    counts: { candidates: 0, alreadyWaived: 0, refusedReachable: 0, refusedUnknown: 0, findingsWaived: 0, planned: 0, waived: 0 },
    plan: [],
    refusals: [],
    waiverIds: [],
    failures: [],
  };
}

/** The CVE part of a producer key: `CVE-2026-1|linux-image-…` → `CVE-2026-1`. */
function cveOf(key: string): string {
  const head = key.split('|')[0]?.trim() ?? '';
  return head === '' ? key.trim() : head;
}

/** A stored value outside the three verdicts is unjudged, exactly as the read path treats it. */
function verdictOf(stored: string): Reachability {
  return isReachability(stored) ? stored : 'unknown';
}

function higher(a: Reachability, b: Reachability): Reachability {
  return RANK[b] > RANK[a] ? b : a;
}

/** The module state each involved host reported, keyed by host; a host with no row stays missing. */
async function readHostFacts(rows: readonly BulkWaiveCandidate[]): Promise<ReadonlyMap<string, HostRow>> {
  const hosts = [...new Set(rows.flatMap((row) => (row.host === null ? [] : [row.host])))];
  if (hosts.length === 0) return new Map();
  const facts = await prisma.security_host_modules.findMany({ where: { host: { in: hosts } } });
  return new Map(facts.map((row) => [row.host, row]));
}

/**
 * The groups to judge, each with its worst verdict, and the rows a live waiver already covers.
 *
 * WHY a covered row stays inside its group: the verdict has to be the worst over EVERY row carrying
 * the CVE, including one that is already waived and reachable on another host — a new waiver for that
 * CVE would cover it again. Only the rows this run would write for are filtered out later.
 */
function collectGroups(
  rows: readonly BulkWaiveCandidate[],
  waivers: readonly BulkWaiveWaiver[],
): { readonly groups: readonly CveGroup[]; readonly covered: ReadonlySet<number> } {
  const byCve = new Map<string, BulkWaiveCandidate[]>();
  const covered = new Set<number>();
  for (const row of rows) {
    if (waivers.some((waiver) => waiverCovers(waiver, { source: WAIVED_SOURCE, key: row.key, title: row.title }))) {
      covered.add(row.id);
    }
    const cve = cveOf(row.key);
    byCve.set(cve, [...(byCve.get(cve) ?? []), row]);
  }
  const groups = [...byCve.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cve, members]) => ({
      cve,
      rows: members,
      verdict: members.reduce<Reachability>((worst, row) => higher(worst, verdictOf(row.reachability)), 'unreachable'),
    }));
  return { groups, covered };
}

/** The module states the classifier read for one row, named with their verdicts. */
function describeRow(row: BulkWaiveCandidate, facts: ReadonlyMap<string, HostRow>): string {
  const subsystem = parseKernelSubsystem(row.title ?? '');
  const where = row.host ?? 'an unrecorded host';
  if (subsystem === null) return `an unparsed kernel title on ${where}`;
  const rule = SUBSYSTEM_MODULES[subsystem.toLowerCase()];
  if (rule === undefined) return `kernel subsystem ${subsystem}, which has no module mapping, on ${where}`;
  const host = row.host === null ? undefined : facts.get(row.host);
  if (host === undefined) return `kernel subsystem ${subsystem} not running on ${where}`;
  const states = moduleStateMap(rule.modules, host);
  const named = rule.modules.map((name) => `${name}=${states[name] ?? 'absent'}`).join(', ');
  return `kernel subsystem ${subsystem} on ${row.host} (kernel ${host.kernel_release}): ${named}`;
}

/** The stored reason: the subsystem, the module state that made it unreachable, and the review date. */
function groupReason(cve: string, described: readonly string[], reviewBy: string): string {
  return [
    `Waived in bulk for ${cve}.`,
    `${[...new Set(described)].join('; ')}.`,
    'No loaded or built-in module reaches this code path, so the finding has no surface on these hosts.',
    `Review by ${reviewBy}.`,
  ].join(' ');
}

/** Splits the groups into the waivers to write and the rows refused, with the rows left alone. */
function planGroups(
  groups: readonly CveGroup[],
  facts: ReadonlyMap<string, HostRow>,
  reviewBy: string,
  covered: ReadonlySet<number>,
): { readonly entries: readonly BulkWaivePlanEntry[]; readonly refusals: readonly BulkWaiveRefusal[] } {
  const entries: BulkWaivePlanEntry[] = [];
  const refusals: BulkWaiveRefusal[] = [];
  for (const group of groups) {
    // A covered row needs no second decision; only the rows this run would write for are counted.
    const pending = group.rows.filter((row) => !covered.has(row.id));
    if (pending.length === 0) continue;
    if (group.verdict !== 'unreachable') {
      for (const row of pending) {
        refusals.push({ key: row.key, cve: group.cve, host: row.host, verdict: group.verdict, own: verdictOf(row.reachability) });
      }
      continue;
    }
    entries.push({
      match: group.cve,
      reason: groupReason(group.cve, pending.map((row) => describeRow(row, facts)), reviewBy),
      findings: pending.map((row) => row.key),
    });
  }
  return { entries, refusals };
}

/** The plan and the arithmetic over it; `waived` stays zero until something was written. */
function buildDraft(
  rows: readonly BulkWaiveCandidate[],
  waivers: readonly BulkWaiveWaiver[],
  facts: ReadonlyMap<string, HostRow>,
  reviewBy: string,
): Draft {
  const { groups, covered } = collectGroups(rows, waivers);
  const { entries, refusals } = planGroups(groups, facts, reviewBy, covered);
  return {
    entries,
    refusals,
    counts: {
      candidates: rows.length,
      alreadyWaived: covered.size,
      refusedReachable: refusals.filter((refusal) => refusal.verdict === 'reachable').length,
      refusedUnknown: refusals.filter((refusal) => refusal.verdict === 'unknown').length,
      findingsWaived: entries.reduce((total, entry) => total + entry.findings.length, 0),
      planned: entries.length,
      waived: 0,
    },
  };
}

/** Writes the plan one waiver at a time, so every row carries its own audit entry. */
async function writePlan(
  actorId: number,
  entries: readonly BulkWaivePlanEntry[],
  reviewBy: string,
  now: Date,
): Promise<Written> {
  const ids: number[] = [];
  const failures: string[] = [];
  for (const entry of entries) {
    const result = await createWaiver(actorId, { source: WAIVED_SOURCE, match: entry.match, reason: entry.reason, reviewBy }, now);
    if (result.success && result.id !== undefined) ids.push(result.id);
    else failures.push(`${entry.match}: ${result.error ?? 'the waiver was not recorded'}`);
  }
  return { ids, failures };
}

/**
 * Plans — and unless `dryRun`, records — one waiver per unreachable CVE.
 *
 * WHY the guard runs on the whole group: a waiver matching a CVE covers every finding carrying it,
 * including a reachable one on another host. Waiving a CVE that is reachable anywhere would suppress
 * a live risk, so the worst verdict in the group decides and the refusal is reported per row.
 *
 * WHY `expectedWaivers`: the operator confirms a count they read in the dialog, and a scan landing
 * between the preview and the press would make the button write a different plan than the one it
 * described. A mismatched count refuses the write and returns the fresh plan to preview again.
 */
export async function waiveUnreachableFindings(
  actorId: number,
  input: BulkWaiveInput,
  now: Date = new Date(),
): Promise<BulkWaiveResult> {
  const dryRun = input.dryRun === true;
  const parsed = parseReviewDate(input.reviewBy, now);
  if (parsed === null) return refusedBulkWaive('review_by must be a future date', dryRun, input.reviewBy);
  const reviewBy = parsed.toISOString().slice(0, 10);
  const { rows, waivers } = await readBulkWaiveFeed(WAIVED_SOURCE);
  const facts = await readHostFacts(rows);
  const draft = buildDraft(rows, waivers, facts, reviewBy);
  const stale = input.expectedWaivers !== undefined && input.expectedWaivers !== draft.counts.planned;
  if (!dryRun && stale) {
    return { ...resultOf(true, reviewBy, draft, NO_WRITES), success: false, error: PLAN_CHANGED };
  }
  const written = dryRun ? NO_WRITES : await writePlan(actorId, draft.entries, reviewBy, now);
  if (!dryRun && written.ids.length > 0) {
    await recordAudit({
      actorId,
      verb: 'security.waiver.bulk-create',
      entity: 'security_waiver',
      afterValues: { review_by: reviewBy, waived: written.ids.length },
      reason: `bulk waiver of unreachable kernel CVEs: ${String(written.ids.length)} created, ${String(draft.counts.refusedReachable + draft.counts.refusedUnknown)} refused`,
      result: 'success',
    });
  }
  return resultOf(dryRun, reviewBy, draft, written);
}
