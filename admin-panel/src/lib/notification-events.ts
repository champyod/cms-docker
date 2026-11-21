import type { RouteId } from '@/lib/navigation/types';
import type { AuditResult } from './audit';

// Why explicit verbs, not keyword matching: lib/audit.ts already flags
// destructive verbs for display; push alerts are reserved for actions that
// change who can access what or what is running.
export const CRITICAL_AUDIT_VERBS: ReadonlySet<string> = new Set([
  'admin:delete',
  'admin_groups:set',
  'override:set',
  'override:clear',
  'group:create',
  'group:update',
  'group:delete',
  'deployment:deploy',
  'service:deploy',
  'service:restart',
  'container:control',
  'contest:delete',
  'backup_schedule:create',
  'backup_schedule:update',
  'backup_schedule:delete',
  'waf:config:update',
  'waf:control:apply',
  'waf:control:restart',
  'ban:unban:queue',
  'lockout:unlock',
  'lockout:exempt',
  'lockout:exempt:revoke',
  'tls:renew:queue',
]);

// Sensitive verbs whose FAILURE is also critical (possible break-in attempt).
const SENSITIVE_FAILURE_VERBS: ReadonlySet<string> = new Set([
  'password:reveal',
  'override:set',
  'admin_groups:set',
  'admin:delete',
  'waf:config:update',
  'waf:control:apply',
  'ban:unban:queue',
]);

// Verbs whose every occurrence also pages Discord. Everything else critical
// stays on the web bell so deploys and restarts do not page anyone.
export const DISCORD_SENSITIVE_VERBS: ReadonlySet<string> = new Set([
  ...SENSITIVE_FAILURE_VERBS,
  'override:clear',
  'waf:control:restart',
  'lockout:unlock',
  'lockout:exempt',
  'lockout:exempt:revoke',
  'tls:renew:queue',
]);

export const SUBMIT_BURST_PER_MINUTE = 20;
export const REVEAL_BURST_COUNT = 5;
export const REVEAL_BURST_WINDOW_MINUTES = 5;
export const ENROL_BURST_COUNT = 10;
export const ENROL_BURST_WINDOW_MINUTES = 5;
export const NOTIFICATION_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * The parts of a critical audit row a reader is shown — never the sentence itself.
 *
 * WHY the row travels as parts: the panel renders a Thai operator's copy in Thai, and the server
 * composes at request time with no reader. Sending a finished English sentence made the operator's
 * language unrepresentable for every audit-derived alert; sending the parts lets the one locale that
 * exists where the reader is compose it. The verb is an identifier (`admin:delete`), so it stays as
 * written; the words around it are the dictionary's.
 */
export interface AuditCue {
  /** A failure of a sensitive verb reads differently from a critical action that succeeded. */
  readonly kind: 'critical' | 'failed';
  readonly verb: string;
  readonly actor: string;
  readonly target: string;
}

export interface NotificationEvent {
  level: 'critical' | 'warning';
  cue: AuditCue;
  /**
   * The panel route holding this event's own record, where one exists.
   *
   * Why optional: an event the panel has no page for is still worth showing, and it must render as
   * plain text rather than as a link to a page that cannot show what the reader came to read.
   */
  destination?: RouteId;
}

// Why one constant and not a literal per classifier: every alert here is an audit row, and the log
// is the one page that can resolve a row, so the destination cannot drift between the two framings.
const AUDIT_LOG_DESTINATION: RouteId = 'administration.audit';

/** True when an audit row belongs on the web bell (all critical, both results). */
export function isWebNotify(verb: string, result: AuditResult): boolean {
  if (CRITICAL_AUDIT_VERBS.has(verb)) return true;
  if (result === 'failure' && verb === 'password:reveal') return true;
  return false;
}

/** True when an audit row must also page Discord (sensitive only). */
export function isDiscordNotify(verb: string, result: AuditResult): boolean {
  if (!DISCORD_SENSITIVE_VERBS.has(verb)) return false;
  if (verb === 'password:reveal') return result === 'failure';
  return true;
}

/**
 * The frame for a published row; null when the row stays off the bell.
 *
 * WHY it carries parts and not a sentence: the reader's language is the panel's, and this runs on the
 * server where no reader exists — see `AuditCue`.
 *
 * WHY the id-based classifier is gone: it had no caller. Every publish path resolves the actor's and
 * the target's names before framing, so the name-aware variant was the only one in use, and the
 * predicate it relied on (`isCriticalAuditEvent`) went with it.
 */
export function classifyAuditEventWithNames(
  verb: string,
  result: AuditResult,
  actorName: string,
  targetName: string,
): NotificationEvent | null {
  if (!isWebNotify(verb, result)) return null;
  return {
    level: 'critical',
    cue: { kind: result === 'failure' ? 'failed' : 'critical', verb, actor: actorName, target: targetName },
    destination: AUDIT_LOG_DESTINATION,
  };
}

/** True when a participation submitted at bot-like speed in the last minute. */
export function isSubmitBurst(submissionsLastMinute: number): boolean {
  return submissionsLastMinute >= SUBMIT_BURST_PER_MINUTE;
}
