'use client';

import { useContext, useMemo } from 'react';
import { DictionaryContext } from '@/hooks/useDictionary';
import { useRecordTabRefresh } from '@/hooks/useRecordTabRefresh';
import { buildConfirmationCopy, type ConfirmationCopy } from '@/lib/confirmation-copy';
import en from '@/dictionaries/en.json';

// Why the alias: the task tab actions keep their own name while reading the one
// shared refresh handle every record layout registers.
export function useTaskTabRefresh(): () => void {
  return useRecordTabRefresh();
}

// Why: useConfirmationCopy throws without a DictionaryProvider, which unit
// tests do not mount — reading the context directly with an English fallback
// keeps the same localized copy in production and a static copy in tests.
export function useTaskConfirmationCopy(): ConfirmationCopy {
  const dictionary = useContext(DictionaryContext);
  return useMemo(
    () => buildConfirmationCopy((dictionary ?? en).confirmations),
    [dictionary],
  );
}
