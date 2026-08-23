'use client';

import type { ReactElement } from 'react';
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
      <div className="flex items-center justify-center py-10 text-neutral-500 gap-3">
        <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        Loading configuration...
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
        <div className="text-center py-10 bg-black/20 rounded-xl border border-dashed border-white/5 text-neutral-500">
          No worker nodes defined in configuration.
        </div>
      )}
    </div>
  );
}
