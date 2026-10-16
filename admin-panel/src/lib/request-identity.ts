import { headers } from 'next/headers';

const FORWARDED_FOR_HEADER = 'x-forwarded-for';
const REAL_IP_HEADER = 'x-real-ip';
const LOCAL_ADDRESS = 'local';

/**
 * The address the nearest proxy asserted for the caller, resolved in one place so
 * the login buckets and the audit log can never disagree.
 *
 * WHY the leftmost hop is never read: the vhosts that append (the primary and every
 * generated route) keep whatever the caller sent in front of the address our own
 * proxy appended, so the first entry is caller-supplied and would let a caller pick
 * its own rate-limit bucket. The rightmost hop is the one the nearest proxy wrote,
 * and X-Real-IP is the address every vhost in this stack asserts from $remote_addr
 * for the same request — it survives a path that carries no forwarded chain. Only a
 * request that reaches the panel with neither header has no caller to name, and that
 * one is the local sentinel rather than a shared address.
 */
export function parseForwardedFor(
  forwardedFor: string | null,
  realIp: string | null = null,
): string {
  const asserted = rightmostHop(forwardedFor) ?? rightmostHop(realIp);
  return asserted ?? LOCAL_ADDRESS;
}

/** The last non-empty entry of a comma-joined chain: the hop the nearest proxy appended. */
function rightmostHop(value: string | null): string | null {
  if (value === null) return null;
  const hops = value.split(',');
  for (let index = hops.length - 1; index >= 0; index -= 1) {
    const hop = hops[index].trim();
    if (hop !== '') return hop;
  }
  return null;
}

export async function resolveClientIp(): Promise<string> {
  const requestHeaders = await headers();
  return parseForwardedFor(
    requestHeaders.get(FORWARDED_FOR_HEADER),
    requestHeaders.get(REAL_IP_HEADER),
  );
}
