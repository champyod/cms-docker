import React from 'react';

export interface TrendChartProps {
  /** Accessible name for the series, e.g. "Evaluation queue, last 24 hours". */
  readonly label: string;
  /** Ordered values; index is the time bucket, so a point's position is its timestamp. */
  readonly points: readonly number[];
  /** How a value reads in its own units — counts, minutes, scores. Defaults to the raw number. */
  readonly formatValue?: (value: number) => string;
  readonly height?: number;
}

/** Internal width; `non-scaling-stroke` keeps the line 2px at any container size. */
const VIEW_W = 1000;

/** Trend line with a value per bucket in the markup — a tooltip alone excludes keyboard and screen readers. */
export function TrendChart({
  label,
  points,
  formatValue = String,
  height = 120,
}: TrendChartProps): React.JSX.Element {
  // Include zero and ignore non-finite samples: deltas go negative, gaps arrive as NaN.
  const finite = points.filter((value) => Number.isFinite(value));
  const low = Math.min(0, ...finite);
  const high = Math.max(0, ...finite);
  const span = high - low || 1;
  const bandWidth = points.length > 0 ? VIEW_W / points.length : VIEW_W;
  const stepX = points.length > 1 ? VIEW_W / (points.length - 1) : 0;
  const yOf = (value: number): number => height - ((value - low) / span) * height;

  // A gap breaks the line; joining across missing hours claims data we do not have.
  let line = '';
  let pen = false;
  points.forEach((value, index) => {
    if (!Number.isFinite(value)) {
      pen = false;
      return;
    }
    line += `${pen ? 'L' : 'M'}${(index * stepX).toFixed(2)},${yOf(value).toFixed(2)} `;
    pen = true;
  });

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${VIEW_W} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
    >
      <path
        d={line}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
      {points.map((value, index) => (
        <rect
          key={index}
          data-band={index}
          x={(index * bandWidth).toFixed(2)}
          y={0}
          width={bandWidth.toFixed(2)}
          height={height}
          fill="transparent"
        >
          <title>{Number.isFinite(value) ? formatValue(value) : '—'}</title>
        </rect>
      ))}
    </svg>
  );
}
