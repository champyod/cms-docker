'use client';

import { useCallback, useSyncExternalStore } from 'react';

import type { ConfirmationRequest } from '@/lib/confirmation-copy';
import {
  getPendingConfirmation,
  getServerPendingConfirmation,
  requestConfirmation,
  subscribeToConfirmation,
  type PendingConfirmation,
} from '@/lib/confirmation-store';

export type Confirm = (request: ConfirmationRequest) => Promise<boolean>;

/**
 * Asks the user to confirm an action and resolves `true` only if they explicitly confirm.
 *
 * Usage: `if (!(await confirm(destructiveConfirm('team')))) return;`
 *
 * Why a hook over the raw store call: it keeps components from depending on the store module and
 * gives the handler a stable identity across renders.
 */
export function useConfirm(): Confirm {
  return useCallback((request: ConfirmationRequest): Promise<boolean> => requestConfirmation(request), []);
}

/** The confirmation the dialog is currently showing, if any. */
export function usePendingConfirmation(): PendingConfirmation | null {
  return useSyncExternalStore(subscribeToConfirmation, getPendingConfirmation, getServerPendingConfirmation);
}
