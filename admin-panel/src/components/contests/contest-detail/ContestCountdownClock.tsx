'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  COUNTDOWN_BASE_FONT_PX,
  fitCountdownFontPx,
  toCountdownSegments,
  type CountdownSegment,
} from '@/lib/contest-countdown';

// A server render has no layout to measure, so the fit degrades to useEffect there.
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const EMPTY_SEGMENTS: readonly CountdownSegment[] = [{ glyphs: [{ char: '—', index: 0 }] }];

interface FitMetrics {
  layoutKey: string;
  width: number;
  height: number;
}

/** Width signature of the countdown, which changes only when its shape changes. */
function layoutKeyOf(segments: readonly CountdownSegment[] | null): string {
  if (!segments) return 'none';
  return segments.map((segment) => segment.glyphs.length).join('.');
}

function measureNatural(line: HTMLDivElement, layoutKey: string): FitMetrics {
  line.style.fontSize = `${COUNTDOWN_BASE_FONT_PX}px`;
  line.style.whiteSpace = 'nowrap';
  const metrics = { layoutKey, width: line.scrollWidth, height: line.scrollHeight };
  line.style.whiteSpace = '';
  return metrics;
}

interface Props {
  remainingMs: number | null;
}

/** Digits scaled to fill the box; only the digit that changed re-mounts and animates. */
export function ContestCountdownClock({ remainingMs }: Props): React.JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const metricsRef = useRef<FitMetrics | null>(null);
  const segments = remainingMs !== null ? toCountdownSegments(remainingMs) : null;
  const displaySegments = segments ?? EMPTY_SEGMENTS;
  const layoutKey = layoutKeyOf(segments);

  // Natural size is measured once per shape and cached, so a resize costs one read and one write
  // instead of a measure-write cycle that forces layout on every observer tick.
  useBrowserLayoutEffect(() => {
    const box = boxRef.current;
    const line = lineRef.current;
    if (!box || !line) return;
    const fit = (): void => {
      const cached = metricsRef.current;
      const metrics = cached && cached.layoutKey === layoutKey ? cached : measureNatural(line, layoutKey);
      metricsRef.current = metrics;
      line.style.fontSize = `${fitCountdownFontPx({
        availableWidth: box.clientWidth,
        availableHeight: box.clientHeight,
        naturalWidth: metrics.width,
        naturalHeight: metrics.height,
      })}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => observer.disconnect();
  }, [layoutKey]);

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
