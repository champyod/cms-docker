import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkerGrid } from '@/components/resources/WorkerGrid';

const worker = { id: 'w0', name: 'w0', status: 'online', tasks: 2, load: 10, activity: 'idle', health: 'healthy' };
const longWorker = { ...worker, id: 'worker-4', name: '198.51.100.23:26004', status: 'offline', tasks: 0, activity: 'unknown', health: 'none' };

describe('WorkerGrid', () => {
  it('shows each signal exactly once', () => {
    const html = renderToStaticMarkup(<WorkerGrid workers={[worker]} />);
    expect(html).toContain('w0');
    expect(html).toContain('ONLINE');
    expect(html.match(/ONLINE/g)).toHaveLength(1);
    expect(html).not.toContain('Busy');
    expect(html).toContain('density:p-3');
  });

  it('keeps long endpoints and the status pill inside the card', () => {
    const html = renderToStaticMarkup(<WorkerGrid workers={[longWorker]} />);
    expect(html).toContain('truncate');
    expect(html).toContain('min-w-0');
    expect(html).toContain('shrink-0');
    expect(html).toContain('title="198.51.100.23:26004"');
    expect(html).toContain('OFFLINE');
  });

  it('merges tasks, activity, and health into one quiet line', () => {
    const html = renderToStaticMarkup(<WorkerGrid workers={[worker]} />);
    expect(html).toContain('2 tasks · idle · healthy');
    expect(html).not.toContain('Active Tasks');
    expect(html).not.toContain('Liveness');
  });
});
