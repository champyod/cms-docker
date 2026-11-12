/**
 * What one completed scan says on the channel.
 *
 * WHY every completed run speaks, changed or not: a scan is a promise that something was checked.
 * The digest in `signal.ts` is a state channel — it stays quiet while nothing changes — and that
 * silence is indistinguishable from a scanner that stopped running. A per-run message is the
 * heartbeat: "this ran at 03:00, it saw 42 things, 3 of them were new".
 *
 * WHY the CRITICAL list is bounded and the rest is counted: a scan can report hundreds of rows, and
 * Discord drops anything over 2000 characters. Ten named CRITICALs plus an honest "…and N more"
 * keeps the message inside the cap without ever cutting a line in half — a truncated CVE id reads
 * as a different CVE.
 */

/** Discord's cap on an embed description; the builder trims, so the receiver never has to. */
export const DISCORD_BODY_LIMIT = 2000;
/** CRITICAL rows named one by one; the rest become the counted remainder line. */
export const SCAN_CRITICAL_LINES = 10;
const SUBJECT_LIMIT = 110;
const ID_LIMIT = 40;

/** Red when something unwaived is critical, blue when the run is only a report. */
export const SCAN_ALERT_COLOR = 15_158_332;
export const SCAN_REPORT_COLOR = 3_447_003;

/** One CRITICAL as the message names it: what it is, and whether a live decision covers it. */
export interface ScanCriticalRow {
  readonly key: string;
  readonly subject: string;
  readonly waiver: 'active' | 'expired' | 'none';
  readonly reviewBy: string | null;
}

/** The counts the tail line prints. `unrated` is every row no severity in the contract covers. */
export interface ScanCounts {
  readonly high: number;
  readonly medium: number;
  readonly low: number;
  readonly unrated: number;
}

/** A completed run, as the message reads it. Numbers are the whole scope's, not the message's. */
export interface ScanRunFacts {
  readonly source: string;
  readonly host: string | null;
  readonly runStartedAt: Date;
  readonly total: number;
  readonly added: number;
  readonly criticals: number;
  readonly counts: ScanCounts;
  readonly waived: number;
  /** At most `SCAN_CRITICAL_LINES` rows, so the pure builder never depends on the feed's size. */
  readonly criticalRows: readonly ScanCriticalRow[];
}

export interface ScanAnnouncement {
  readonly title: string;
  readonly body: string;
  readonly mention: boolean;
  readonly color: number;
}

/**
 * The identity of one run, and the dedupe key of its message.
 *
 * WHY the run's own start and not its content: a re-push of the same run must be silent, and its
 * findings may well be identical — a content key could not tell "the same run twice" from "a second
 * run that saw the same thing", and only the second one deserves a message.
 */
export function scanRunKey(source: string, host: string | null, runStartedAt: Date): string {
  return `${source}|${host ?? '-'}|${runStartedAt.toISOString()}`;
}

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/** The run's clock, in UTC and to the minute: the panel renders local time, Discord does not. */
function runTime(at: Date): string {
  return `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function waiverNote(row: ScanCriticalRow): string {
  const due = row.reviewBy === null ? 'unknown' : row.reviewBy.slice(0, 10);
  if (row.waiver === 'active') return `waived until ${due}`;
  // An expired waiver suppresses nothing, so saying only "waived" would be a false reassurance.
  if (row.waiver === 'expired') return `waiver expired ${due}`;
  return 'no waiver';
}

/** The CVE the row is about: producers prefix the key with it, and the subject alone hides it. */
function criticalLine(row: ScanCriticalRow): string {
  const id = clip(row.key.split('|')[0], ID_LIMIT);
  const name = row.subject.includes(id) ? row.subject : `${row.subject} (${id})`;
  return `• ${clip(name, SUBJECT_LIMIT)} — ${waiverNote(row)}`;
}

function headerLine(facts: ScanRunFacts): string {
  const where = facts.host ?? facts.source;
  return `${where} · ${runTime(facts.runStartedAt)} · ${String(facts.total)} findings, ${String(facts.added)} new this run`;
}

function tailLine(facts: ScanRunFacts): string {
  const parts = [
    `HIGH ${String(facts.counts.high)}`,
    `MEDIUM ${String(facts.counts.medium)}`,
    `LOW ${String(facts.counts.low)}`,
  ];
  if (facts.counts.unrated > 0) parts.push(`UNKNOWN ${String(facts.counts.unrated)}`);
  parts.push(`${String(facts.waived)} waived`);
  return parts.join(' · ');
}

/**
 * The body for a given number of named CRITICALs.
 *
 * WHY `shown` is a parameter: the trim loop and the final render have to agree exactly, and a
 * render that decided its own length would let a re-render after trimming disagree with itself.
 */
function renderBody(facts: ScanRunFacts, shown: number): string {
  const lines = [headerLine(facts)];
  for (const row of facts.criticalRows.slice(0, shown)) lines.push(criticalLine(row));
  const hidden = facts.criticals - shown;
  if (hidden > 0) lines.push(`• …and ${String(hidden)} more CRITICAL on the patching page`);
  else if (facts.criticals === 0) lines.push('• No CRITICAL findings.');
  lines.push(tailLine(facts));
  return lines.join('\n');
}

/** Whether the message reads as an alert: any named CRITICAL nobody has decided about. */
function isAlert(facts: ScanRunFacts, shown: number): boolean {
  return facts.criticalRows.slice(0, shown).some((row) => row.waiver !== 'active');
}

/** Builds the one message a completed run sends, trimmed to what Discord will accept. */
export function buildScanAnnouncement(facts: ScanRunFacts): ScanAnnouncement {
  let shown = Math.min(facts.criticalRows.length, SCAN_CRITICAL_LINES);
  let body = renderBody(facts, shown);
  while (body.length > DISCORD_BODY_LIMIT && shown > 0) {
    shown -= 1;
    body = renderBody(facts, shown);
  }
  const alert = facts.criticals > 0 && isAlert(facts, shown);
  return {
    title: `Security scan complete: ${facts.host ?? facts.source}`,
    body,
    mention: alert,
    color: alert ? SCAN_ALERT_COLOR : SCAN_REPORT_COLOR,
  };
}
