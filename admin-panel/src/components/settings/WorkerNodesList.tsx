'use client';

import type { ReactElement } from 'react';
import { Server } from 'lucide-react';
import { Skeleton } from '@/components/core/Skeleton';
import { EmptyState } from '@/components/core/EmptyState';
import type { WorkerNodesCollection } from './useWorkerNodesCollection';
import type { WorkerNodeRowEditor } from './useWorkerNodeRowEditor';
import { WorkerNodeRow } from './WorkerNodeRow';

interface WorkerNodesListProps {
  collection: WorkerNodesCollection;
  editor: WorkerNodeRowEditor;
  onRetry: (host: string) => void;
}

export function WorkerNodesList({ collection, editor, onRetry }: WorkerNodesListProps): ReactElement {
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
        const status = collection.workerStatus.find(s => s.host === worker.host && s.port === worker.port);
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
