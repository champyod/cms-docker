import { useEffect } from 'react';

interface UseTableAutoRefreshOptions {
  enabled?: boolean;
  intervalMs?: number;
  onRefresh: () => void | Promise<void>;
}

export function useTableAutoRefresh({ enabled = true, intervalMs = 60000, onRefresh }: UseTableAutoRefreshOptions) {
  useEffect(() => {
    if (!enabled) return;

    const id = setInterval(() => {
      void onRefresh();
    }, intervalMs);

    return () => clearInterval(id);
  }, [enabled, intervalMs, onRefresh]);
}
