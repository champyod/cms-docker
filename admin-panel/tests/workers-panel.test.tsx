import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkersPanel } from '@/components/deployments/WorkersPanel';
import type { WorkerConfig, WorkerNodeView } from '@/lib/worker-nodes';

function liveNode(overrides: Partial<WorkerNodeView> = {}): WorkerNodeView {
  return {
    id: 'worker-0',
    host: 'cms-worker-0',
    port: 26000,
    shard: 0,
    endpoint: 'cms-worker-0:26000',
    connection: 'connected',
    state: 'running',
    health: 'none',
    activity: 'idle',
    reachable: true,
    tasks: 0,
    load: 0,
    lagging: false,
    contest: null,
    uptime: '3h',
    restarts: 0,
    lastLog: '',
    ...overrides,
  };
}

const NOOP = (): void => undefined;

function render(workers: WorkerConfig[], status: WorkerNodeView[]): string {
  return renderToStaticMarkup(
    <WorkersPanel
      workers={workers}
      status={status}
      canManage={false}
      saving={false}
      workersDirty={false}
      onSaveWorkers={NOOP}
      onAddWorker={NOOP}
      onRemoveWorker={NOOP}
      onUpdateWorker={NOOP}
    />
  );
}

/**
 * Why the zero mattered: the configured list can be empty while the fleet runs, so a panel that
 * counts only what it can configure reports "0" for a host with four live workers.
 */
describe('WorkersPanel fleet join', () => {
  it('renders and counts a shard only the live stream names', () => {
    const html = render([], [liveNode()]);

    expect(html).toContain('cms-worker-0:26000');
    expect(html).toContain('1 Nodes');
    expect(html).not.toContain('0 Nodes');
  });

  it('counts a configured shard and its live reading once', () => {
    const html = render([{ host: 'cms-worker-0', port: 26000 }], [liveNode()]);

    expect(html.match(/cms-worker-0:26000/g)).toHaveLength(1);
    expect(html).toContain('state: running');
    expect(html).toContain('1 Nodes');
  });

  it('keeps a configured shard that has no reading yet', () => {
    const html = render([{ host: 'cms-worker-9', port: 26009 }], []);

    expect(html).toContain('cms-worker-9:26009');
    expect(html).toContain('No telemetry yet');
    expect(html).toContain('1 Nodes');
  });
});
