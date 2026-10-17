import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GaugeCard } from '@/components/resources/GaugeCard';

describe('GaugeCard', () => {
  it('renders label, figure, and density classes', () => {
    const html = renderToStaticMarkup(
      <GaugeCard icon={<span />} label="CPU Usage" source="(Host)" percent={42} tone="auto" />,
    );
    expect(html).toContain('CPU Usage');
    expect(html).toContain('42%');
    expect(html).toContain('density:p-4');
  });
  it('turns red past the threshold', () => {
    const html = renderToStaticMarkup(
      <GaugeCard icon={<span />} label="CPU" source={null} percent={91} tone="auto" />,
    );
    expect(html).toContain('bg-destructive');
  });
  // Why the gauge takes a class from its caller at all: the freshness cue wraps the figure, and that
  // wrapper — not the card — is then the grid cell, so the page hands it `h-full` to keep the card the
  // height the cell used to make it. The gauge's own classes have to survive that.
  it('carries the class its cell needs on the card, without dropping its own layout', () => {
    const html = renderToStaticMarkup(
      <GaugeCard icon={<span />} label="CPU" source={null} percent={42} tone="auto" className="h-full" />,
    );
    // Why the card's own attribute and not the whole markup: the progress bar inside the gauge is
    // `h-full` as well, so only the card can say whether the caller's class landed on it.
    const card = /class="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(card).toContain('h-full');
    expect(card).toContain('density:p-4');
    expect(card).toContain('justify-center');
  });
});
