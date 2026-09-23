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
    expect(html).toContain('bg-red-500');
  });
});
