import {
  PATCHING_SEVERITIES,
  type PatchingCards,
  type PatchingFinding,
  type PatchingSeverity,
  type PatchingSource,
  type PatchingWaiver,
} from '@/lib/security/patching';

/**
 * What deserves to reach a human, and how loudly.
 *
 * WHY this module is pure: the panel card, the Discord digest and the tests all have to answer
 * "what is wrong right now" the same way, so the answer is computed once from the state the read
 * path already returns. It takes no database, no network and no clock of its own — `now` is an
 * argument — so a test drives a year of drift in a millisecond and the card cannot start
 * disagreeing with the channel about what counts.
 *
 * THE PUSH RULE, and why the list is short. A notification is only worth its noise if ignoring it
 * has a cost that grows by the hour:
 *
 *   · **A lapsed waiver** — the decision ran out, the CI waiver gate fails from that moment, and
 *     the finding it covered is back to unowned. It is the cheapest thing on this list to fix and
 *     the one that stops every deploy.
 *   · **An unresolved CRITICAL with no live waiver** — the class where "the next Renovate PR will
 *     bump it" is not a plan. HIGH rides along in the same message but never starts one: HIGH is
 *     the ordinary state of an unpatched distro image between two daily bumps, so paging on it is
 *     how a channel becomes unreadable in a week.
 *   · **A backup or offsite copy that is stale, or that cannot be evaluated** — the only fact here
 *     that cannot be repaired after the fact. Silence is not reassurance: a monitoring stack that
 *     cannot be reached is reported as `cannot evaluate`, never as healthy.
 *
 * Everything else belongs on the page, where it is read on purpose:
 *
 *   · a waiver **expiring** within {@link SIGNAL_RULES.waiverWarningDays} — an advance warning is
 *     planning, and it becomes a push the moment it actually lapses;
 *   · an unwaived **HIGH** — see above;
 *   · a finding **older than** {@link SIGNAL_RULES.findingAgeDays} — age is a prioritisation
 *     signal, not an event; the finding already had its chance to page when it was CRITICAL, and
 *     "this is still 40 days old" repeats a fact the operator can see;
 *   · a **stale image** (Diun) — image drift is routine and Renovate owns the action, so paging it
 *     would page the same 6 images every cycle;
 *   · MEDIUM/LOW/UNKNOWN, and every per-waiver detail.
 *
 * The channel therefore carries at most one message per {@link SIGNAL_RULES.minIntervalMs}, and
 * nothing at all while the push set is unchanged (see `planNotification`).
 */

/** How loud the current state is, worst first. The card's colour and the channel both read it. */
export type SignalTone = 'act' | 'unevaluable' | 'watch' | 'clear';

export type SignalFactKind = 'waiver-expired' | 'finding-critical' | 'staleness';

/**
 * One thing worth saying, with a key that is stable for as long as the fact is.
 *
 * WHY a key and not just text: the channel is deduplicated by comparing the current keys with the
 * ones the last message carried, so the key must identify the *fact* (this waiver lapsed) and not
 * the sentence (which contains a date that moves). `waiver:12:expired` is the same fact tomorrow.
 */
export interface SignalFact {
  readonly key: string;
  readonly kind: SignalFactKind;
  /** One line naming the item, as it reads in the message. */
  readonly detail: string;
  /** When it began: the lapsed review date, the first sighting, the last proven run. */
  readonly since: string | null;
}

export type StalenessChannel = 'backup' | 'offsite';

/**
 * `current` is the publisher's own verdict that the newest copy is inside its window; `stale` is
 * its verdict that it is not; `unknown` means nothing could be read, which is never folded into
 * `current` (fail closed).
 */
export type StalenessState = 'current' | 'stale' | 'unknown';

export interface StalenessReading {
  readonly channel: StalenessChannel;
  readonly state: StalenessState;
  /** Seconds since the newest proven copy, as the publisher measured it. */
  readonly ageSeconds: number | null;
  /** Unix time the publisher wrote its state file; null when nothing was readable. */
  readonly observedAtSeconds: number | null;
  /** Why this is not `current`, in words the operator can act on. */
  readonly detail: string | null;
}

