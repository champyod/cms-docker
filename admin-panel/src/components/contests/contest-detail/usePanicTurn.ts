'use client';

import { useEffect, useState } from 'react';
import { PANIC_VARIANT_INTERVAL_MS } from '@/lib/contest-panic';

/**
 * Steps the panic through its cast of shakes, so the timer struggles in more than one
 * direction rather than thudding along a single axis.
 *
 * A counter on a timer, not a random draw: the sequence stays reproducible, and nothing
 * is sampled during a render the server also runs.
 */
export function usePanicTurn(isPanicking: boolean): number {
  const [turn, setTurn] = useState(0);

  useEffect(() => {
    if (!isPanicking) return;
    const interval = window.setInterval(() => setTurn((current) => current + 1), PANIC_VARIANT_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [isPanicking]);

  return isPanicking ? turn : 0;
}
