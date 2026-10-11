'use client';

import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';

/**
 * Full screen for one element. Kept apart from the timing hooks so a consumer that only
 * needs the screen state does not pull in the server actions behind them.
 */
export function useElementFullscreen<T extends HTMLElement>(
  elementRef: RefObject<T | null>,
): { isFullscreen: boolean; toggle: () => void } {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleChange = (): void => setIsFullscreen(document.fullscreenElement === elementRef.current);
    document.addEventListener('fullscreenchange', handleChange);
    return () => document.removeEventListener('fullscreenchange', handleChange);
  }, [elementRef]);

  const toggle = useCallback((): void => {
    const element = elementRef.current;
    if (!element) return;
    const action = document.fullscreenElement === element ? document.exitFullscreen() : element.requestFullscreen();
    action.catch((error: unknown) => console.error('Fullscreen toggle failed:', error));
  }, [elementRef]);

  return { isFullscreen, toggle };
}
