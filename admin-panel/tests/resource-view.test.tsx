import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResourceView } from '@/components/resources/ResourceView';

describe('ResourceView', () => {
  it('starts from the loading state', () => {
    const html = renderToStaticMarkup(<ResourceView />);
    expect(html).toContain('Loading system metrics');
  });
  it('compacts the metrics card under density', async () => {
    const { MetricsCard } = await import('@/components/resources/ResourceView');
    const html = renderToStaticMarkup(<MetricsCard serverStats={null} />);
    expect(html).toContain('density:p-3');
  });
});
