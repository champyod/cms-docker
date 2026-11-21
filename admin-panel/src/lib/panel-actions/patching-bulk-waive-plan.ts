// The bulk waiver's planning half: the rows read from rootfs, grouped by CVE, judged and priced.
import { prisma } from '@/lib/prisma';
import { moduleStateMap } from '@/lib/security/host-module-state';
import {
  parseKernelSubsystem,
  isReachability,
  SUBSYSTEM_MODULES,
  type Reachability,
} from '@/lib/security/kernel-reachability';
import { waiverCovers } from '@/lib/security/patching';
import {
  readBulkWaiveFeed,
  type BulkWaiveCandidate,
  type BulkWaiveWaiver,
} from '@/lib/security/patching-read';

/**
 * WHY the source is pinned to rootfs: kernel CVEs arrive from the host scan, and the classifier only
 * ever judges a `kernel: <subsystem>: …` title. A diun or osv row is stored `unknown` by definition,
 * so counting them here would turn every image row into a refusal and drown the answer.
 *
 * WHY a CVE is the unit: a Trivy key is `CVE-…|package`, and Ubuntu ships the same CVE for five
 * kernel packages. One waiver per finding would be 2,395 rows nobody reviews; one per CVE is 479.
 */
export const WAIVED_SOURCE = 'rootfs';

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

/** A row that is not waived: `verdict` is why the CVE is refused, `own` is what the ingest stored. */
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
  /** False only when the call refused; the plan still describes what it saw. */
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
export interface HostRow {
  readonly host: string;
  readonly kernel_release: string;
  readonly loaded: readonly string[];
  readonly blocked: readonly string[];
}

/** The plan before anything is written: the waivers to hold, the refusals, and the counts over them. */
export interface Draft {
  readonly entries: readonly BulkWaivePlanEntry[];
  readonly refusals: readonly BulkWaiveRefusal[];
  readonly counts: BulkWaiveCounts;
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

/** Reads the pinned source and judges it: the plan, its refusals and its counts, before any write. */
export async function planBulkWaive(reviewBy: string): Promise<Draft> {
  const { rows, waivers } = await readBulkWaiveFeed(WAIVED_SOURCE);
  return buildDraft(rows, waivers, await readHostFacts(rows), reviewBy);
}
