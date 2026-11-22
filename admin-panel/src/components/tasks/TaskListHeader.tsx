'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { ACTION_PERMISSIONS, hasEffectivePermission } from '@/lib/permission-engine';

import { TaskModal } from './TaskModal';
import { useTaskListRefresh } from './useTaskListRefresh';

export interface TaskListHeaderProps {
  readonly permissionKeys: readonly string[];
}

// Why the create dialog lives here: the button is the page's one primary action and the layout
// renders it in the header, a different client tree from the table. Keeping the dialog in the list
// would mean lifting the table's selection state into the page just to reach the button.
export function TaskListHeader({ permissionKeys }: TaskListHeaderProps): React.JSX.Element {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const refresh = useTaskListRefresh();
  const canCreate = hasEffectivePermission(new Set(permissionKeys), ACTION_PERMISSIONS.createTask);

  return (
    <>
      {canCreate && (
        <Button variant="positive" icon={Plus} onClick={() => setIsCreateOpen(true)}>
          Create Task
        </Button>
      )}
      {canCreate && (
        <TaskModal
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          task={null}
          onSuccess={() => {
            setIsCreateOpen(false);
            refresh();
          }}
          permissionKeys={permissionKeys}
        />
      )}
    </>
  );
}
