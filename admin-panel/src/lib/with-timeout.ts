/**
 * A bound on how long a panel read may take.
 *
 * WHY this exists: a read that never settles leaves a surface on "Loading" for as long as
 * the browser waits, which reads as a broken panel rather than a slow one. Rejecting after
 * a bound turns that into the error surface the caller already has for a failed read.
 */

/** How long a panel read may take before it is reported as a failure rather than Loading. */
export const PANEL_READ_TIMEOUT_MS = 10_000;

/** Rejects when `work` has not settled within `milliseconds`, with `message` as the reason. */
export function withTimeout<T>(work: Promise<T>, milliseconds: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout((): void => reject(new Error(message)), milliseconds);
    void work.then(
      (value: T): void => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown): void => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
