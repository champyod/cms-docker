'use client';

import { useCallback, useContext, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { DictionaryContext } from '@/hooks/useDictionary';
import { buildConfirmationCopy, type ConfirmationCopy } from '@/lib/confirmation-copy';
import en from '@/dictionaries/en.json';

// Why: useRouter throws without an AppRouter provider, which unit tests do
// not mount — so the router is captured once by a registrar the Task layout
// mounts, while tab hooks stay stable null-safe readers.
let taskTabRefreshImpl: (() => void) | null = null;

export function useTaskTabRefresh(): () => void {
  return useCallback((): void => {
    taskTabRefreshImpl?.();
  }, []);
}

// Why: server-rendered under the real AppRouter, effects register the refresh
// on hydration — test renders never mount the layout, so they never throw.
export function TaskTabRefreshRegistrar(): null {
  const router = useRouter();
  useEffect(() => {
    taskTabRefreshImpl = (): void => router.refresh();
    return (): void => {
      taskTabRefreshImpl = null;
    };
  }, [router]);
  return null;
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