export interface StalenessSnapshot {
  readonly readings: readonly StalenessReading[];
  /** What answered — the scrape target, or null when none did. */
  readonly source: string | null;
}

/** A count the card shows, and the reason it is on the card at all. */
export interface SignalCounts {
  readonly openFindings: number;
  /** CRITICAL with no *live* waiver: an expired waiver suppresses nothing. */
  readonly unwaivedCritical: number;
  readonly unwaivedHigh: number;
  readonly expiredWaivers: number;
  /** Live waivers whose review date is inside the warning window but not yet past it. */
  readonly expiringWaivers: number;
  /** Unwaived findings older than the age threshold. */
  readonly agedFindings: number;
  readonly staleImages: number;
  /** Channels reporting `stale`. */
  readonly staleSources: number;
  /** Channels that could not be evaluated at all. */
  readonly unevaluable: number;
}

/** The one item the card names, so the digest is a sentence and not only numbers. */
export interface SignalLead {
  readonly label: string;
  readonly detail: string;
  readonly since: string | null;
  readonly ageDays: number | null;
}

/** How many page-only facts each label covers — the "Also on the page" line, as numbers. */
export interface SignalRiderCounts {
  readonly unwaivedHigh: number;
  readonly aged: number;
  readonly staleImages: number;
  readonly expiringWaivers: number;
}

/**
 * What the read path hands the digest: SQL totals plus the few rows it can still name.
 *
 * WHY this is not a `PatchingState`: the state is every unresolved finding, and building a digest
 * from it is what made one page render read 34,610 rows. Every number below is either an aggregate
 * the database computed or the count of a bounded list; the lists are only the rows a message can
 * put in a line. `waived` is the one row list that is not bounded by the message, because it is
 * bounded by the waivers instead: a row no live waiver matches has no waiver state to look up.
 */
export interface PatchingSignalFacts {
  readonly cards: PatchingCards;
  /** The live waiver decisions — a decision, not a finding, so the set is small by construction. */
  readonly waivers: readonly PatchingWaiver[];
  /** Unresolved findings per producer family, over the whole feed. */
  readonly bySource: Readonly<Record<PatchingSource, number>>;
  /** Unresolved findings per severity, over the whole feed; `unrated` is the rest. */
  readonly bySeverity: Readonly<Record<PatchingSeverity, number>>;
  /** Unresolved rows carrying no severity the contract knows (Diun reports none). */
  readonly unrated: number;
  /** Rows first seen longer ago than {@link SIGNAL_RULES.findingAgeDays}, waiver state not applied. */
  readonly aged: number;
  /** Every row a live waiver touches, already mapped: their state is `active` or `expired`. */
  readonly waived: readonly PatchingFinding[];
  /** Unwaived CRITICAL rows, bounded to what a message can name. */
  readonly criticals: readonly PatchingFinding[];
  readonly worst: PatchingFinding | null;
  /** The oldest unresolved row no live waiver touches, from an ordered `take: 1` query. */
  readonly oldest: PatchingFinding | null;
}

export interface SecurityDigest {
  readonly tone: SignalTone;
  readonly counts: SignalCounts;
  /** The most severe unresolved item, whatever its waiver state. */
  readonly worst: SignalLead | null;
  /** The item that has been wrong the longest: the oldest unowned thing. */
  readonly oldest: SignalLead | null;
  /**
   * Facts that start a message, bounded to {@link SIGNAL_RULES.maxLines}.
   *
   * WHY a bounded list beside an exact `triggerCount`: the feed can hold tens of thousands of
   * rows, and a message prints at most `maxLines` of them. The list is what a message can name;
   * the count is what is true.
   */
  readonly triggers: readonly SignalFact[];
  /** How many facts would start a message, from SQL counts rather than from the rows above. */
  readonly triggerCount: number;
  /**
   * Facts named only as a counted line ("Also on the page: 2 unwaived HIGH").
   *
   * WHY counts and not a fact per row: a rider is never printed individually, so enumerating one
   * per finding made the digest's cost grow with the feed for a number that was only ever summed.
   */
  readonly riderCounts: SignalRiderCounts;
  readonly staleness: readonly StalenessReading[];
}

