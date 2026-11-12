// What one finished scan says on the channel: one embed, five levels, composed from facts only.
// WHY facts and not a store read: the poller counts first and renders second, so the layout is
// testable without a database and cannot disagree with the numbers it prints.

/** Discord's cap on an embed description; the builder trims, so the receiver never has to. */
export const DISCORD_BODY_LIMIT = 2000;
/** L3 names this many rows; the rest become one counted remainder line. */
export const SCAN_CRITICAL_LINES = 5;
/** Where the message sends a reader who wants the rows: the page that owns them. */
export const PATCHING_PATH = '/security/patching';

const SUBJECT_LIMIT = 90;
const ID_LIMIT = 40;
const FOOTER_LIMIT = 400;

/** Red while something unwaived is critical, amber while unwaived HIGH stands, green below that. */
export const SCAN_ALERT_COLOR = 15_158_332;
export const SCAN_WARN_COLOR = 15_105_570;
export const SCAN_REPORT_COLOR = 5_763_719;

export type ScanReachability = 'reachable' | 'unreachable' | 'unknown';

/** One run as the ledger identifies it: the box, the instant the run began, and its last batch. */
export interface ScanRun {
  readonly host: string | null;
  readonly runStartedAt: Date;
  readonly lastPushAt: Date;
}

/** Unwaived counts: a live waiver takes its row out, an expired one leaves it in. */
export interface ScanRunCounts {
  readonly high: number;
  readonly medium: number;
  readonly low: number;
  /** Rows no contract severity ranks: UNKNOWN and the producers that report none. */
  readonly unrated: number;
}

/** One unwaived CRITICAL the message names, with the two facts that order it. */
export interface ScanCriticalRow {
  readonly key: string;
  readonly subject: string;
  readonly reachability: ScanReachability;
  readonly ageDays: number;
}

/** The classifier's verdict over the run's rows: the L5 split. */
export interface ScanJudged {
  readonly reachable: number;
  readonly unreachable: number;
  readonly unknown: number;
}

/** A finished run as the message reads it; every number is unwaived, over the box's whole list. */
export interface ScanRunFacts {
  readonly host: string | null;
  readonly runStartedAt: Date;
  readonly lastPushAt: Date;
  /** Unwaived open rows: the standing list, which leads because a finding found again is still there. */
  readonly standing: number;
  /** Rows first seen at or after the run's start: the delta, never the total. */
  readonly added: number;
  /** Unwaived CRITICALs: the number the title, the bar and the ping all follow. */
  readonly criticals: number;
  readonly counts: ScanRunCounts;
  /** Rows a live waiver covers, in the same scope. */
  readonly waived: number;
  /** The soonest review date among those waivers, as `YYYY-MM-DD`, or null when none covers a row. */
  readonly nextReview: string | null;
  /** At most {@link SCAN_CRITICAL_LINES} rows, reachable first, so the builder stays bounded. */
  readonly criticalRows: readonly ScanCriticalRow[];
  readonly judged: ScanJudged;
}

export interface ScanAnnouncement {
  readonly title: string;
  readonly body: string;
  /** L5: the run's clock, its duration, the judged split and the page — the embed's subtext. */
  readonly footer: string;
  readonly mention: boolean;
  readonly color: number;
}

