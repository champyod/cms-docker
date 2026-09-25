'use client';

import { useParams } from 'next/navigation';
import type { TaskOverviewData } from '@/lib/queries/task-detail';
import { StatementModal } from '../StatementModal';
import { ConfigSection, StatementsSection } from '../task-detail-sections';
import { useTaskOverviewState } from './useTaskOverviewState';

export type TaskOverviewTabProps = { data: TaskOverviewData };

// Why: the tab contract carries no locale, so docs links resolve it from
// the route — useParams is null-safe without a provider, so unit tests fall
// back to English with no conditional hook call.
function useTabLocale(): string {
  const params = useParams() as { locale?: unknown } | null;
  const candidate = params?.locale;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : 'en';
}

export function TaskOverviewTab({ data }: TaskOverviewTabProps): React.JSX.Element {
  const state = useTaskOverviewState();
  const locale = useTabLocale();
  return (
    <div className="space-y-6">
      <ConfigSection
        task={{
          score_precision: data.task.score_precision ?? 0,
          score_mode: data.task.score_mode,
          feedback_level: data.task.feedback_level,
          _count: { submissions: data.task.submissions },
        }}
        expanded={state.infoExpanded}
        onToggle={() => state.toggleSection('info')}
        locale={locale}
      />
      <StatementsSection
        statements={[...data.statements]}
        expanded={state.statementsExpanded}
        onToggle={() => state.toggleSection('statements')}
        onUpload={() => state.setIsStatementModalOpen(true)}
      />
      {state.isStatementModalOpen && (
        <StatementModal
          isOpen
          onClose={() => state.setIsStatementModalOpen(false)}
          taskId={data.task.id}
          existingLanguages={data.statements.map((statement) => statement.language)}
          onSuccess={state.refresh}
        />
      )}
    </div>
  );
}
