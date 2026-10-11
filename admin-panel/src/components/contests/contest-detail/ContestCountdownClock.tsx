'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  COUNTDOWN_BASE_FONT_PX,
  fitCountdownFontPx,
  isCountdownDigit,
  toCountdownSegments,
  type CountdownSegment,
} from '@/lib/contest-countdown';
import { panicDigitClassNames, panicDigitStyle } from '@/lib/contest-panic';

// A server render has no layout to measure, so the fit degrades to useEffect there.
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Numerals take a fixed slot so the row cannot resize as the seconds change. */
function digitClassName(char: string): string {
  return isCountdownDigit(char) ? 'countdown-digit is-slot' : 'countdown-digit';
}

/** The element that carries the panic transform; it holds nothing else. */
function moverClassName(isPanicking: boolean): string {
  return ['countdown-panic-move', ...panicDigitClassNames(isPanicking)].join(' ');
}

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
  readonly remainingMs: number | null;
  /** True at the threshold: every digit panics, each with its own motion. */
  readonly isPanicking?: boolean;
  /** Advances on a timer, so each digit is handed a new motion rather than settling. */
  readonly panicTurn?: number;
}

/** Digits scaled to fill the box; only the digit that changed re-mounts and animates. */
export function ContestCountdownClock({
  remainingMs,
  isPanicking = false,
  panicTurn = 0,
}: Props): React.JSX.Element {
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

  // A cached measurement taken before the display face arrived is measured against the
  // fallback font, which is a different width, so the row is fitted to the wrong size and
  // overflows once the real face renders. Dropping the cache when fonts settle re-fits it.
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;
    const refit = (): void => {
      metricsRef.current = null;
      lineRef.current?.dispatchEvent(new Event('countdown-refit'));
    };
    fonts.addEventListener('loadingdone', refit);
    return () => fonts.removeEventListener('loadingdone', refit);
  }, []);

  useBrowserLayoutEffect(() => {
    const box = boxRef.current;
    const line = lineRef.current;
    if (!box || !line) return;
    const refit = (): void => {
      const metrics = measureNatural(line, layoutKeyOf(segments));
      metricsRef.current = metrics;
      line.style.fontSize = `${fitCountdownFontPx({
        availableWidth: box.clientWidth,
        availableHeight: box.clientHeight,
        naturalWidth: metrics.width,
        naturalHeight: metrics.height,
      })}px`;
    };
    line.addEventListener('countdown-refit', refit);
    return () => line.removeEventListener('countdown-refit', refit);
  }, [segments]);

  return (
    <div className="countdown-shell flex min-h-0 flex-1 flex-col">
      <div
        ref={boxRef}
        className="countdown-box flex min-h-[200px] w-full flex-1 items-center justify-center overflow-hidden"
      >
        {/* One slot per digit keeps the row from resizing as the seconds change: the
            display face has no tabular figures, so the slot is what holds the width. */}
        <div
          ref={lineRef}
          className="flex flex-nowrap items-baseline justify-center leading-none font-display font-bold tracking-tight"
        >
          {displaySegments.map((segment, segmentIndex) => (
            <span key={segmentIndex} className="countdown-segment">
              {segment.glyphs.map((glyph) => (
                <span
                  key={`${glyph.index}:${glyph.char}`}
                  className={digitClassName(glyph.char)}
                  style={panicDigitStyle(isPanicking, glyph.index, panicTurn) as React.CSSProperties | undefined}
                >
                  <span className={moverClassName(isPanicking)}>{glyph.char}</span>
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
