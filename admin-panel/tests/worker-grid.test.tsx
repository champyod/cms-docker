import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkerGrid } from '@/components/resources/WorkerGrid';

const worker = { id: 'w0', name: 'w0', status: 'online', tasks: 2, load: 10, activity: 'idle', health: 'healthy' };

describe('WorkerGrid', () => {
  it('shows each signal exactly once', () => {
    const html = renderToStaticMarkup(<WorkerGrid workers={[worker]} />);
    expect(html).toContain('w0');
    expect(html).toContain('ONLINE');
    expect(html.match(/ONLINE/g)).toHaveLength(1);
    expect(html).not.toContain('Busy');
    expect(html).toContain('density:p-3');
  });
});
