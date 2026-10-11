import { useCallback, useEffect, useRef } from 'react';

interface UseDebouncedSearchOptions {
  value: string;
  delayMs?: number;
  onApply: (value: string) => void | Promise<void>;
}

export type ApplySearch = (value: string) => void;

export function useDebouncedSearch({ value, delayMs = 300, onApply }: UseDebouncedSearchOptions): ApplySearch {
  const onApplyRef = useRef(onApply);
  useEffect(() => { onApplyRef.current = onApply; }, [onApply]);

  const appliedRef = useRef(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPending = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const applyNow = useCallback((next: string): void => {
    clearPending();
    appliedRef.current = next;
    void onApplyRef.current(next);
  }, [clearPending]);

  useEffect(() => {
    if (value === appliedRef.current) return;
    timerRef.current = setTimeout(() => applyNow(value), delayMs);
    return clearPending;
  }, [value, delayMs, applyNow, clearPending]);

  useEffect(() => clearPending, [clearPending]);

  return applyNow;
}
