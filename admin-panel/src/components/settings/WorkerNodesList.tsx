'use client';

import { useMemo, type ReactElement } from 'react';
import { Server } from 'lucide-react';
import { Skeleton } from '@/components/core/Skeleton';
import { EmptyState } from '@/components/core/EmptyState';
import type { WorkerNodesCollection } from './useWorkerNodesCollection';
import type { WorkerStatus } from './workerNodesTypes';
import type { WorkerNodeRowEditor } from './useWorkerNodeRowEditor';
import { WorkerNodeRow } from './WorkerNodeRow';

interface WorkerNodesListProps {
  collection: WorkerNodesCollection;
  editor: WorkerNodeRowEditor;
  onRetry: (host: string) => void;
}

function statusKey(host: string, port: number): string {
  return `${host}:${port}`;
}

export function WorkerNodesList({ collection, editor, onRetry }: WorkerNodesListProps): ReactElement {
  // Why a Map: a row scans the status list per card, so a linear lookup per row is
  // quadratic in the worker count. First-wins keeps the match a linear scan would find.
  const statusByKey = useMemo(() => {
    const byKey = new Map<string, WorkerStatus>();
    for (const status of collection.workerStatus) {
      const key = statusKey(status.host, status.port);
      if (!byKey.has(key)) byKey.set(key, status);
    }
    return byKey;
  }, [collection.workerStatus]);

  if (collection.loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3">
      {collection.workers.map((worker, index) => {
        const status = statusByKey.get(statusKey(worker.host, worker.port));
        return (
          <WorkerNodeRow
            key={index}
            index={index}
            worker={worker}
            status={status}
            editing={editor.editingIndex === index}
            editor={editor}
            onRetry={() => onRetry(worker.host)}
            onRemove={() => editor.removeWorker(index)}
          />
        );
      })}

      {collection.workers.length === 0 && (
        <EmptyState
          icon={Server}
          title="No worker nodes defined in configuration."
          border-none
        />
      )}
    </div>
  );
}
