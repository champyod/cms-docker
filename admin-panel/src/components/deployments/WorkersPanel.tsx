'use client';

import type { ReactElement } from 'react';
import { Card } from '@/components/core/Card';
import { Text } from '@/components/core/Typography';
import { Stack } from '@/components/core/Layout';
import { Badge } from '@/components/core/Badge';
import { InlineAlert } from '@/components/core/InlineAlert';
import { WorkerNodeList } from '@/components/workers/WorkerNodeList';
import { rowsFromNodes } from '@/lib/worker-nodes';
import type { RowFreshnessInput } from '@/lib/live/row-freshness';
import type { WorkerConfig, WorkerNodeListRow, WorkerNodeView } from '@/lib/worker-nodes';

interface WorkersPanelProps {
  workers: WorkerConfig[];
  status: WorkerNodeView[];
  forbidden?: boolean;
  error?: string | null;
  canManage: boolean;
  saving: boolean;
  workersDirty: boolean;
  onSaveWorkers: () => void;
  onAddWorker: () => void;
  onRemoveWorker: (index: number) => void;
  onUpdateWorker: (index: number, field: 'host' | 'port', value: string) => void;
  /**
   * How current the live fleet on this panel is, from the stream that feeds it. Omitted where the
   * rows come from something that dates no reads — the rows are then rendered exactly as before.
   */
  freshness?: RowFreshnessInput;
}

/**
 * Why the live fleet is unioned in: the configured list is what an operator edits, but the
 * stream also names shards the configuration does not carry, and dropping them made the
 * panel read zero while the fleet ran.
 * Why a Map: a row looking its reading up by scanning the list is quadratic in the worker count.
 * Why the live-only rows are de-duplicated by endpoint: the stream can name one endpoint twice,
 * and two rows for one worker would count it twice in the badge above them.
 */
function joinStatus(workers: WorkerConfig[], status: WorkerNodeView[]): WorkerNodeListRow[] {
  const byEndpoint = new Map<string, WorkerNodeView>();
  for (const node of status) {
    const key = `${node.host}:${node.port}`;
    if (!byEndpoint.has(key)) byEndpoint.set(key, node);
  }
  const configured: WorkerNodeListRow[] = workers.map((worker, index) => ({
    key: String(index),
    host: worker.host,
    port: worker.port,
    live: byEndpoint.get(`${worker.host}:${worker.port}`) ?? null,
    configured: true,
  }));
  const seen = new Set(workers.map((worker) => `${worker.host}:${worker.port}`));
  const liveOnly = status.filter((node) => {
    const endpoint = `${node.host}:${node.port}`;
    if (seen.has(endpoint)) return false;
    seen.add(endpoint);
    return true;
  });
  return [...configured, ...rowsFromNodes(liveOnly)];
}

export function WorkersPanel(props: WorkersPanelProps): ReactElement {
  const rows = joinStatus(props.workers, props.status);

  return (
    <Stack gap={4}>
      <Stack direction="row" align="center" gap={2} className="px-2 flex-wrap">
        <Text variant="h2">Worker Nodes</Text>
        <Badge variant="info">{rows.length} Nodes</Badge>
      </Stack>

      <Card className="p-4 density:p-3">
        {props.forbidden ? (
          <Text variant="muted">Worker status requires operator permission.</Text>
        ) : props.error ? (
          <InlineAlert tone="destructive" announce="polite" title="Worker configuration unreadable">
            {props.error}
          </InlineAlert>
        ) : (
          <WorkerNodeList
            rows={rows}
            freshness={props.freshness}
            canManage={props.canManage}
            saving={props.saving}
            dirty={props.workersDirty}
            onSave={props.onSaveWorkers}
            onAdd={props.onAddWorker}
            onRemove={(key) => props.onRemoveWorker(Number(key))}
            onEdit={(key, field, value) => props.onUpdateWorker(Number(key), field, value)}
          />
        )}
      </Card>
    </Stack>
  );
}
