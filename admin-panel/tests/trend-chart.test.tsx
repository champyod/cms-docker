import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TrendChart } from '@/components/core/charts/TrendChart';

/**
 * The first chart primitive of the dashboard rebuild (epic 015.6). It is server-rendered SVG, so
 * every rule the design law cares about is assertable from markup: one colour source, one geometry
 * rule, one accessible name per point. The accessible name matters most — a tooltip that only
 * appears on hover leaves the value unreachable by keyboard and by a screen reader, so each point
 * carries its own <title> and the tooltip becomes an enhancement rather than the only route to the
 * data.
 */

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
