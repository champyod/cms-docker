import { describe, expect, it } from 'vitest';
import {
  CRITICAL_AUDIT_VERBS,
  classifyAuditEventWithNames,
  isDiscordNotify,
  isSubmitBurst,
  isWebNotify,
  SUBMIT_BURST_PER_MINUTE,
} from '@/lib/notification-events';

describe('notification events', () => {
  it('frames a critical success as the parts of the event, not as a sentence', () => {
    const event = classifyAuditEventWithNames('admin:delete', 'success', 'Ada', 'admin #7');
    expect(event?.level).toBe('critical');
    // Why the parts: the sentence is the reader's dictionary's to write, so the frame may not carry one.
    expect(event?.cue).toEqual({ kind: 'critical', verb: 'admin:delete', actor: 'Ada', target: 'admin #7' });
  });

  it('distinguishes a sensitive failure from a critical success', () => {
    const failed = classifyAuditEventWithNames('override:set', 'failure', 'system', 'contest #3');
    expect(failed?.cue.kind).toBe('failed');
    const succeeded = classifyAuditEventWithNames('override:set', 'success', 'system', 'contest #3');
    expect(succeeded?.cue.kind).toBe('critical');
  });

  it('leaves routine verbs off the bell', () => {
    expect(classifyAuditEventWithNames('user:list', 'success', 'Ada', 'user #7')).toBeNull();
    expect(classifyAuditEventWithNames('contest:list', 'success', 'Ada', 'contest #1')).toBeNull();
  });

  it('names the audit log as the destination of the alert it frames', () => {
    expect(classifyAuditEventWithNames('admin:delete', 'success', 'Ada', 'admin #7')?.destination).toBe('administration.audit');
  });

  it('detects submit bursts at the threshold', () => {
    expect(isSubmitBurst(SUBMIT_BURST_PER_MINUTE)).toBe(true);
    expect(isSubmitBurst(SUBMIT_BURST_PER_MINUTE - 1)).toBe(false);
  });

  it('sends all critical verbs to web on both results', () => {
    expect(isWebNotify('deployment:deploy', 'success')).toBe(true);
    expect(isWebNotify('deployment:deploy', 'failure')).toBe(true);
  });

  it('keeps password reveal failure on web, success off web', () => {
    expect(isWebNotify('password:reveal', 'failure')).toBe(true);
    expect(isWebNotify('password:reveal', 'success')).toBe(false);
  });

  it('restricts discord to the sensitive set', () => {
    expect(isDiscordNotify('deployment:deploy', 'success')).toBe(false);
    expect(isDiscordNotify('override:set', 'success')).toBe(true);
    expect(isDiscordNotify('password:reveal', 'failure')).toBe(true);
    expect(isDiscordNotify('password:reveal', 'success')).toBe(false);
  });

  it('keeps every critical verb inside the registry or documents it as audit-only', async () => {
    const { PERMISSION_REGISTRY } = await import('@/lib/permission-registry');
    const keys = new Set(PERMISSION_REGISTRY.map((d) => d.key));
    // Why the exceptions: group membership changes audit as admin_groups:set and
    // override removals as override:clear — recordAudit verbs rather than permission
    // keys (gated by group:assign and override:set respectively). A backup schedule
    // edit is the same shape: one permission covers three verbs, because creating,
    // changing and removing a schedule are all gated by backup:schedule (or
    // backup:delete), so the verbs name the action rather than a key.
    // Why the security verbs: each one names the action it performed (WAF config
    // write, WAF recreate, unban queue, lockout release, renewal queue) while the
    // gate is the surface key — waf:config, waf:control, ban:unban, lockout:unlock
    // or tls:renew — so no single verb maps onto a permission key.
    const auditOnlyVerbs = new Set([
      'admin_groups:set',
      'override:clear',
      'backup_schedule:create',
      'backup_schedule:update',
      'backup_schedule:delete',
      'waf:config:update',
      'waf:control:apply',
      'waf:control:restart',
      'ban:unban:queue',
      'lockout:unlock',
      // Granting an exemption audits as lockout:exempt (a registry key); revoking
      // it names the inverse action while the gate stays lockout:exempt.
      'lockout:exempt:revoke',
      'tls:renew:queue',
    ]);
    for (const verb of CRITICAL_AUDIT_VERBS) {
      expect(keys.has(verb) || auditOnlyVerbs.has(verb)).toBe(true);
    }
  });
});
