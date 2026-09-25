import { notFound } from 'next/navigation';
import { AuthorizationError } from '@/lib/server/authorization';

// Why: route params arrive as strings, and parseInt would accept prefixes
// like "12abc" — the regex admits only canonical positive integer ids.
export function parseRecordId(rawId: string): number | null {
  if (!/^[1-9]\d*$/.test(rawId)) return null;
  const parsed = Number(rawId);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

// Why: a missing row and a 403 both render as "not found" so record
// existence stays hidden from unauthorized readers, while 401 and
// unexpected errors propagate to the session layout and error boundary.
export async function readRecordOrNotFound<T>(read: () => Promise<T | null>): Promise<T> {
  try {
    const result = await read();
    if (!result) notFound();
    return result;
  } catch (error: unknown) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }
}
