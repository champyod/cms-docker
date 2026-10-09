import { describe, expect, it } from 'vitest';

import { DEFAULT_ALERT_LIMIT, parseWafAuditEntries } from '@/lib/security/waf-audit-log';

interface MessageFixture {
  details: { ruleId?: string; msg?: string; data?: string };
}

interface TransactionFixture {
  unique_id?: string;
  time_stamp?: string;
  client_ip?: string;
  is_interrupted?: boolean;
  request?: { uri?: string };
  audit_data?: { messages?: MessageFixture[] };
  messages?: MessageFixture[];
}

function auditLine(transaction: TransactionFixture, wrapped = true): string {
  return JSON.stringify(wrapped ? { transaction } : transaction);
}

const WRAPPED: TransactionFixture = {
  unique_id: 'abc-1',
  time_stamp: '2026-10-09T10:00:00Z',
  client_ip: '203.0.113.9',
  is_interrupted: true,
  request: { uri: '/api/submissions' },
  audit_data: {
    messages: [
      { details: { ruleId: '942100', msg: 'SQL Injection Attack Detected' } },
      { details: { ruleId: '949110', msg: 'Inbound Anomaly Score Exceeded', data: 'Inbound Anomaly Score: 11' } },
    ],
  },
};

describe('parseWafAuditEntries', () => {
  it('reads a wrapped JSON audit entry', () => {
    const result = parseWafAuditEntries(auditLine(WRAPPED));

    expect(result.skippedLines).toBe(0);
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0]).toEqual({
      id: 'abc-1',
      timestamp: '2026-10-09T10:00:00Z',
      clientIp: '203.0.113.9',
      uri: '/api/submissions',
      ruleIds: ['942100', '949110'],
      anomalyScore: 11,
      blocked: true,
      messages: ['SQL Injection Attack Detected', 'Inbound Anomaly Score Exceeded'],
    });
  });

  it('accepts a bare transaction object as well', () => {
    const result = parseWafAuditEntries(auditLine({ ...WRAPPED, is_interrupted: false }, false));

    expect(result.alerts[0]?.id).toBe('abc-1');
    expect(result.alerts[0]?.blocked).toBe(false);
  });

  it('counts a native-format log as skipped instead of guessing', () => {
    const native = ['--a1b2c3-A--', '[09/Oct/2026:10:00:00 +0000] abc 203.0.113.9', 'GET / HTTP/1.1'].join('\n');

    expect(parseWafAuditEntries(native)).toEqual({ alerts: [], skippedLines: 3 });
  });

  it('returns the newest alerts first and respects the limit', () => {
    const raw = [1, 2, 3, 4, 5]
      .map((index) => auditLine({ ...WRAPPED, unique_id: `id-${index}` }))
      .join('\n');

    const result = parseWafAuditEntries(raw, 2);

    expect(result.alerts.map((alert) => alert.id)).toEqual(['id-5', 'id-4']);
  });

  it('handles empty input and the default limit', () => {
    expect(parseWafAuditEntries('')).toEqual({ alerts: [], skippedLines: 0 });
    expect(DEFAULT_ALERT_LIMIT).toBeGreaterThan(0);
  });
});
