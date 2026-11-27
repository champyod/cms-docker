import { headers } from 'next/headers';

const FORWARDED_FOR_HEADER = 'x-forwarded-for';
const REAL_IP_HEADER = 'x-real-ip';
const LOCAL_ADDRESS = 'local';

/** The header the front proxy stamps on every request it forwards. */
export const FORWARDED_TRUST_HEADER = 'x-cms-trusted-proxy';

/** Environment key holding the marker the proxy must present. */
export const FORWARDED_TRUST_ENV = 'FORWARDED_TRUST_MARKER';

/**
 * The address the nearest proxy asserted for the caller, read from a chain this
 * surface is entitled to believe.
 *
 * This picks a hop; it does not decide whether the chain is trustworthy — that is
 * resolveForwardedAddress's gate, and callers must go through it.
 *
 * WHY the rightmost hop: the vhosts that append keep whatever the caller sent in front
 * of the address our own proxy appended, so the first entry is caller-supplied and
 * would let a caller pick its own rate-limit bucket. The rightmost hop is the one the
 * nearest proxy wrote, and X-Real-IP is the address every vhost in this stack asserts
 * from $remote_addr for the same request — it survives a path that carries no
 * forwarded chain.
 */
export function parseForwardedFor(
  forwardedFor: string | null,
  realIp: string | null = null,
): string {
  const asserted = rightmostHop(forwardedFor) ?? rightmostHop(realIp);
  return asserted ?? LOCAL_ADDRESS;
}

/**
 * The forwarded address, read only from a request the proxy marked.
 *
 * The forwarded headers are caller-supplied and a direct caller can send either of
 * them, so on their own they would let whoever reaches the panel choose the bucket its
 * attempts are counted in and the address its audit rows record. The front proxy
 * therefore stamps FORWARDED_TRUST_HEADER on what it forwards, and a request whose
 * marker does not match the configured one is read as the local sentinel instead of its
 * chain — failing closed, because a request nobody stands behind has no caller to name.
 *
 * WHY a marker rather than the peer address: a Next server action reaches the handler
 * with headers only, so there is no socket peer to compare against. The marker is the
 * only evidence of a proxy this surface can be given, which is why it must be a value a
 * caller cannot guess and lives in the environment, never in a committed file.
 */
export function resolveForwardedAddress(
  requestHeaders: Headers,
  configuredMarker: string | null | undefined,
): string {
  if (!isMarked(requestHeaders, configuredMarker)) return LOCAL_ADDRESS;
  return parseForwardedFor(
    requestHeaders.get(FORWARDED_FOR_HEADER),
    requestHeaders.get(REAL_IP_HEADER),
  );
}

/** Whether this request carries the marker the configured proxy stamps. */
function isMarked(requestHeaders: Headers, configuredMarker: string | null | undefined): boolean {
  const expected = configuredMarker?.trim();
  if (!expected) return false;
  return requestHeaders.get(FORWARDED_TRUST_HEADER)?.trim() === expected;
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
  return resolveForwardedAddress(requestHeaders, process.env[FORWARDED_TRUST_ENV]);
}
