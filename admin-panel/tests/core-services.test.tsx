import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CoreServicesStatus } from '@/components/resources/CoreServicesStatus';

describe('CoreServicesStatus', () => {
  it('renders one status pill per service with density classes', () => {
    const html = renderToStaticMarkup(
      <CoreServicesStatus services={[{ name: 'cms-database', status: 'healthy' }]} loading={false} />,
    );
    expect(html).toContain('database');
    expect(html).toContain('HEALTHY');
    expect(html).toContain('density:py-1');
  });
});
