'use client';

import type { ReactElement } from 'react';
import { Plus, Save, Server } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { EmptyState } from '@/components/core/EmptyState';
import { WorkerNodeRow } from '@/components/workers/WorkerNodeRow';
import type { WorkerNodeListRow } from '@/lib/worker-nodes';

export interface WorkerNodeListProps {
  rows: WorkerNodeListRow[];
  canManage?: boolean;
  saving?: boolean;
  dirty?: boolean;
  onSave?: () => void;
  onAdd?: () => void;
  onRemove?: (key: string) => void;
  onEdit?: (key: string, field: 'host' | 'port', value: string) => void;
  emptyTitle?: string;
  emptyDescription?: string;
}

/**
 * The one worker-node list. Deployments renders it editable (add, edit, sync);
 * Resources renders the same rows read-only, so both surfaces can never drift.
 */
export function WorkerNodeList({
  rows,
  canManage = false,
  saving = false,
  dirty = false,
  onSave,
  onAdd,
  onRemove,
  onEdit,
  emptyTitle = 'No worker nodes configured',
  emptyDescription,
}: WorkerNodeListProps): ReactElement {
  const showToolbar = canManage && (onAdd !== undefined || (dirty && onSave !== undefined));

  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <WorkerNodeRow
          key={row.key}
          index={index}
          row={row}
          canManage={canManage}
          onRemove={onRemove}
          onEdit={onEdit}
        />
      ))}

      {rows.length === 0 && (
        <EmptyState icon={Server} title={emptyTitle} description={emptyDescription} className="border-none" />
      )}

      {showToolbar && (
        <div className="flex items-center gap-2 pt-1">
          {onAdd && (
            <Button variant="positiveOutline" size="sm" icon={Plus} onClick={onAdd}>
              Add Worker Node
            </Button>
          )}
          {dirty && onSave && (
            <Button size="sm" icon={Save} onClick={onSave} disabled={saving}>
              Sync Workers
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
