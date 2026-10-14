'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import type { ContestTasksData } from '@/lib/queries/contest-detail';
import { addTaskToContest } from '@/app/actions/contests';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { hasEffectivePermission } from '@/lib/permission-engine';
import { TaskModal } from '@/components/tasks/TaskModal';
import { TaskSelectionModal } from '../TaskSelectionModal';
import { ContestTasksSection } from './ContestTasksSection';
import { useTabRefresh } from './useContestSettingsState';
import { useContestTaskActions } from './useContestTaskActions';

export type ContestTasksTabProps = { data: ContestTasksData };

// Why: the tab contract carries no locale, so the task links resolve it from
// the route — useParams is null-safe without a provider, so unit tests fall
// back to English with no conditional hook call.
function useTabLocale(): string {
  const params = useParams() as { locale?: unknown } | null;
  const candidate = params?.locale;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : 'en';
}

export function ContestTasksTab({ data }: ContestTasksTabProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const actions = useContestTaskActions(data.contestId);
  const refresh = useTabRefresh();
  const locale = useTabLocale();
  const runAction = useActionFeedback();
  const canCreateTask = hasEffectivePermission(new Set(data.permissionKeys), 'task:create');

  // A task created here is not yet on the contest, so it is linked once the
  // create dialog reports the new id.
  const handleCreateSuccess = async (createdTaskId?: number): Promise<void> => {
    if (createdTaskId !== undefined) {
      const result = await runAction(
        { pending: 'Adding task to contest...', success: 'Task added', failure: 'Failed to add task' },
        () => addTaskToContest(data.contestId, createdTaskId),
      );
      if (!result?.success) return;
    }
    refresh();
  };

  return (
    <div className="space-y-6">
      <ContestTasksSection
        tasks={[...data.tasks]}
        expanded={expanded}
        locale={locale}
        permissionKeys={data.permissionKeys}
        onToggle={() => setExpanded((previous) => !previous)}
        onAddTask={() => actions.setIsTaskModalOpen(true)}
        onRemoveTask={(taskId) => { void actions.handleRemoveTask(taskId); }}
      />
      {actions.isTaskModalOpen && (
        <TaskSelectionModal
          isOpen
          onClose={() => actions.setIsTaskModalOpen(false)}
          contestId={data.contestId}
          availableTasks={[...data.availableTasks]}
          onSuccess={refresh}
          canCreateTask={canCreateTask}
          onRequestCreate={() => { actions.setIsTaskModalOpen(false); setIsCreateOpen(true); }}
        />
      )}
      {isCreateOpen && (
        <TaskModal
          isOpen
          onClose={() => setIsCreateOpen(false)}
          onSuccess={(createdTaskId) => { void handleCreateSuccess(createdTaskId); }}
          permissionKeys={data.permissionKeys}
        />
      )}
    </div>
  );
}
