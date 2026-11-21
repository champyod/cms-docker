// @vitest-environment happy-dom
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render as renderDom } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkersPanel } from '@/components/deployments/WorkersPanel';
import type { WorkerConfig, WorkerNodeView } from '@/lib/worker-nodes';

// Why: vitest globals are off, so testing-library's automatic cleanup never runs and a later
// query would bind to the rows an earlier render left in the document.
afterEach(() => {
  cleanup();
});

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

interface PanelOptions {
  canManage?: boolean;
  onRemoveWorker?: (index: number) => void;
}

function panel(
  workers: WorkerConfig[],
  status: WorkerNodeView[],
  options: PanelOptions = {}
): ReactElement {
  return (
    <WorkersPanel
      workers={workers}
      status={status}
      canManage={options.canManage ?? false}
      saving={false}
      workersDirty={false}
      onSaveWorkers={NOOP}
      onAddWorker={NOOP}
      onRemoveWorker={options.onRemoveWorker ?? NOOP}
      onUpdateWorker={NOOP}
    />
  );
}

function markup(workers: WorkerConfig[], status: WorkerNodeView[]): string {
  return renderToStaticMarkup(panel(workers, status));
}

/**
 * Why the zero mattered: the configured list can be empty while the fleet runs, so a panel that
 * counts only what it can configure reports "0" for a host with four live workers.
 */
describe('WorkersPanel fleet join', () => {
  it('renders and counts a shard only the live stream names', () => {
    const html = markup([], [liveNode()]);

    expect(html).toContain('cms-worker-0:26000');
    expect(html).toContain('1 Nodes');
    expect(html).not.toContain('0 Nodes');
  });

  it('counts a configured shard and its live reading once', () => {
    const html = markup([{ host: 'cms-worker-0', port: 26000 }], [liveNode()]);

    expect(html.match(/cms-worker-0:26000/g)).toHaveLength(1);
    expect(html).toContain('state: running');
    expect(html).toContain('1 Nodes');
  });

  it('keeps a configured shard that has no reading yet', () => {
    const html = markup([{ host: 'cms-worker-9', port: 26009 }], []);

    expect(html).toContain('cms-worker-9:26009');
    expect(html).toContain('No telemetry yet');
    expect(html).toContain('1 Nodes');
  });

  /**
   * Why the repetition matters: the stream carries one reading per reporter, so an endpoint
   * named twice would show as two nodes and inflate the count above them.
   */
  it('renders one row when the stream names the same endpoint twice', () => {
    const html = markup([], [liveNode(), liveNode()]);

    expect(html.match(/cms-worker-0:26000/g)).toHaveLength(1);
    expect(html).toContain('1 Nodes');
  });
});

/**
 * Why an operator cannot remove a live-only row: Remove and Edit write the configured list, and
 * that list has no entry for a worker only the live stream names — the controls would report a
 * change that never reaches the config file. They belong on the configured rows alone.
 */
describe('WorkersPanel live-only rows', () => {
  it('offers no Remove or Edit on a live-only row while a configured row keeps both', () => {
    const liveOnly = renderToStaticMarkup(panel([], [liveNode()], { canManage: true }));

    expect(liveOnly).toContain('cms-worker-0:26000');
    expect(liveOnly).not.toContain('Remove worker');
    expect(liveOnly).not.toContain('Host for worker');

    const { getByLabelText } = renderDom(
      panel([{ host: 'cms-worker-0', port: 26000 }], [liveNode()], { canManage: true })
    );

    expect(getByLabelText('Host for worker cms-worker-0')).toBeDefined();
    fireEvent.click(getByLabelText('Remove worker cms-worker-0'));
  });

  it('removes the configured row the operator picked, by its list index', () => {
    const onRemoveWorker = vi.fn();
    const { getByLabelText } = renderDom(
      panel(
        [
          { host: 'cms-worker-0', port: 26000 },
          { host: 'cms-worker-1', port: 26001 },
        ],
        [liveNode(), liveNode({ id: 'worker-1', host: 'cms-worker-1', port: 26001, shard: 1 })],
        { canManage: true, onRemoveWorker }
      )
    );

    fireEvent.click(getByLabelText('Remove worker cms-worker-1'));

    expect(onRemoveWorker).toHaveBeenCalledWith(1);
  });
});
