// Why its own module and no imports: the scope vocabulary is read by a client
// component, so it must not pull in a server-only dependency (the IP validator
// reaches node:net). The 'use server' action that writes an exemption may only
// export async functions, so the vocabulary cannot live there either.
export const EXEMPTION_SCOPES = ['account_address', 'account', 'address'] as const;
export type ExemptionScope = (typeof EXEMPTION_SCOPES)[number];

// The panel's stand-in for a loopback client (see auth.ts); an exemption may name
// it, because that is the address a lockout records on those deployment paths.
export const LOOPBACK_IP = 'local';

/**
 * The ledger identity an exemption scope maps to. The dimension the scope does
 * not cover is blank, and a blank dimension is the wildcard when it is matched.
 */
export function exemptionIdentity(scope: ExemptionScope, username: string, ip: string): { subject: string | null; ip: string | null } {
  return {
    subject: scope === 'address' ? null : username.trim(),
    ip: scope === 'account' ? null : ip.trim(),
  };
}