export const SIGNAL_RULES = {
  /** Severities that page on their own. See the module comment for why HIGH is not here. */
  pushSeverities: ['CRITICAL'] as const satisfies readonly PatchingSeverity[],
  /** A live waiver this close to its review date is called out on the page, not pushed. */
  waiverWarningDays: 7,
  /** An unwaived finding this old is called out as aged on the page. */
  findingAgeDays: 14,
  /**
   * One message per window, however many facts arrive.
   *
   * WHY a floor at all when the set is already deduplicated: a producer's partial push can resolve
   * a row and the next complete push can bring it back, which makes the same fact "new" again
   * seconds later. Ten minutes absorbs a flap without ever leaving a real fact unsaid — it is only
   * deferred to the next tick, and the page shows it immediately.
   */
  minIntervalMs: 10 * 60 * 1000,
  /** Detail lines in one message. A burst of forty CVEs is one message, not forty. */
  maxLines: 12,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

function ageDays(since: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(since).getTime()) / DAY_MS);
}

function findingDetail(finding: PatchingFinding): string {
  const title = finding.title === null ? '' : ` (${finding.title})`;
  return `${finding.source} · ${finding.subject}${title}`;
}

function findingLabel(finding: PatchingFinding): string {
  return `${finding.source} ${finding.subject}`;
}

/** The push key for a finding: the producer's own identity, never the rendered sentence. */
export function findingKey(finding: Pick<PatchingFinding, 'source' | 'key'>): string {
  return `finding:${finding.source}:${finding.key}`;
}

/** The push key for a lapsed waiver; `expired` keeps it distinct from its `expiring` rider. */
export function expiredWaiverKey(waiverId: number): string {
  return `waiver:${String(waiverId)}:expired`;
}

/** The instant a first sighting becomes "aged": exactly `ageDays(since) > findingAgeDays`. */
export function agedCutoff(now: Date): Date {
  return new Date(now.getTime() - (SIGNAL_RULES.findingAgeDays + 1) * DAY_MS);
}

function isAged(firstSeen: string, now: Date): boolean {
  return ageDays(firstSeen, now) > SIGNAL_RULES.findingAgeDays;
}

/**
 * Builds the digest from the read path's facts plus the staleness snapshot.
 *
 * WHY the facts and not a `PatchingState`: the state is every unresolved finding, and a digest that
 * walked all of them made one page render read the whole feed. Every number below is therefore
 * either a SQL total or the count of a bounded list — and the arithmetic (what "unwaived" and "aged"
 * mean) still happens once, here, rather than in a query per number.
 *
 * WHY staleness is still its own input: a backup age is not a finding (docs/SECURITY-FEED.md), so it
 * arrives as its own reading instead of being squeezed into either security table.
 */
