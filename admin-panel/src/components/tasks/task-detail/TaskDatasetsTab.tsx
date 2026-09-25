'use client';

import { useParams } from 'next/navigation';
import type { TaskDatasetsData } from '@/lib/queries/task-detail';
import { DatasetModal } from '../DatasetModal';
import { TestcaseUploadModal } from '../TestcaseUploadModal';
import { DatasetsSection } from '../task-detail-datasets';
import { useTaskDatasetActions } from './useTaskDatasetActions';
import { useTaskTabRefresh } from './useTaskTabRefresh';

export type TaskDatasetsTabProps = { data: TaskDatasetsData };

// Why: the tab contract carries no locale, so docs links resolve it from
// the route — useParams is null-safe without a provider, so unit tests fall
// back to English with no conditional hook call.
function useTabLocale(): string {
  const params = useParams() as { locale?: unknown } | null;
  const candidate = params?.locale;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : 'en';
}

export function TaskDatasetsTab({ data }: TaskDatasetsTabProps): React.JSX.Element {
  const actions = useTaskDatasetActions();
  const refresh = useTaskTabRefresh();
  const locale = useTabLocale();
  return (
    <div className="space-y-6">
      <DatasetsSection
        datasets={[...data.datasets]}
        activeDatasetId={data.activeDatasetId}
        expanded={actions.expanded}
        onToggle={actions.toggleExpanded}
        onCreate={actions.openCreate}
        onEdit={(dataset) => actions.openEdit({
          ...dataset,
          task_type_parameters: dataset.task_type_parameters ?? {},
          score_type_parameters: dataset.score_type_parameters ?? {},
        })}
        onActivate={(datasetId) => { void actions.activate(datasetId); }}
        onClone={(datasetId, description) => { void actions.clone(datasetId, description); }}
        onRename={(datasetId, description) => { void actions.rename(datasetId, description); }}
        onToggleAutojudge={(datasetId) => { void actions.toggleAutojudge(datasetId); }}
        onDelete={(datasetId) => { void actions.removeDataset(datasetId); }}
        onOpenTestcaseUpload={(datasetId) => actions.openTestcaseUpload(datasetId)}
        onDeleteTestcase={(testcaseId) => { void actions.removeTestcase(testcaseId); }}
        onTogglePublic={(testcaseId) => { void actions.togglePublic(testcaseId); }}
        locale={locale}
      />
      {actions.isDatasetModalOpen && (
        <DatasetModal
          isOpen
          onClose={actions.closeDataset}
          taskId={data.taskId}
          dataset={actions.editingDataset}
          onSuccess={refresh}
          permissionKeys={data.permissionKeys}
        />
      )}
      {actions.uploadTargetDatasetId !== null && (
        <TestcaseUploadModal
          isOpen
          onClose={() => actions.closeTestcaseUpload()}
          datasetId={actions.uploadTargetDatasetId}
          onSuccess={refresh}
        />
      )}
    </div>
  );
}
