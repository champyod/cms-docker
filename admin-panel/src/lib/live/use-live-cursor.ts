'use client';

import { useCallback, useEffect, useRef } from 'react';

import { useLiveStream, type LiveStatus } from '@/hooks/useLiveStream';
import type { CursorFrame } from '@/lib/live/frames';

/**
 * Runs `onChange` whenever a surface's change cursor moves, and reports the connection's state.
 *
 * Why the opening frame is ignored: the page that opened this connection was rendered from the same
 * data a moment ago, so re-reading on the first frame would only repeat that render. Why an equal
 * cursor is ignored: the heartbeat restates the last frame, which is no change to act on.
 */
export function useLiveCursor(url: string, onChange: () => void): LiveStatus {
  const cursorRef = useRef<string | null | undefined>(undefined);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const onFrame = useCallback((frame: CursorFrame): void => {
    if (cursorRef.current === frame.cursor) return;
    if (cursorRef.current === undefined) {
      cursorRef.current = frame.cursor;
      return;
    }
    cursorRef.current = frame.cursor;
    onChangeRef.current();
  }, []);

  const { status } = useLiveStream<CursorFrame>({ url, onFrame });
  return status;
}
