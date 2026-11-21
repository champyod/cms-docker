import 'server-only';

import { findActiveLoginExemption } from '@/lib/security/block-ledger';

/**
 * Whether a login attempt by *username* from *ip* is exempt.
 *
 * An exemption is a permanent lift, not a reset: it holds until an operator
 * revokes it, and it waives both the lockout and the adaptive captcha. It is
 * deliberately not a counter — resetting the counters is "unlock", which the
 * account can re-earn; this is the standing "never police this identity" case.
 */
export async function isLoginExempt(username: string, ip: string): Promise<boolean> {
  return (await findActiveLoginExemption(username, ip)) !== null;
}
