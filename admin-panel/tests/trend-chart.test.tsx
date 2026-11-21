import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TrendChart } from '@/components/core/charts/TrendChart';


const POINTS = [4, 6, 9, 12, 10, 14, 18, 23] as const;

describe('TrendChart', () => {
  it('renders an accessible image with the series named', () => {
    const markup = renderToStaticMarkup(<TrendChart label="Evaluation queue" points={POINTS} />);
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Evaluation queue"');
  });

  it('gives every point its own accessible value', () => {
    const markup = renderToStaticMarkup(<TrendChart label="Queue" points={POINTS} />);
    const titles = markup.match(/<title>/g) ?? [];
    expect(titles).toHaveLength(POINTS.length);
    expect(markup).toContain('<title>4</title>');
    expect(markup).toContain('<title>23</title>');
  });

  it('places hit bands left to right, one per point', () => {
    const markup = renderToStaticMarkup(<TrendChart label="Queue" points={POINTS} />);
    const xs = [...markup.matchAll(/data-band="(\d+)" x="([\d.]+)"/g)].map((m) => Number(m[2]));
    expect(xs).toHaveLength(POINTS.length);
    expect(xs.every((x, i) => i === 0 || x > xs[i - 1]!)).toBe(true);
  });

  it('takes its colour from the token ladder, never from a literal', () => {
    const markup = renderToStaticMarkup(<TrendChart label="Queue" points={POINTS} />);
    // The law: no colour is chosen at the point of use. A hex here would bypass the theme.
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(markup).toContain('var(--primary)');
  });

  it('accepts a formatter so the same primitive serves counts, minutes and scores', () => {
    const markup = renderToStaticMarkup(
      <TrendChart label="Oldest wait" points={POINTS} formatValue={(v) => `${v} min`} />,
    );
    expect(markup).toContain('<title>4 min</title>');
  });
});

describe('TrendChart edge cases', () => {
  const pathY = (markup: string): number[] =>
    [...markup.matchAll(/[ML]([\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[2]));

  it('renders nothing pathological for an empty series', () => {
    const markup = renderToStaticMarkup(<TrendChart label="No data yet" points={[]} />);
    expect(markup).toContain('aria-label="No data yet"');
    expect(markup).not.toMatch(/NaN|Infinity/);
    expect(markup.match(/<title>/g) ?? []).toHaveLength(0);
  });

  it('handles a single sample without dividing by zero', () => {
    const markup = renderToStaticMarkup(<TrendChart label="One sample" points={[7]} />);
    expect(markup).not.toMatch(/NaN|Infinity/);
    expect(markup.match(/<title>/g) ?? []).toHaveLength(1);
  });

  it('keeps a flat zero series on the floor instead of dividing by zero', () => {
    const markup = renderToStaticMarkup(<TrendChart label="Quiet" points={[0, 0, 0]} height={100} />);
    expect(markup).not.toMatch(/NaN|Infinity/);
    expect(pathY(markup).every((y) => y >= 0 && y <= 100)).toBe(true);
  });

  it('never draws outside the box for a negative series', () => {
    const markup = renderToStaticMarkup(<TrendChart label="Delta" points={[-5, -2, 0, 3]} height={100} />);
    expect(markup).not.toMatch(/NaN|Infinity/);
    const ys = pathY(markup);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
  });

  it('refuses to emit NaN into a path when a bucket is missing', () => {
    const markup = renderToStaticMarkup(<TrendChart label="Gappy" points={[1, Number.NaN, 3]} />);
    expect(markup).not.toMatch(/NaN/);
  });
});
