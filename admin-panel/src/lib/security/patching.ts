import type { security_findings, security_waivers } from '@prisma/client';

import type { SortDirection } from '@/lib/list-sorting';

// The security feed's vocabulary, in one place: the ingest boundary validates against
// these constants and the page renders their order, so a new source or severity is one
// edit rather than a second list that drifts. The contract (docs/SECURITY-FEED.md) fixes
// the source enum; extending it is a contract change, not a panel decision.
export const PATCHING_SOURCES = ['diun', 'rootfs', 'osv'] as const;
export type PatchingSource = (typeof PATCHING_SOURCES)[number];

export const PATCHING_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
export type PatchingSeverity = (typeof PATCHING_SEVERITIES)[number];

/**
 * The longest finding key a producer may report, and therefore the longest a waiver's `match` may
 * be.
 *
 * WHY it lives here and not in the ingest module: the waiver gate validates the committed export
 * against the same ceiling, and it must stay free of `@prisma/client` (it runs in a CI job that
 * generates no client), so the one number cannot live in a module that imports Prisma.
 */
export const MAX_FINDING_KEY_LENGTH = 200;

/** Severity order inside a source group: the worst finding reads first. */
const SEVERITY_RANK: Record<PatchingSeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  UNKNOWN: 4,
};

export function isPatchingSource(value: unknown): value is PatchingSource {
  return typeof value === 'string' && (PATCHING_SOURCES as readonly string[]).includes(value);
}

export function isPatchingSeverity(value: unknown): value is PatchingSeverity {
  return typeof value === 'string' && (PATCHING_SEVERITIES as readonly string[]).includes(value);
}

/** `none` until a live waiver covers the finding; `expired` is surfaced, never hidden. */
export type WaiverState =
  | { readonly status: 'none' }
  | { readonly status: 'active'; readonly reviewBy: string }
  | { readonly status: 'expired'; readonly reviewBy: string };

export interface PatchingFinding {
  readonly id: number;
  readonly source: PatchingSource;
  readonly key: string;
  readonly kind: string;
  readonly severity: PatchingSeverity | null;
  readonly subject: string;
  readonly installed: string | null;
  readonly available: string | null;
  readonly title: string | null;
  readonly url: string | null;
  readonly host: string | null;
  readonly firstSeen: string;
  readonly lastSeen: string;
  readonly waiver: WaiverState;
}

export interface PatchingWaiver {
  readonly id: number;
  readonly source: string;
  readonly match: string;
  readonly reason: string;
  readonly reviewBy: string;
  readonly createdAt: string;
  readonly createdBy: number;
  /**
   * The administrator who signed it, resolved at read time.
   *
   * WHY null is possible: the audit trail's actor ids outlive the account, and a waiver whose
   * author was deleted still has to render with its date rather than vanish from the page.
   */
  readonly createdByName: string | null;
  readonly endedAt: string | null;
  readonly expired: boolean;
}

export interface PatchingGroup {
  readonly source: PatchingSource;
  readonly findings: readonly PatchingFinding[];
}

/** The four overview numbers. They are derived here so the page and cards cannot disagree. */
export interface PatchingCards {
  /** Running container images whose registry now serves a different digest. */
  readonly staleImages: number;
  /** Unresolved findings from the two CVE scanners (rootfs + osv). */
  readonly unresolvedCves: number;
  /** Waivers whose review date has passed and which nobody has ended. */
  readonly expiredWaivers: number;
  /** Unresolved host OS packages for which the producer named a fixed version. */
  readonly hostOsUpdates: number;
}

/**
 * What the database can count without handing over a single row.
 *
 * WHY this shape and not a row list: it is exactly `groupBy(source)` plus one count, which is the
 * aggregate a paged feed can afford. `buildPatchingCards` is the only consumer, so the four card
 * numbers keep one implementation. Rows whose source is outside the contract are not in
 * `bySource` — the read path never counts a family it cannot place.
 */
export interface PatchingFindingCounts {
  readonly bySource: Readonly<Record<PatchingSource, number>>;
  /** Unresolved rootfs rows carrying an `available` version. */
  readonly rootfsWithAvailable: number;
}

/** The four card numbers for a feed in which nothing is unresolved and nothing is waived. */
export const EMPTY_PATCHING_COUNTS: PatchingFindingCounts = {
  bySource: { diun: 0, rootfs: 0, osv: 0 },
  rootfsWithAvailable: 0,
};

/**
 * How many findings one page of the table holds.
 *
 * WHY 25 and not 100: the row is six columns of version strings and two dates, and a page has to be
 * readable without scrolling past the source headings it is grouped under. The number is exported
 * so the pager, the SQL `take` and the tests cannot disagree about it.
 */
export const PATCHING_PAGE_SIZE = 25;

