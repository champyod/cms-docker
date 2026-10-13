import { headers } from 'next/headers';

const FORWARDED_FOR_HEADER = 'x-forwarded-for';
const LOCAL_ADDRESS = 'local';

/**
 * The client address the proxy reports: the first X-Forwarded-For hop, or the
 * local sentinel. Shared so the login buckets and the audit log cannot disagree
 * about which address an action came from.
 */
export function parseForwardedFor(forwardedFor: string | null): string {
  return forwardedFor?.split(',')[0]?.trim() ?? LOCAL_ADDRESS;
}

export async function resolveClientIp(): Promise<string> {
  const requestHeaders = await headers();
  return parseForwardedFor(requestHeaders.get(FORWARDED_FOR_HEADER));
}
