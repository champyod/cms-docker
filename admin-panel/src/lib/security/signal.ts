import {
  PATCHING_SEVERITIES,
  type PatchingCards,
  type PatchingFinding,
  type PatchingSeverity,
  type PatchingSource,
  type PatchingWaiver,
} from '@/lib/security/patching';
import type { WaivedReachable } from '@/lib/security/verdict-flip';
import { countLabel } from '@/lib/format-number';

/** Pure and clock-as-argument so the card, the channel and the tests answer what is wrong the same way. */

/** How loud the current state is, worst first. The card's colour and the channel both read it. */
export type SignalTone = 'act' | 'unevaluable' | 'watch' | 'clear';

export type SignalFactKind = 'waiver-expired' | 'waiver-flip' | 'finding-critical' | 'staleness';

/** The key must identify the fact, not the sentence; waiver:12:expired is the same fact tomorrow. */
export interface SignalFact {
  readonly key: string;
  readonly kind: SignalFactKind;
  /** One line naming the item, as it reads in the message. */
  readonly detail: string;
  /** When it began: the lapsed review date, the first sighting, the last proven run. */
  readonly since: string | null;
}

export type StalenessChannel = 'backup' | 'offsite';

/** unknown means nothing could be read, and is never folded into current: fail closed. */
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

/** Aggregates and bounded lists only: a digest walked from every finding is what read the whole feed once. */
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
  /** The one fact here about a decision that no longer fits the host it was made for. */
  readonly flips: WaivedReachable;
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
  /** The list is what a message can name; the count is what is true. */
  readonly triggers: readonly SignalFact[];
  /** How many facts would start a message, from SQL counts rather than from the rows above. */
  readonly triggerCount: number;
  /** Riders are never printed individually, so they are counted, not enumerated. */
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
  /** The floor absorbs a flap: a partial push resolving a row makes the same fact new again seconds later. */
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
  return `${finding.source}, ${finding.subject}${title}`;
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

/** The fact stands for a set, so the key moves with the set or the second flip is silent. */
export function waiverFlipKey(count: number, worstKey: string | null): string {
  return `waiver-flip:${String(count)}:${worstKey ?? ''}`;
}

/** One fact for the whole set: how many rows, and the worst of them named. */
function waiverFlipFact(flips: WaivedReachable): SignalFact | null {
  if (flips.count === 0) return null;
  const worst = flips.worst;
  const named =
    worst === null
      ? 'not named'
      : `${worst.severity ?? 'unrated'} ${worst.title ?? worst.key}${worst.host === null ? '' : ` on ${worst.host}`}`;
  return {
    key: waiverFlipKey(flips.count, worst?.key ?? null),
    kind: 'waiver-flip',
    detail: `${countLabel(flips.count, { one: 'waived finding', other: 'waived findings' })} reachable now, worst ${named}`,
    since: worst?.flippedAt ?? null,
  };
}

/** The instant a first sighting becomes "aged": exactly `ageDays(since) > findingAgeDays`. */
export function agedCutoff(now: Date): Date {
  return new Date(now.getTime() - (SIGNAL_RULES.findingAgeDays + 1) * DAY_MS);
}

function isAged(firstSeen: string, now: Date): boolean {
  return ageDays(firstSeen, now) > SIGNAL_RULES.findingAgeDays;
}

