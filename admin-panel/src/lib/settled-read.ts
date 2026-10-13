/** How long a single surface read may stay pending before it is reported as failed. */
export const READ_TIMEOUT_MS = 15_000;

export interface ReadFailure {
  readonly label: string;
  readonly error: string;
}

export interface ReadOutcome<T> {
  readonly value: T | null;
  readonly failure: ReadFailure | null;
}

function describeReadError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Resolves one read to its value or a named failure, and never waits past `timeoutMs`.
 *
 * Why per-read: a read that rejects or cannot finish at all must not hold the whole surface on
 * "Loading" — each one ends here so the caller can render the parts it has and name the ones
 * that failed.
 */
export async function settleRead<T>(
  label: string,
  read: () => Promise<T>,
  timeoutMs: number = READ_TIMEOUT_MS,
): Promise<ReadOutcome<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`did not finish within ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    const value = await Promise.race([read(), expiry]);
    return { value, failure: null };
  } catch (error) {
    return { value: null, failure: { label, error: describeReadError(error) } };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The failures across a group of settled reads, in the order the reads were written. */
export function readFailures(outcomes: readonly ReadOutcome<unknown>[]): readonly ReadFailure[] {
  return outcomes.flatMap((outcome) => (outcome.failure === null ? [] : [outcome.failure]));
}
