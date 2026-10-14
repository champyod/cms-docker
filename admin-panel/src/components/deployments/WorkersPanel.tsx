'use client';

import type { ReactElement } from 'react';
import { Card } from '@/components/core/Card';
import { Text } from '@/components/core/Typography';
import { Stack } from '@/components/core/Layout';
import { Badge } from '@/components/core/Badge';
import { InlineAlert } from '@/components/core/InlineAlert';
import { WorkerNodeList } from '@/components/workers/WorkerNodeList';
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
}

/** Why a Map: a row looking its reading up by scanning the list is quadratic in the worker count. */
function joinStatus(workers: WorkerConfig[], status: WorkerNodeView[]): WorkerNodeListRow[] {
  const byEndpoint = new Map<string, WorkerNodeView>();
  for (const node of status) {
    const key = `${node.host}:${node.port}`;
    if (!byEndpoint.has(key)) byEndpoint.set(key, node);
  }
  return workers.map((worker, index) => ({
    key: String(index),
    host: worker.host,
    port: worker.port,
    live: byEndpoint.get(`${worker.host}:${worker.port}`) ?? null,
  }));
}

export function WorkersPanel(props: WorkersPanelProps): ReactElement {
  return (
    <Stack gap={4}>
      <Stack direction="row" align="center" gap={2} className="px-2 flex-wrap">
        <Text variant="h2">Worker Nodes</Text>
        <Badge variant="info">{props.workers.length} Configured</Badge>
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
            rows={joinStatus(props.workers, props.status)}
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