export function buildSecurityDigest(
  facts: PatchingSignalFacts,
  staleness: StalenessSnapshot,
  now: Date,
): SecurityDigest {
  const triggers: SignalFact[] = [];

  const expiredWaivers = facts.waivers.filter((waiver) => waiver.expired);
  for (const waiver of expiredWaivers) {
    triggers.push({
      key: expiredWaiverKey(waiver.id),
      kind: 'waiver-expired',
      detail: `${waiver.source} waiver ${waiver.match} — review was due ${waiver.reviewBy.slice(0, 10)}`,
      since: waiver.reviewBy,
    });
  }

  // WHY the rows arrive already filtered to "no waiver at all": a CRITICAL whose waiver lapsed is
  // already pushed as the lapsed decision, and one item producing two lines is how a digest starts
  // to look like noise. The read path applies that predicate in SQL; `triggerCount` below keeps the
  // number exact even when the message can only name the first few.
  for (const finding of facts.criticals) {
    triggers.push({
      key: findingKey(finding),
      kind: 'finding-critical',
      detail: findingDetail(finding),
      since: finding.firstSeen,
    });
  }

  let stalenessTriggers = 0;
  for (const reading of staleness.readings) {
    if (reading.state === 'current') continue;
    stalenessTriggers += 1;
    triggers.push({
      key: reading.state === 'stale' ? `stale:${reading.channel}` : `cannot-evaluate:${reading.channel}`,
      kind: 'staleness',
      detail:
        reading.state === 'stale'
          ? `${reading.channel}: ${reading.detail ?? 'stale'}`
          : `${reading.channel}: cannot evaluate — ${reading.detail ?? 'no reading'}`,
      since:
        reading.state === 'stale' && reading.observedAtSeconds !== null
          ? new Date(reading.observedAtSeconds * 1000).toISOString()
          : null,
    });
  }

  // The rows a live waiver covers are the only ones whose state is not 'none', so everything a
  // waiver could hide is subtractable from a total rather than requiring the rows themselves.
  const active = facts.waived.filter((finding) => finding.waiver.status === 'active');
  const activeWith = (severity: PatchingSeverity): number =>
    active.filter((finding) => finding.severity === severity).length;
  const isPushSeverity = (severity: PatchingSeverity | null): boolean =>
    severity !== null && (SIGNAL_RULES.pushSeverities as readonly PatchingSeverity[]).includes(severity);
  const pushedTotal = SIGNAL_RULES.pushSeverities.reduce(
    (sum, severity) => sum + facts.bySeverity[severity],
    0,
  );
  const pushedTouched = facts.waived.filter(
    (finding) => isPushSeverity(finding.severity) && finding.waiver.status !== 'none',
  ).length;

  const warningCutoff = now.getTime() + SIGNAL_RULES.waiverWarningDays * DAY_MS;
  const expiringWaivers = facts.waivers.filter(
    (waiver) => !waiver.expired && new Date(waiver.reviewBy).getTime() <= warningCutoff,
  );

  const counts: SignalCounts = {
    openFindings: facts.unrated + PATCHING_SEVERITIES.reduce((sum, severity) => sum + facts.bySeverity[severity], 0),
    unwaivedCritical: facts.bySeverity.CRITICAL - activeWith('CRITICAL'),
    unwaivedHigh: facts.bySeverity.HIGH - activeWith('HIGH'),
    expiredWaivers: expiredWaivers.length,
    expiringWaivers: expiringWaivers.length,
    agedFindings: facts.aged - active.filter((finding) => isAged(finding.firstSeen, now)).length,
    // From the shared cards so the digest cannot count stale images differently from the card
    // that has shown that number since the feed shipped.
    staleImages: facts.cards.staleImages,
    staleSources: staleness.readings.filter((reading) => reading.state === 'stale').length,
    unevaluable: staleness.readings.filter((reading) => reading.state === 'unknown').length,
  };

  return {
    tone: toneFor(triggers, counts),
    counts,
    worst: worstFinding(facts.worst),
    oldest: oldestUnowned(facts.oldest, expiredWaivers, now),
    triggers: sortFacts(triggers),
    triggerCount: expiredWaivers.length + (pushedTotal - pushedTouched) + stalenessTriggers,
    // Diun's drift is a rider, never a trigger; it carries no severity, so it is named by subject.
    riderCounts: {
      unwaivedHigh: counts.unwaivedHigh,
      aged: counts.agedFindings,
      staleImages: facts.bySource.diun,
      expiringWaivers: expiringWaivers.length,
    },
    staleness: staleness.readings,
  };
}

/**
 * Precedence: something to act on beats something we cannot see, which beats a trend.
 *
 * WHY an unreadable reading is not simply "act": it is still push-worthy (the channel has to say it),
 * but the card should read as "this cannot be judged" rather than as a finding — an operator who sees
 * "needs attention" beside no finding will look for one that is not there.
 */
function toneFor(triggers: readonly SignalFact[], counts: SignalCounts): SignalTone {
  if (triggers.some((fact) => !fact.key.startsWith('cannot-evaluate:'))) return 'act';
  if (counts.unevaluable > 0) return 'unevaluable';
  if (counts.unwaivedHigh > 0 || counts.expiringWaivers > 0 || counts.agedFindings > 0) return 'watch';
  return 'clear';
}

/**
 * A stable order for the message: the lapsed decision first (it is already failing CI and is the
 * cheapest to settle), then the unwaived criticals, then whatever cannot be seen or is stale. Inside
 * a kind, the oldest fact leads, because it is the one that has been ignored longest.
 */
