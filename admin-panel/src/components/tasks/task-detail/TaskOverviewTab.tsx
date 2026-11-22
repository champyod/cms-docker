'use client';

import type { TaskOverviewData } from '@/lib/queries/task-detail';
import { StatementModal } from '../StatementModal';
import { StatementsSection } from '../task-detail-sections';
import { useTaskOverviewState } from './useTaskOverviewState';

export type TaskOverviewTabProps = { data: TaskOverviewData };

// Why no config card above the statements: the detail layout's fact strip already carries the
// task's score mode, feedback level, precision and submission count, so the card was the same four
// values written twice - and the second copy scrolled away first.
export function TaskOverviewTab({ data }: TaskOverviewTabProps): React.JSX.Element {
  const state = useTaskOverviewState();
  return (
    <div className="space-y-6">
      <StatementsSection
        statements={[...data.statements]}
        expanded={state.statementsExpanded}
        onToggle={() => state.toggleSection('statements')}
        onUpload={state.openUpload}
        onDeleteStatement={state.deleteStatement}
      />
      {state.isUploadOpen && (
        <StatementModal
          isOpen
          onClose={state.closeUpload}
          taskId={data.task.id}
          existingLanguages={data.statements.map((statement) => statement.language)}
          onSuccess={state.refresh}
        />
      )}
    </div>
  );
}
