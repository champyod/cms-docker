import { headers } from 'next/headers';

const FORWARDED_FOR_HEADER = 'x-forwarded-for';
const REAL_IP_HEADER = 'x-real-ip';
const LOCAL_ADDRESS = 'local';

/**
 * The client address the trusted edge reports: X-Real-IP when the edge sets it,
 * otherwise the last X-Forwarded-For entry, otherwise the local sentinel.
 *
 * WHY X-Real-IP first: every vhost sets it to the connection's own remote
 * address and overwrites whatever arrived, so it is the one value a caller
 * cannot choose. The login buckets and the audit log both derive from here, so
 * they cannot disagree about which address an action came from.
 *
 * WHY the last forwarded hop and not the first: the edge appends the address
 * it observed, so the rightmost entry is the one it added. The first entry is
 * whatever the caller sent, which would let a caller pick its own rate-limit
 * bucket — and on a path where no header arrives at all, the first entry used
 * to be the proxy's own address, which merged unrelated clients into one bucket.
 */
export function parseForwardedFor(forwardedFor: string | null): string {
  const hops = forwardedFor
    ?.split(',')
    .map((hop) => hop.trim())
    .filter((hop) => hop.length > 0);
  return hops?.[hops.length - 1] ?? LOCAL_ADDRESS;
}

/** The address as a trusted edge reports it, preferring the unspoofable header. */
export function parseClientAddress(realIp: string | null, forwardedFor: string | null): string {
  const direct = realIp?.trim();
  return direct !== undefined && direct.length > 0 ? direct : parseForwardedFor(forwardedFor);
}

export async function resolveClientIp(): Promise<string> {
  const requestHeaders = await headers();
  return parseClientAddress(
    requestHeaders.get(REAL_IP_HEADER),
    requestHeaders.get(FORWARDED_FOR_HEADER),
  );
}