/** The arithmetic for unwaived and aged happens once here; staleness arrives as its own reading. */
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
      detail: `${waiver.source} waiver ${waiver.match}: review was due ${waiver.reviewBy.slice(0, 10)}`,
      since: waiver.reviewBy,
    });
  }

  // A decision that no longer fits is named before the unwaived criticals.
  const flipFact = waiverFlipFact(facts.flips);
  if (flipFact !== null) triggers.push(flipFact);

  // The rows arrive filtered to no-waiver-at-all: a lapsed waiver is already pushed as itself.
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
          : `${reading.channel}: cannot evaluate, ${reading.detail ?? 'no reading'}`,
      since:
        reading.state === 'stale' && reading.observedAtSeconds !== null
          ? new Date(reading.observedAtSeconds * 1000).toISOString()
          : null,
    });
  }

  // Everything a waiver could hide is subtractable from a total, so the rows themselves are not needed.
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
    // Reachability is information, not a waiver: a CRITICAL counts here whether or not it is reachable.
    unwaivedCritical: facts.bySeverity.CRITICAL - activeWith('CRITICAL'),
    unwaivedHigh: facts.bySeverity.HIGH - activeWith('HIGH'),
    expiredWaivers: expiredWaivers.length,
    expiringWaivers: expiringWaivers.length,
    agedFindings: facts.aged - active.filter((finding) => isAged(finding.firstSeen, now)).length,
    // From the shared cards, so the digest cannot count stale images differently from the card.
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
    triggerCount:
      expiredWaivers.length +
      (pushedTotal - pushedTouched) +
      (facts.flips.count > 0 ? 1 : 0) +
      stalenessTriggers,
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

/** Unreadable is push-worthy but reads as cannot-be-judged, not as a finding. */
function toneFor(triggers: readonly SignalFact[], counts: SignalCounts): SignalTone {
  if (triggers.some((fact) => !fact.key.startsWith('cannot-evaluate:'))) return 'act';
  if (counts.unevaluable > 0) return 'unevaluable';
  if (counts.unwaivedHigh > 0 || counts.expiringWaivers > 0 || counts.agedFindings > 0) return 'watch';
  return 'clear';
}

/** A stable order: lapsed first, then criticals, then the unseen; the oldest leads inside a kind. */
const KIND_ORDER: Record<SignalFactKind, number> = {
  'waiver-expired': 0,
  'waiver-flip': 1,
  'finding-critical': 2,
  staleness: 3,
};

function sortFacts(facts: readonly SignalFact[]): readonly SignalFact[] {
  return [...facts].sort((left, right) => {
    const kind = KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
    if (kind !== 0) return kind;
    return (left.since ?? '').localeCompare(right.since ?? '');
  });
}

/** The read path already chose the row; ties go to the one seen first. */
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
    detail: `${worst.severity ?? 'unrated'}, ${waiver}`,
    since: worst.firstSeen,
    ageDays: null,
  };
}

/** A finding under a current waiver has been decided about, so it is not the oldest problem. */
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
            detail: `${oldestUnwaived.severity ?? 'unrated'}, no waiver, first seen ${oldestUnwaived.firstSeen.slice(0, 10)}`,
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
  /** The count is the only thing that reports those rows, so a change in it is a new fact. */
  readonly overflowKey: string | null;
  readonly mention: boolean;
  readonly title: string;
  readonly body: string;
}

/** A count, not the unnamed keys: the point of the bound is not to fetch them. */
export function overflowFactKey(hidden: number): string {
  return `more:on-page:${String(hidden)}`;
}

/** The diff makes a repeat impossible and the floor makes a storm impossible. */
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
    mention: facts.some(
      (fact) => fact.kind === 'staleness' || fact.kind === 'finding-critical' || fact.kind === 'waiver-flip',
    ),
    title,
    body: renderMessage(digest, fresh),
  };
}

/** The full push set, not only the new lines: a message that names one fact leaves the operator guessing. */
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

/** Riders are the context that makes the page worth opening, never the reason the message exists. */
function renderRiderSummary(digest: SecurityDigest): string | null {
  const counts: readonly [number, string][] = [
    [digest.riderCounts.unwaivedHigh, 'unwaived HIGH'],
    [digest.riderCounts.aged, `older than ${String(SIGNAL_RULES.findingAgeDays)} days`],
    [digest.riderCounts.staleImages, 'stale image'],
    [digest.riderCounts.expiringWaivers, 'expiring waiver'],
  ];
  const named = counts.filter(([count]) => count > 0);
  if (named.length === 0) return null;
  return named.map(([count, label]) => `${String(count)} ${label}`).join(', ');
}
