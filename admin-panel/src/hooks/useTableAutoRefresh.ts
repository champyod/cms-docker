import { useEffect, useRef } from 'react';

interface UseTableAutoRefreshOptions {
  enabled?: boolean;
  intervalMs?: number;
  onRefresh: () => void | Promise<void>;
}

export function useTableAutoRefresh({ enabled = true, intervalMs = 60000, onRefresh }: UseTableAutoRefreshOptions) {
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => { onRefreshRef.current = onRefresh; });
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => void onRefreshRef.current(), intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs]);
}
