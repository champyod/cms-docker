import type { ConfirmationRequest } from '@/lib/confirmation-copy';

export interface PendingConfirmation extends ConfirmationRequest {
  id: number;
}

type ConfirmationListener = () => void;
type ConfirmationResolve = (confirmed: boolean) => void;

let nextId = 1;
let pending: PendingConfirmation | null = null;
let resolvePending: ConfirmationResolve | null = null;
const listeners = new Set<ConfirmationListener>();

function notify(): void {
  listeners.forEach((listener): void => listener());
}

export function subscribeToConfirmation(listener: ConfirmationListener): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}

export function getPendingConfirmation(): PendingConfirmation | null {
  return pending;
}

// Why: the panel never asks for confirmation while rendering on the server, so the server
// snapshot is always "nothing pending" and the first client render matches the HTML.
export function getServerPendingConfirmation(): null {
  return null;
}

/**
 * Opens the confirmation dialog and resolves once the user answers.
 *
 * Why a module-level store rather than React state: callers must be able to `await` the answer
 * inside an ordinary async handler, exactly like the synchronous `confirm()` it replaces.
 */
export function requestConfirmation(request: ConfirmationRequest): Promise<boolean> {
  // The dialog is modal, so a request arriving while another is pending was never on screen;
  // treat that unseen request as unconfirmed instead of queueing an invisible prompt.
  if (resolvePending) return Promise.resolve(false);
  return new Promise<boolean>((resolve): void => {
    resolvePending = resolve;
    pending = { id: nextId++, ...request };
    notify();
  });
}

/** Answers the open dialog. The promise resolves after listeners see the closed state. */
export function settleConfirmation(confirmed: boolean): void {
  const resolve = resolvePending;
  resolvePending = null;
  pending = null;
  notify();
  if (resolve) resolve(confirmed);
}
