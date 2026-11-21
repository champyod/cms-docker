'use client';

/** One pending record-level requeue: either waiting on the worker, or timed out and awaiting a retry. */
export type SubmissionQueueState =
  | { readonly kind: 'queued'; readonly queuedAt: number }
  | { readonly kind: 'timeout'; readonly retry: () => Promise<void> };

let state: SubmissionQueueState | null = null;
const listeners = new Set<() => void>();

export function getSubmissionQueueState(): SubmissionQueueState | null {
  return state;
}

export function subscribeSubmissionQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setSubmissionQueue(next: SubmissionQueueState | null): void {
  state = next;
  listeners.forEach((listener) => listener());
}

export function queueForWorker(): void {
  setSubmissionQueue({ kind: 'queued', queuedAt: Date.now() });
}

export function getServerSubmissionQueueState(): null {
  return null;
}
