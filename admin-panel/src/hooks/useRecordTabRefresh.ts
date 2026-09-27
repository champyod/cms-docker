'use client';

import { useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Why: useRouter throws without an AppRouter provider, which unit tests do
// not mount — so the router is captured once by a registrar the record layout
// mounts, while the record headers stay stable null-safe readers. One handle
// serves every record, so a save anywhere refreshes through the same path.
let recordTabRefreshImpl: (() => void) | null = null;

export function useRecordTabRefresh(): () => void {
  return useCallback((): void => {
    recordTabRefreshImpl?.();
  }, []);
}

// Why: server-rendered under the real AppRouter, effects register the refresh
// on hydration — test renders never mount the layout, so they never throw.
export function RecordTabRefreshRegistrar(): null {
  const router = useRouter();
  useEffect(() => {
    recordTabRefreshImpl = (): void => router.refresh();
    return (): void => {
      recordTabRefreshImpl = null;
    };
  }, [router]);
  return null;
}
