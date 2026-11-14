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

/** Internal coordinate width. The chart scales horizontally, so a bucket boundary never depends on
 *  the container's pixel width; `non-scaling-stroke` keeps the line 2px at any size. */
const VIEW_W = 1000;

/**
 * Server-rendered trend line with one accessible value per bucket.
 *
 * WHY a `<title>` per band and not only a hover tooltip: a tooltip exists for a mouse. A keyboard
 * user and a screen reader get nothing from it, so the value of every point is in the markup and
 * the styled tooltip is an enhancement layered on top rather than the only route to the data.
 * The band is also the hover target, which makes the whole chart height hittable instead of a 2px
 * line.
 */
export function TrendChart({
  label,
  points,
  formatValue = String,
  height = 120,
}: TrendChartProps): React.JSX.Element {
  const max = Math.max(...points, 1);
  const bandWidth = points.length > 0 ? VIEW_W / points.length : VIEW_W;
  const stepX = points.length > 1 ? VIEW_W / (points.length - 1) : 0;
  const yOf = (value: number): number => height - (value / max) * height;

  const line = points
    .map((value, index) => `${index === 0 ? 'M' : 'L'}${(index * stepX).toFixed(2)},${yOf(value).toFixed(2)}`)
    .join(' ');

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
          <title>{formatValue(value)}</title>
        </rect>
      ))}
    </svg>
  );
}