/**
 * The columns the table can be ordered by.
 *
 * WHY severity is absent: it is a contract enum, not a column order — `ORDER BY severity` sorts
 * `LOW` before `MEDIUM`, which would make "worst first" visibly wrong, and the rank lives in
 * JavaScript (`groupFindings`). A reader who wants the worst findings asks for them with the
 * severity FILTER, which is an exact query parameter, and the page still presents each source group
 * severity-first. Every key below is a real column, so the ordering is done by the database.
 */
export const PATCHING_SORTS = ['lastSeen', 'firstSeen', 'subject', 'host', 'source'] as const;
export type PatchingSort = (typeof PATCHING_SORTS)[number];

/** 'all' is the absence of a filter, not a missing value: the page renders it as "any". */
export type PatchingSourceFilter = PatchingSource | 'all';
export type PatchingSeverityFilter = PatchingSeverity | 'all';

/** What the findings table is asked for. Every field is echoed into the query string. */
export interface PatchingQuery {
  readonly page: number;
  readonly source: PatchingSourceFilter;
  readonly severity: PatchingSeverityFilter;
  readonly sort: PatchingSort;
  readonly direction: SortDirection;
}

/** What a URL (or a caller) may hand over: unvalidated strings, exactly as `searchParams` gives them. */
export interface PatchingQueryInput {
  readonly page?: string;
  readonly source?: string;
  readonly severity?: string;
  readonly sort?: string;
  readonly dir?: string;
}

export const DEFAULT_PATCHING_QUERY: PatchingQuery = {
  page: 1,
  source: 'all',
  severity: 'all',
  sort: 'lastSeen',
  direction: 'desc',
};

/** Where a page of rows sits in the whole set: the numbers the pager renders. */
export interface PatchingPageInfo {
  readonly query: PatchingQuery;
  readonly pageSize: number;
  /** Rows matching the current filters, from the SQL count — never the length of the page. */
  readonly total: number;
  /** The last page number a reader can be on; at least 1, so an empty table still says "1 of 1". */
  readonly pageCount: number;
}

/** The default direction for a sort column: dates read newest-first, names A–Z. */
/**
 * The direction a field sorts in when the reader has not chosen one.
 *
 * WHY it is exported: the panel resets the direction when the sort FIELD changes. Carrying the old
 * field's direction over is how "sort by subject" ended up as Z→A — the previous field's descending
 * order followed a date column onto a text one. One definition, used by the URL writer and by the
 * control that changes the field.
 */
export function defaultDirection(sort: PatchingSort): SortDirection {
  return sort === 'lastSeen' || sort === 'firstSeen' ? 'desc' : 'asc';
}

function isPatchingSort(value: unknown): value is PatchingSort {
  return typeof value === 'string' && (PATCHING_SORTS as readonly string[]).includes(value);
}

/**
 * A page number from the query string: a positive integer, or 1.
 *
 * WHY fall back instead of throwing: a hand-edited URL is a normal way to reach a list, and a page
 * that 500s on `?page=abc` is worse than one that shows page 1. `+0` is rejected because page
 * numbers start at 1.
 */
function readPageNumber(value: string | undefined): number {
  if (value === undefined) return 1;
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) return 1;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1;
}

/**
 * The query the page will run, from the raw strings the URL carried.
 *
 * WHY the filters fall back to 'all': an unknown source or severity is a stale bookmark or a typo,
 * and silently narrowing the table to nothing is how an operator concludes there are no findings.
 * An unknown filter shows everything, which is the honest answer to "I did not ask for a filter".
 */
export function readPatchingQuery(input: PatchingQueryInput = {}): PatchingQuery {
  const source = isPatchingSource(input.source) ? input.source : 'all';
  const severity = isPatchingSeverity(input.severity) ? input.severity : 'all';
  const sort = isPatchingSort(input.sort) ? input.sort : DEFAULT_PATCHING_QUERY.sort;
  const direction: SortDirection =
    input.dir === 'asc' || input.dir === 'desc' ? input.dir : defaultDirection(sort);
  return { page: readPageNumber(input.page), source, severity, sort, direction };
}

/** How many pages the current filter needs; an empty set still has one page to stand on. */
export function patchingPageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PATCHING_PAGE_SIZE));
}

/**
 * A page clamped into the set that exists.
 *
 * WHY clamp instead of render an empty table: `?page=999` on a feed that shrank shows nothing, and
 * an empty table is indistinguishable from "nothing is wrong" — the one thing this page must never
 * say by accident. A page past the end lands on the last page, where the rows are.
 */
export function clampPatchingPage(page: number, total: number): number {
  return Math.min(page, patchingPageCount(total));
}

/**
 * The query as URL parameters, with everything that is already the default left out.
 *
 * WHY the default is omitted: a shared link should say what the reader chose ("source=rootfs"), not
 * echo the whole default set, and the round trip is asserted by a test —
 * `readPatchingQuery(patchingSearchParams(query))` has to give the same query back.
 */
