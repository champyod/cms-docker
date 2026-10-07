'use client';

import { useCallback, useContext, useMemo, useRef } from 'react';

import en from '@/dictionaries/en.json';
import { DictionaryContext } from '@/hooks/useDictionary';
import { buildConfirmationCopy, type ConfirmationRequest } from '@/lib/confirmation-copy';

export type DismissReason = 'escape' | 'backdrop' | 'close' | 'route';

export interface UnsavedChangesGuard {
  readonly requestClose: (reason: DismissReason) => void;
  readonly markClean: () => void;
}

/**
 * Gates a surface's dismissal on the reader confirming that unsaved work is lost.
 *
 * Why the confirmation store rather than a native prompt: the store already owns
 * one dialog, one copy shape per kind, and the translated sentences, so this hook
 * never has to invent a second way to ask.
 *
 * Why the dictionary falls back to English when no provider is mounted: the
 * confirmation only ever appears inside the authenticated shell, but the dialogs
 * that use this hook are also rendered by unit tests and by the storybook-style
 * markup helpers, and a throw there would replace a testable dialog with a
 * crashing one.
 */
export function useUnsavedChangesGuard(
  isDirty: boolean,
  confirm: (request: ConfirmationRequest) => Promise<boolean>,
  onClose: () => void,
): UnsavedChangesGuard {
  const dictionary = useContext(DictionaryContext);
  const copy = useMemo(() => buildConfirmationCopy((dictionary ?? en).confirmations), [dictionary]);
  const isCleanRef = useRef(false);
  const openReasonRef = useRef<DismissReason | null>(null);

  const markClean = useCallback((): void => {
    isCleanRef.current = true;
  }, []);

  const requestClose = useCallback((reason: DismissReason): void => {
    // Why the latch: two dismissals in a row would otherwise open a second
    // prompt for the same unsaved work, and the second answer would be about a
    // dialog the reader never saw.
    if (openReasonRef.current !== null) return;
    if (!isDirty || isCleanRef.current) {
      onClose();
      return;
    }
    openReasonRef.current = reason;
    void confirm(copy.discardUnsavedChangesConfirm()).then((confirmed) => {
      openReasonRef.current = null;
      if (!confirmed) return;
      isCleanRef.current = true;
      onClose();
    });
  }, [confirm, copy, isDirty, onClose]);

  return { requestClose, markClean };
}
