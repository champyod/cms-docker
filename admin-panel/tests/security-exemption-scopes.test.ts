import { describe, expect, it } from 'vitest';

import { EXEMPTION_SCOPES, exemptionIdentity } from '@/lib/security/exemption-scopes';
import { exemptionError } from '@/lib/security/exemption-validation';

describe('exemptionIdentity', () => {
  it('maps each scope to a ledger identity, the uncovered dimension blank', () => {
    expect(exemptionIdentity('account_address', 'ada', '10.0.0.9')).toEqual({ subject: 'ada', ip: '10.0.0.9' });
    expect(exemptionIdentity('account', 'ada', '10.0.0.9')).toEqual({ subject: 'ada', ip: null });
    expect(exemptionIdentity('address', 'ada', '10.0.0.9')).toEqual({ subject: null, ip: '10.0.0.9' });
  });

  it('trims the values it stores', () => {
    expect(exemptionIdentity('account_address', '  ada ', ' 10.0.0.9 ')).toEqual({ subject: 'ada', ip: '10.0.0.9' });
  });

  it('exposes exactly the three scopes', () => {
    expect([...EXEMPTION_SCOPES]).toEqual(['account_address', 'account', 'address']);
  });
});

describe('exemptionError', () => {
  it('accepts a well-formed request for each scope, including the loopback sentinel', () => {
    expect(exemptionError('account_address', 'ada', '10.0.0.9')).toBeNull();
    expect(exemptionError('account', 'ada', '')).toBeNull();
    expect(exemptionError('address', '', '10.0.0.9')).toBeNull();
    expect(exemptionError('address', '', 'local')).toBeNull();
  });

  it('requires the fields the scope covers', () => {
    expect(exemptionError('account_address', '', '10.0.0.9')).toBe('A username is required for this scope');
    expect(exemptionError('account_address', 'ada', '')).toBe('An address is required for this scope');
  });

  it('refuses a malformed address', () => {
    expect(exemptionError('address', '', 'not-an-ip')).toBe('Not a valid IP address');
  });
});