const KIND_ORDER: Record<SignalFactKind, number> = {
  'waiver-expired': 0,
  'finding-critical': 1,
  staleness: 2,
};

function sortFacts(facts: readonly SignalFact[]): readonly SignalFact[] {
  return [...facts].sort((left, right) => {
    const kind = KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
    if (kind !== 0) return kind;
    return (left.since ?? '').localeCompare(right.since ?? '');
  });
}

/**
 * The most severe unresolved finding; ties go to the one seen first.
 *
 * WHY the row arrives already chosen: "the worst" is one row, and the database can order by severity
 * rank without handing over the feed — the read path picks the top severity with a count, then takes
 * its earliest sighting. Sorting every finding to name one is what this replaced.
 */
function worstFinding(worst: PatchingFinding | null): SignalLead | null {
  if (worst === null) return null;
  const waiver =
    worst.waiver.status === 'active'
      ? `waived until ${worst.waiver.reviewBy.slice(0, 10)}`
      : worst.waiver.status === 'expired'
        ? `waiver expired ${worst.waiver.reviewBy.slice(0, 10)}`
        : 'no waiver';
  return {
    label: findingLabel(worst),
    detail: `${worst.severity ?? 'unrated'} · ${waiver}`,
    since: worst.firstSeen,
    ageDays: null,
  };
}

/**
 * The oldest thing nobody owns: an unwaived finding or a lapsed waiver, whichever began earlier.
 *
 * WHY unowned and not simply oldest: a finding under a current waiver has been decided about, so it
 * is not "the oldest problem" — naming it would tell the operator to look at the one item that is
 * already handled. `oldestUnwaived` is the read path's `take: 1` over rows no live waiver matches,
 * which is why one row is enough to decide the finding half of this.
 */
function oldestUnowned(
  oldestUnwaived: PatchingFinding | null,
  expiredWaivers: readonly { readonly id: number; readonly source: string; readonly match: string; readonly reviewBy: string }[],
  now: Date,
): SignalLead | null {
  const candidates: SignalLead[] = [
    ...(oldestUnwaived === null
      ? []
      : [
          {
            label: findingLabel(oldestUnwaived),
            detail: `${oldestUnwaived.severity ?? 'unrated'} · no waiver · first seen ${oldestUnwaived.firstSeen.slice(0, 10)}`,
            since: oldestUnwaived.firstSeen,
            ageDays: ageDays(oldestUnwaived.firstSeen, now),
          },
        ]),
    ...expiredWaivers.map((waiver) => ({
      label: `${waiver.source} waiver ${waiver.match}`,
      detail: `review was due ${waiver.reviewBy.slice(0, 10)}`,
      since: waiver.reviewBy,
      ageDays: ageDays(waiver.reviewBy, now),
    })),
  ];
  const sorted = candidates.sort((left, right) => (left.since ?? '').localeCompare(right.since ?? ''));
  return sorted[0] ?? null;
}

/** What the last message said, and when. Written only when a message actually left. */
export interface PageRecord {
  readonly notifiedAt: string;
  readonly keys: readonly string[];
}

export type NotifyReason = 'send' | 'nothing-to-say' | 'unchanged' | 'rate-limited';

export interface NotifyPlan {
  readonly send: boolean;
  readonly reason: NotifyReason;
  /** Every fact the message would carry — the full current state, not only the new lines. */
  readonly facts: readonly SignalFact[];
  /** The facts the last message did not carry; these are what make it worth sending. */
  readonly fresh: readonly SignalFact[];
  /**
   * The key of the "…and N more" line, when the trigger count exceeded what a message names.
   *
   * WHY it is part of the record: the count is the only thing that reports those rows, so a change in
   * it is a new fact. Without a key of its own, a fresh CRITICAL beyond the named ones would never be
   * mentioned.
   */
  readonly overflowKey: string | null;
  readonly mention: boolean;
  readonly title: string;
  readonly body: string;
}

/**
 * The key for "…and N more": stable for as long as the number of unnamed facts is.
 *
 * WHY a count and not the unnamed keys: the point of the bound is not to fetch them.
 */
export function overflowFactKey(hidden: number): string {
  return `more:on-page:${String(hidden)}`;
}

