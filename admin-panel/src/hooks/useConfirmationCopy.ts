'use client';

import { useMemo } from 'react';

import { useDictionary } from '@/hooks/useDictionary';
import { buildConfirmationCopy, type ConfirmationCopy } from '@/lib/confirmation-copy';

/**
 * The confirmation builders for the active locale.
 *
 * Why memoised: callers use these inside `useCallback`/handler closures, so the identity has to stay
 * stable across renders of a component that never changes locale.
 */
export function useConfirmationCopy(): ConfirmationCopy {
  const confirmations = useDictionary().confirmations;
  return useMemo(() => buildConfirmationCopy(confirmations), [confirmations]);
}
