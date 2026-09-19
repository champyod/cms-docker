'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const JUST_SAVED_VISIBLE_MS = 2000;

export function useJustSavedFlag(durationMs: number = JUST_SAVED_VISIBLE_MS): {
  justSaved: boolean;
  flashSaved: () => void;
} {
  const [justSaved, setJustSaved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const flashSaved = useCallback(() => {
    setJustSaved(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setJustSaved(false), durationMs);
  }, [durationMs]);

  return { justSaved, flashSaved };
}
