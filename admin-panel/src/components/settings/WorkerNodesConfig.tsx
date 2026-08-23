'use client';

import type { ReactElement } from 'react';
import { Card } from '@/components/core/Card';
import { useWorkerNodesCollection } from './useWorkerNodesCollection';
import { useWorkerNodeActions } from './useWorkerNodeActions';
import { useWorkerNodeRowEditor } from './useWorkerNodeRowEditor';
import { useWorkerNodeAddForm } from './useWorkerNodeAddForm';
import { WorkerNodesHeader } from './WorkerNodesHeader';
import { AddWorkerNodeForm } from './AddWorkerNodeForm';
import { WorkerNodesList } from './WorkerNodesList';

export function WorkerNodesConfig(): ReactElement | null {
  const collection = useWorkerNodesCollection();
  const actions = useWorkerNodeActions(collection);
  const editor = useWorkerNodeRowEditor(collection.workers, collection.replaceWorkers);
  const addForm = useWorkerNodeAddForm(collection.workers, collection.replaceWorkers);

  // Hide card when no workers
  if (!collection.loading && collection.workers.length === 0) {
    return null;
  }

  return (
    <Card className="glass-card border-white/5 overflow-hidden">
      <WorkerNodesHeader
        onToggleAddForm={addForm.toggleForm}
        onSave={() => { void actions.saveWorkers(); }}
      />
      <div className="p-6 space-y-4">
        {addForm.showAddForm && <AddWorkerNodeForm form={addForm} />}
        <WorkerNodesList
          collection={collection}
          editor={editor}
          onRetry={(host) => actions.retryConnection(host)}
        />
      </div>
    </Card>
  );
}