/** One run's identity, and its message's dedupe key: box and start, never the source. */
// WHY no source: one run pushes osv and rootfs separately, and a key naming the source split it in two.
export function scanRunKey(host: string | null, runStartedAt: Date): string {
  return `${host ?? '-'}|${runStartedAt.toISOString()}`;
}

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/** Thousands separators, so 13357 reads as a number and not as a serial. */
function grouped(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** The run's clock, in UTC to the minute: the panel renders local time, Discord does not. */
function runTime(at: Date): string {
  return `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** How long the run took, from its start to its last batch: a run that crawled is a fact. */
function duration(from: Date, to: Date): string {
  const seconds = Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return `${String(seconds)}s`;
  if (minutes < 60) return `${String(minutes)}m${String(seconds % 60).padStart(2, '0')}s`;
  return `${String(Math.floor(minutes / 60))}h${String(minutes % 60).padStart(2, '0')}m`;
}

function ageLabel(days: number): string {
  return days <= 0 ? 'today' : `${String(days)}d`;
}

function where(facts: ScanRunFacts): string {
  return facts.host ?? 'all hosts';
}

/** L1: the number that decides whether this message is an alarm, a watch, or a receipt. */
function titleLine(facts: ScanRunFacts): string {
  if (facts.criticals === 0 && facts.counts.high === 0) return `nothing unwaived · ${where(facts)}`;
  if (facts.criticals === 0) return `${grouped(facts.counts.high)} unwaived HIGH · ${where(facts)}`;
  return `${String(facts.criticals)} unwaived CRITICAL · ${where(facts)}`;
}

/** L2: standing leads, new is the delta, and the last term is what a human has to do. */
function leadLine(facts: ScanRunFacts): string {
  const need =
    facts.criticals > 0
      ? `${String(facts.criticals)} need${facts.criticals === 1 ? 's' : ''} you`
      : facts.counts.high > 0
        ? `${grouped(facts.counts.high)} need a decision`
        : 'nothing needs you';
  return `**${grouped(facts.standing)} standing** · ${grouped(facts.added)} new · ${need}`;
}

/** L3: the CVE leads because it is the string an operator pastes into a tracker. */
function namedLine(row: ScanCriticalRow): string {
  const id = clip(row.key.split('|')[0], ID_LIMIT);
  return `**${id}** · ${clip(row.subject, SUBJECT_LIMIT)} · ${ageLabel(row.ageDays)}`;
}

/** L4: a fenced block, because prose numbers in a proportional font do not line up. */
function countsBlock(facts: ScanRunFacts): string {
  const rows: [string, number][] = [
    ['HIGH', facts.counts.high],
    ['MED', facts.counts.medium],
    ['LOW', facts.counts.low],
  ];
  if (facts.counts.unrated > 0) rows.push(['UNK', facts.counts.unrated]);
  const width = Math.max(...rows.map(([, count]) => grouped(count).length));
  const lines = rows.map(([label, count]) => `${label.padEnd(5)}${grouped(count).padStart(width)}`);
  const review = facts.nextReview === null ? '' : ` · next review ${facts.nextReview}`;
  lines.push(`waived ${grouped(facts.waived)}${review}`);
  return ['```', ...lines, '```'].join('\n');
}

/** L5: when it ran, how long it took, what the classifier could judge, and where to look. */
function footerLine(facts: ScanRunFacts): string {
  const split = [
    `${grouped(facts.judged.reachable)} reachable`,
    `${grouped(facts.judged.unreachable)} unreachable`,
    `${grouped(facts.judged.unknown)} unknown`,
  ].join(' · ');
  const line = `run ${runTime(facts.runStartedAt)} · ${duration(facts.runStartedAt, facts.lastPushAt)} · ${split} · ${PATCHING_PATH}`;
  return clip(line, FOOTER_LIMIT);
}

/** The body for a given number of named rows; `shown` is explicit so the trim and the render agree. */
function renderBody(facts: ScanRunFacts, shown: number): string {
  const lines = [leadLine(facts)];
  for (const row of facts.criticalRows.slice(0, shown)) lines.push(namedLine(row));
  const hidden = facts.criticals - shown;
  if (hidden > 0) lines.push(`…and ${String(hidden)} more`);
  lines.push(countsBlock(facts));
  return lines.join('\n');
}

/** Builds the one message a finished run sends, trimmed to what Discord will accept. */
export function buildScanAnnouncement(facts: ScanRunFacts): ScanAnnouncement {
  let shown = Math.min(facts.criticalRows.length, SCAN_CRITICAL_LINES);
  let body = renderBody(facts, shown);
  while (body.length > DISCORD_BODY_LIMIT && shown > 0) {
    shown -= 1;
    body = renderBody(facts, shown);
  }
  const alert = facts.criticals > 0;
  const warn = !alert && facts.counts.high > 0;
  return {
    title: titleLine(facts),
    body,
    footer: footerLine(facts),
    mention: alert,
    color: alert ? SCAN_ALERT_COLOR : warn ? SCAN_WARN_COLOR : SCAN_REPORT_COLOR,
  };
}