/**
 * Decides whether this tick says anything, and what.
 *
 * WHY the diff and the floor are separate: the diff makes a *repeat* impossible (the same lapsed
 * waiver is in the last message's keys, so it is not fresh), and the floor makes a *storm*
 * impossible (a fact that flaps is new again after a partial push, and the floor is what stops it
 * becoming one message a minute). Only a send writes a {@link PageRecord}, so a suppressed fact is
 * never marked as delivered.
 */
export function planNotification(
  digest: SecurityDigest,
  last: PageRecord | null,
  now: Date,
): NotifyPlan {
  const facts = digest.triggers;
  const hidden = Math.max(0, digest.triggerCount - facts.length);
  const overflowKey = hidden > 0 ? overflowFactKey(hidden) : null;
  const known = new Set(last?.keys ?? []);
  const fresh = facts.filter((fact) => !known.has(fact.key));
  const overflowIsFresh = overflowKey !== null && !known.has(overflowKey);
  const title = `Security: ${String(digest.triggerCount)} item${digest.triggerCount === 1 ? '' : 's'} need attention`;

  if (facts.length === 0 && overflowKey === null) {
    return { send: false, reason: 'nothing-to-say', facts, fresh, overflowKey, mention: false, title, body: '' };
  }
  if (fresh.length === 0 && !overflowIsFresh) {
    return { send: false, reason: 'unchanged', facts, fresh, overflowKey, mention: false, title, body: '' };
  }
  if (last !== null && now.getTime() - new Date(last.notifiedAt).getTime() < SIGNAL_RULES.minIntervalMs) {
    return { send: false, reason: 'rate-limited', facts, fresh, overflowKey, mention: false, title, body: '' };
  }
  return {
    send: true,
    reason: 'send',
    facts,
    fresh,
    overflowKey,
    mention: facts.some((fact) => fact.kind === 'staleness' || fact.kind === 'finding-critical'),
    title,
    body: renderMessage(digest, fresh),
  };
}

/**
 * The message body: the full push set, then the riders as one counted line.
 *
 * WHY the full set and not only the new lines: a message that names one fact leaves the operator
 * guessing whether the backup is still broken. Riders ride because they are the context that makes
 * the page worth opening — they are not the reason the message exists.
 *
 * WHY the "…and N more" count comes from `triggerCount`: the list is bounded to what the message
 * prints, so its length is no longer the size of the push set.
 */
export function renderMessage(digest: SecurityDigest, fresh: readonly SignalFact[]): string {
  const lines: string[] = [];
  const shown = digest.triggers.slice(0, SIGNAL_RULES.maxLines);
  for (const fact of shown) lines.push(`• ${fact.detail}`);
  const hidden = Math.max(0, digest.triggerCount - shown.length);
  if (hidden > 0) lines.push(`• …and ${String(hidden)} more on the Patching page`);

  const summary = renderRiderSummary(digest);
  if (summary !== null) lines.push(`Also on the page: ${summary}.`);
  if (fresh.length > 0) {
    lines.push(`${String(fresh.length)} of these ${fresh.length === 1 ? 'is' : 'are'} new since the last message.`);
  }
  return lines.join('\n');
}

/**
 * The page-only facts as one line: "2 unwaived HIGH · 3 older than 14 days".
 *
 * WHY the numbers and not a fact list: this line is the only thing a rider is ever rendered as, so
 * the digest carries the counts and never a row per finding. The order is fixed (most actionable
 * first) so the same state always reads the same way.
 */
function renderRiderSummary(digest: SecurityDigest): string | null {
  const counts: readonly [number, string][] = [
    [digest.riderCounts.unwaivedHigh, 'unwaived HIGH'],
    [digest.riderCounts.aged, `older than ${String(SIGNAL_RULES.findingAgeDays)} days`],
    [digest.riderCounts.staleImages, 'stale image'],
    [digest.riderCounts.expiringWaivers, 'expiring waiver'],
  ];
  const named = counts.filter(([count]) => count > 0);
  if (named.length === 0) return null;
  return named.map(([count, label]) => `${String(count)} ${label}`).join(' · ');
}
