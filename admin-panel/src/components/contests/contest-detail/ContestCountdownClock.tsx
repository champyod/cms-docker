'use client';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import {
  COUNTDOWN_BASE_FONT_PX,
  fitCountdownFontPx,
  toCountdownSegments,
  type CountdownSegment,
} from '@/lib/contest-countdown';

// A server render has no layout to measure, so the fit degrades to useEffect there.
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const EMPTY_SEGMENTS: readonly CountdownSegment[] = [{ glyphs: [{ char: '—', index: 0 }] }];

/** Width signature of the countdown, which changes only when its shape changes. */
function layoutKeyOf(segments: readonly CountdownSegment[] | null): string {
  if (!segments) return 'none';
  return segments.map((segment) => segment.glyphs.length).join('.');
}

interface Props {
  remainingMs: number | null;
}

/** Digits scaled to fill the box; only the digit that changed re-mounts and animates. */
export function ContestCountdownClock({ remainingMs }: Props): React.JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const segments = remainingMs !== null ? toCountdownSegments(remainingMs) : null;
  const displaySegments = segments ?? EMPTY_SEGMENTS;
  const layoutKey = layoutKeyOf(segments);

  // Measured at one base size, so a resize and a content change resolve alike.
  const applyFit = useCallback((): void => {
    const box = boxRef.current;
    const line = lineRef.current;
    if (!box || !line) return;
    line.style.fontSize = `${COUNTDOWN_BASE_FONT_PX}px`;
    line.style.whiteSpace = 'nowrap';
    const naturalWidth = line.scrollWidth;
    const naturalHeight = line.scrollHeight;
    line.style.whiteSpace = '';
    line.style.fontSize = `${fitCountdownFontPx({
      availableWidth: box.clientWidth,
      availableHeight: box.clientHeight,
      naturalWidth,
      naturalHeight,
    })}px`;
  }, []);

  useBrowserLayoutEffect(() => {
    applyFit();
  }, [applyFit, layoutKey]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(() => applyFit());
    observer.observe(box);
    return () => observer.disconnect();
  }, [applyFit]);

  return (
    <div className="countdown-shell flex min-h-0 flex-1 flex-col">
      <div
        ref={boxRef}
        className="countdown-box flex min-h-[200px] w-full flex-1 items-center justify-center overflow-hidden"
      >
        <div
          ref={lineRef}
          className="flex flex-wrap items-baseline justify-center gap-x-[0.08em] font-mono font-bold leading-none tracking-tight"
        >
          {displaySegments.map((segment, segmentIndex) => (
            <span key={segmentIndex} className="countdown-segment">
              {segment.glyphs.map((glyph) => (
                <span key={`${glyph.index}:${glyph.char}`} className="countdown-digit">
                  {glyph.char}
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
