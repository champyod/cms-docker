import { LOOPBACK_IP, type ExemptionScope } from '@/lib/security/exemption-scopes';
import { isValidIpAddress } from '@/lib/security/security-agent-protocol';

/**
 * The reason an exemption cannot be recorded as asked, or null when it can.
 *
 * Kept apart from the scope vocabulary: this reads the IP validator, which
 * reaches node:net, and the vocabulary is imported by a client component.
 */
export function exemptionError(scope: ExemptionScope, username: string, ip: string): string | null {
  const address = ip.trim();
  if (scope !== 'address' && username.trim().length === 0) return 'A username is required for this scope';
  if (scope === 'account') return null;
  if (address.length === 0) return 'An address is required for this scope';
  if (address !== LOOPBACK_IP && !isValidIpAddress(address)) return 'Not a valid IP address';
  return null;
}
