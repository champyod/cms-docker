'use client';

import { useCallback, useState } from 'react';

/**
 * Whether the surface's self-starting motion is stopped. The ambient field and the
 * shake both read it, so one control quiets the whole screen; the countdown itself
 * keeps ticking, because it reports a real deadline rather than decorating one.
 *
 * Kept apart from the timing hooks so a consumer that only needs the motion switch
 * does not pull in the server actions behind them.
 */
export function useContestMotion(): { isPaused: boolean; togglePaused: () => void } {
  const [isPaused, setIsPaused] = useState(false);
  const togglePaused = useCallback((): void => setIsPaused((current) => !current), []);
  return { isPaused, togglePaused };
}
