'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import type { ContestTasksData } from '@/lib/queries/contest-detail';
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
  const actions = useContestTaskActions();
  const refresh = useTabRefresh();
  const locale = useTabLocale();
  return (
    <div className="space-y-6">
      <ContestTasksSection
        tasks={[...data.tasks]}
        expanded={expanded}
        locale={locale}
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
        />
      )}
    </div>
  );
}
