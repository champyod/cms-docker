import { describe, expect, it } from 'vitest';
import {
  CRITICAL_AUDIT_VERBS,
  classifyAuditEvent,
  isCriticalAuditEvent,
  isDiscordNotify,
  isSubmitBurst,
  isWebNotify,
  SUBMIT_BURST_PER_MINUTE,
} from '@/lib/notification-events';

describe('notification events', () => {
  it('flags critical verbs on success', () => {
    expect(isCriticalAuditEvent('admin:delete', 'success')).toBe(true);
    expect(isCriticalAuditEvent('deployment:deploy', 'success')).toBe(true);
    expect(isCriticalAuditEvent('override:set', 'success')).toBe(true);
  });

  it('flags sensitive failures as possible break-ins', () => {
    expect(isCriticalAuditEvent('password:reveal', 'failure')).toBe(true);
    expect(isCriticalAuditEvent('password:reveal', 'success')).toBe(false);
  });

  it('ignores routine verbs', () => {
    expect(isCriticalAuditEvent('contest:list', 'success')).toBe(false);
    expect(isCriticalAuditEvent('user:update', 'success')).toBe(false);
    expect(isCriticalAuditEvent('user:update', 'failure')).toBe(false);
  });

  it('classifies with actor and target detail', () => {
    const event = classifyAuditEvent('admin:delete', 'admin', '7', 'success', 1);
    expect(event?.level).toBe('critical');
    expect(event?.detail).toContain('admin #1');
    expect(event?.detail).toContain('admin #7');
    expect(classifyAuditEvent('user:list', 'user', null, 'success', 1)).toBeNull();
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
      'tls:renew:queue',
    ]);
    for (const verb of CRITICAL_AUDIT_VERBS) {
      expect(keys.has(verb) || auditOnlyVerbs.has(verb)).toBe(true);
    }
  });
});