export function patchingSearchParams(query: PatchingQuery): Record<string, string> {
  const params: Record<string, string> = {};
  if (query.source !== DEFAULT_PATCHING_QUERY.source) params.source = query.source;
  if (query.severity !== DEFAULT_PATCHING_QUERY.severity) params.severity = query.severity;
  if (query.sort !== DEFAULT_PATCHING_QUERY.sort) params.sort = query.sort;
  if (query.direction !== defaultDirection(query.sort)) params.dir = query.direction;
  if (query.page > 1) params.page = String(query.page);
  return params;
}

export interface PatchingState {
  readonly groups: readonly PatchingGroup[];
  readonly waivers: readonly PatchingWaiver[];
  readonly cards: PatchingCards;
}

/**
 * The page's view of the feed: one page of rows plus the numbers that describe the whole set.
 *
 * WHY `groups` here means "the groups this page covers": the table is paged in SQL, so the page
 * cannot hold every finding. The card numbers are still the whole feed's, because they come from an
 * aggregate — which is why they travel beside the groups rather than being counted from them.
 */
export interface PatchingListState extends PatchingState {
  readonly page: PatchingPageInfo;
}

/**
 * Whether a waiver covers a finding.
 *
 * WHY the CVE containment check: the contract lets a waiver name the finding key *or* a CVE
 * id the finding carries (a Trivy row's key is `CVE-…|package`, an OSV row's key is an
 * advisory id), so a waiver for one CVE has to reach the row that carries it rather than
 * demanding the operator reproduce the producer's whole key.
 */
export function waiverCovers(
  waiver: Pick<security_waivers, 'source' | 'match' | 'ended_at'>,
  finding: Pick<security_findings, 'source' | 'key' | 'title'>,
): boolean {
  if (waiver.ended_at !== null) return false;
  if (waiver.source !== finding.source) return false;
  if (waiver.match === finding.key) return true;
  return finding.key.includes(waiver.match) || (finding.title?.includes(waiver.match) ?? false);
}

/**
 * The waiver state a finding renders with. An active waiver wins over an expired one for
 * the same finding — a fresh decision supersedes a lapsed one — but the expired waiver row
 * itself still counts on the overview.
 */
export function waiverStateFor(
  finding: Pick<security_findings, 'source' | 'key' | 'title'>,
  waivers: readonly Pick<security_waivers, 'source' | 'match' | 'ended_at' | 'review_by'>[],
  now: Date,
): WaiverState {
  let expired: string | null = null;
  let active: string | null = null;
  for (const waiver of waivers) {
    if (!waiverCovers(waiver, finding)) continue;
    const reviewBy = waiver.review_by.toISOString();
    if (waiver.review_by.getTime() < now.getTime()) {
      expired = reviewBy;
    } else if (active === null || reviewBy > active) {
      active = reviewBy;
    }
  }
  if (active !== null) return { status: 'active', reviewBy: active };
  if (expired !== null) return { status: 'expired', reviewBy: expired };
  return { status: 'none' };
}

export function isWaiverExpired(
  waiver: Pick<security_waivers, 'ended_at' | 'review_by'>,
  now: Date,
): boolean {
  return waiver.ended_at === null && waiver.review_by.getTime() < now.getTime();
}

/**
 * The four numbers, from counts the database produced.
 *
 * WHY counts and not rows: the cards used to be derived by loading every unresolved finding and
 * filtering in JavaScript, which is a full table scan of the feed on a page whose table now shows
 * one page of it. The arithmetic that decides what each number MEANS stays here — the read path
 * hands over the two aggregates it can get from SQL (`groupBy(source)` and a count of rootfs rows
 * with a fix version) and this function is the only place the four numbers are formed.
 *
 * WHY `hostOsUpdates` counts only rows with an `available` version: "an update is available"
 * is the claim the card makes, and a rootfs finding whose fix version the producer did not
 * name would make the number say more than the feed knows.
 */
export function buildPatchingCards(
  counts: PatchingFindingCounts,
  waivers: readonly Pick<security_waivers, 'ended_at' | 'review_by'>[],
  now: Date,
): PatchingCards {
  return {
    staleImages: counts.bySource.diun,
    unresolvedCves: counts.bySource.rootfs + counts.bySource.osv,
    expiredWaivers: waivers.filter((waiver) => isWaiverExpired(waiver, now)).length,
    hostOsUpdates: counts.rootfsWithAvailable,
  };
}

/** Groups unresolved findings by source in contract order, severity first inside each. */
export function groupFindings(
  findings: readonly PatchingFinding[],
): readonly PatchingGroup[] {
  const groups: PatchingGroup[] = [];
  for (const source of PATCHING_SOURCES) {
    const rows = findings
      .filter((finding) => finding.source === source)
      .sort((left, right) => {
        const severity =
          (left.severity === null ? 99 : SEVERITY_RANK[left.severity]) -
          (right.severity === null ? 99 : SEVERITY_RANK[right.severity]);
        if (severity !== 0) return severity;
        return right.lastSeen.localeCompare(left.lastSeen);
      });
    if (rows.length > 0) groups.push({ source, findings: rows });
  }
  return groups;
}
