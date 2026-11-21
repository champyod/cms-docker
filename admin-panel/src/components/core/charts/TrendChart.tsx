import React from 'react';

export interface TrendChartProps {
  /** Accessible name for the series, e.g. "Evaluation queue, last 24 hours". */
  readonly label: string;
  readonly points: readonly number[];
  readonly formatValue?: (value: number) => string;
  readonly height?: number;
}

const VIEW_W = 1000;

export function TrendChart({
  label,
  points,
  formatValue = String,
  height = 120,
}: TrendChartProps): React.JSX.Element {
  const finite = points.filter((value) => Number.isFinite(value));
  const low = Math.min(0, ...finite);
  const high = Math.max(0, ...finite);
  const span = high - low || 1;
  const bandWidth = points.length > 0 ? VIEW_W / points.length : VIEW_W;
  const stepX = points.length > 1 ? VIEW_W / (points.length - 1) : 0;
  const yOf = (value: number): number => height - ((value - low) / span) * height;

  let line = '';
  let continues = false;
  points.forEach((value, index) => {
    if (!Number.isFinite(value)) {
      continues = false;
      return;
    }
    line += `${continues ? 'L' : 'M'}${(index * stepX).toFixed(2)},${yOf(value).toFixed(2)} `;
    continues = true;
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
