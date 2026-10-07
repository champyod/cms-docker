import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NetworkTrafficLogs } from '@/components/resources/NetworkTrafficLogs';

const logs = [{ id: 1, timestamp: 't', container: 'cms-db', rx: '1MB', tx: '2kB' }];

describe('NetworkTrafficLogs', () => {
  it('renders compact density rows', () => {
    const html = renderToStaticMarkup(
      <NetworkTrafficLogs logs={logs} limit={20} onLimitChange={() => undefined} loading={false} />,
    );
    expect(html).toContain('cms-db');
    expect(html).toContain('density:py-1');
  });
});
