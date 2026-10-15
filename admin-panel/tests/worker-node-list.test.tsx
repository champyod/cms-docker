import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkerNodeList } from '@/components/workers/WorkerNodeList';
import { rowsFromNodes } from '@/lib/worker-nodes';
import type { WorkerNodeView } from '@/lib/worker-nodes';

function node(overrides: Partial<WorkerNodeView> = {}): WorkerNodeView {
  return {
    id: 'worker-0',
    host: 'cms-worker-0',
    port: 26000,
    shard: 0,
    endpoint: 'cms-worker-0:26000',
    connection: 'connected',
    state: 'running',
    health: 'healthy',
    activity: 'idle',
    reachable: true,
    tasks: 2,
    load: 20,
    lagging: false,
    contest: 1,
    uptime: '3h',
    restarts: 0,
    lastLog: '',
    ...overrides,
  };
}

describe('WorkerNodeList', () => {
  it('shows each connection signal exactly once', () => {
    const html = renderToStaticMarkup(
      <WorkerNodeList rows={[{ key: '0', host: 'cms-worker-0', port: 26000, live: node(), configured: true }]} />
    );
    expect(html).toContain('cms-worker-0:26000');
    expect(html.match(/CONNECTED/g)).toHaveLength(1);
    expect(html).toContain('state: running');
    expect(html).toContain('reachable');
    expect(html).toContain('2 open tasks');
  });

  it('marks a disconnected remote row and its unreachable signal', () => {
    const remote = node({
      id: 'worker-4',
      host: '198.51.100.23',
      port: 26004,
      shard: 4,
      connection: 'disconnected',
      state: 'absent',
      health: 'none',
      reachable: false,
      tasks: 0,
    });
    const html = renderToStaticMarkup(
      <WorkerNodeList rows={[{ key: '4', host: '198.51.100.23', port: 26004, live: remote, configured: true }]} />
    );
    expect(html).toContain('198.51.100.23:26004');
    expect(html).toContain('DISCONNECTED');
    expect(html).toContain('unreachable');
  });

  it('offers a log toggle only when there is a log to read', () => {
    const withLog = renderToStaticMarkup(
      <WorkerNodeList rows={[{ key: '0', host: 'w0', port: 1, live: node({ lastLog: 'busy evaluating' }), configured: true }]} />
    );
    expect(withLog).toContain('Toggle worker log');

    const withoutLog = renderToStaticMarkup(
      <WorkerNodeList rows={[{ key: '0', host: 'w0', port: 1, live: node(), configured: true }]} />
    );
    expect(withoutLog).not.toContain('Toggle worker log');
  });

  it('falls back to the empty state when nothing is configured', () => {
    const html = renderToStaticMarkup(<WorkerNodeList rows={[]} emptyTitle="No worker nodes found" />);
    expect(html).toContain('No worker nodes found');
  });
});

/**
 * Why the module owns the de-duplication: the resources surface passes the stream it was handed
 * straight through, so a duplicated reading has to be dropped before it reaches a list keyed by
 * endpoint — there is no caller there to do it.
 */
describe('rowsFromNodes', () => {
  it('yields one row for one endpoint the stream named twice', () => {
    const rows = rowsFromNodes([node(), node({ shard: 0 })]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ host: 'cms-worker-0', port: 26000, configured: false });
  });

  it('keeps rows for distinct endpoints', () => {
    const rows = rowsFromNodes([node(), node({ id: 'worker-1', host: 'cms-worker-1', port: 26001, shard: 1 })]);

    expect(rows.map(({ port }) => port)).toEqual([26000, 26001]);
  });
});
