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
]);

// Sensitive verbs whose FAILURE is also critical (possible break-in attempt).
const SENSITIVE_FAILURE_VERBS: ReadonlySet<string> = new Set([
  'password:reveal',
  'override:set',
  'admin_groups:set',
  'admin:delete',
]);

// Verbs whose every occurrence also pages Discord. Everything else critical
// stays on the web bell so deploys and restarts do not page anyone.
export const DISCORD_SENSITIVE_VERBS: ReadonlySet<string> = new Set([
  ...SENSITIVE_FAILURE_VERBS,
  'override:clear',
]);

export const SUBMIT_BURST_PER_MINUTE = 20;
export const REVEAL_BURST_COUNT = 5;
export const REVEAL_BURST_WINDOW_MINUTES = 5;
export const ENROL_BURST_COUNT = 10;
export const ENROL_BURST_WINDOW_MINUTES = 5;
export const NOTIFICATION_COOLDOWN_MS = 15 * 60 * 1000;

export interface NotificationEvent {
  level: 'critical' | 'warning';
  title: string;
  detail: string;
}

/** True when an audit row must push immediately (critical success or sensitive failure). */
export function isCriticalAuditEvent(verb: string, result: AuditResult): boolean {
  if (result === 'success' && CRITICAL_AUDIT_VERBS.has(verb)) return true;
  if (result === 'failure' && SENSITIVE_FAILURE_VERBS.has(verb)) return true;
  return false;
}

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

/** Human frame for a critical audit row; null when the row is not push-worthy. */
export function classifyAuditEvent(
  verb: string,
  entity: string,
  entityId: string | null,
  result: AuditResult,
  actorId: number | null,
): NotificationEvent | null {
  if (!isCriticalAuditEvent(verb, result)) return null;
  const target = entityId === null ? entity : `${entity} #${entityId}`;
  const actor = actorId === null ? 'system' : `admin #${actorId}`;
  if (result === 'failure') {
    return {
      level: 'critical',
      title: `Failed sensitive action: ${verb}`,
      detail: `${actor} failed ${verb} on ${target}`,
    };
  }
  return {
    level: 'critical',
    title: `Critical action: ${verb}`,
    detail: `${actor} ran ${verb} on ${target}`,
  };
}

/** Name-aware frame for a published row; null when the row stays off the bell. */
export function classifyAuditEventWithNames(
  verb: string,
  result: AuditResult,
  actorName: string,
  targetName: string,
): NotificationEvent | null {
  if (!isWebNotify(verb, result)) return null;
  if (result === 'failure') {
    return {
      level: 'critical',
      title: `Failed critical action: ${verb}`,
      detail: `${actorName} failed ${verb} on ${targetName}`,
    };
  }
  return {
    level: 'critical',
    title: `Critical action: ${verb}`,
    detail: `${actorName} ran ${verb} on ${targetName}`,
  };
}

/** True when a participation submitted at bot-like speed in the last minute. */
export function isSubmitBurst(submissionsLastMinute: number): boolean {
  return submissionsLastMinute >= SUBMIT_BURST_PER_MINUTE;
}
