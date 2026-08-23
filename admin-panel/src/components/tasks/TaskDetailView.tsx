'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import { DatasetModal } from './DatasetModal';
import { StatementModal } from './StatementModal';
import { AttachmentModal } from './AttachmentModal';
import { TaskModal } from './TaskModal';
import { TestcaseUploadModal } from './TestcaseUploadModal';
import { ConfigSection, StatementsSection, TaskHeader } from './task-detail-sections';
import { DatasetsSection, AttachmentsSection } from './task-detail-datasets';

interface Dataset {
  id: number;
  description: string;
  task_type: string;
  time_limit: number | null;
  memory_limit: string | null;
  score_type: string;
  autojudge: boolean;
  testcases: Array<{ id: number; codename: string; public: boolean }>;
}

interface TaskWithRelations {
  id: number;
  name: string;
  title: string;
  score_precision: number;
  score_mode: string;
  feedback_level: string;
  active_dataset_id: number | null;
  contests: { id: number; name: string } | null;
  statements: Array<{ id: number; language: string; digest: string }>;
  attachments: Array<{ id: number; filename: string }>;
  datasets: Dataset[];
  _count: { submissions: number };
}

interface TaskDetailViewProps {
  task: TaskWithRelations;
}

export function TaskDetailView({ task }: TaskDetailViewProps): React.JSX.Element {
  const pathname = usePathname();
  const locale = pathname.split('/')[1] ?? 'en';
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ info: true, statements: true, datasets: true });
  const [isTaskSettingsOpen, setIsTaskSettingsOpen] = useState(false);
  const [isDatasetModalOpen, setIsDatasetModalOpen] = useState(false);
  const [editingDataset, setEditingDataset] = useState<Dataset | null>(null);
  const [isStatementModalOpen, setIsStatementModalOpen] = useState(false);
  const [isAttachmentModalOpen, setIsAttachmentModalOpen] = useState(false);
  const [currentDatasetId, setCurrentDatasetId] = useState<number | null>(null);

  const toggle = (section: string): void => setExpanded((prev) => ({ ...prev, [section]: !prev[section] }));
  const reload = (): void => window.location.reload();

  const handleActivateDataset = async (datasetId: number): Promise<void> => {
    await apiClient.put(`/api/datasets/${datasetId}`, { action: 'activate' });
    reload();
  };

  const handleCloneDataset = async (datasetId: number, description: string): Promise<void> => {
    const newName = prompt('Enter name for cloned dataset:', `${description} (copy)`);
    if (!newName) return;
    await apiClient.post(`/api/datasets/${datasetId}/clone`, { newDescription: newName });
    reload();
  };

  const handleRenameDataset = async (datasetId: number, currentDesc: string): Promise<void> => {
    const newName = prompt('Enter new name:', currentDesc);
    if (!newName || newName === currentDesc) return;
    await apiClient.put(`/api/datasets/${datasetId}`, { action: 'rename', description: newName });
    reload();
  };

  const handleDeleteDataset = async (datasetId: number): Promise<void> => {
    if (!confirm('Delete this dataset? This cannot be undone.')) return;
    const result = await apiClient.delete(`/api/datasets/${datasetId}`);
    if (!result.success) alert(result.error);
    else reload();
  };

  const handleToggleAutojudge = async (datasetId: number): Promise<void> => {
    await apiClient.put(`/api/datasets/${datasetId}`, { action: 'toggle-autojudge' });
    reload();
  };

  const handleDeleteTestcase = async (tcId: number): Promise<void> => {
    if (!confirm('Delete this testcase?')) return;
    await apiClient.delete(`/api/testcases/${tcId}`);
    reload();
  };

  const handleTogglePublic = async (tcId: number): Promise<void> => {
    await apiClient.put(`/api/testcases/${tcId}`, { action: 'toggle-public' });
    reload();
  };

  return (
    <div className="space-y-6">
      <TaskHeader task={task} locale={locale} onOpenSettings={() => setIsTaskSettingsOpen(true)} />
      <ConfigSection task={task} expanded={expanded.info} onToggle={() => toggle('info')} locale={locale} />
      <StatementsSection statements={task.statements} expanded={expanded.statements} onToggle={() => toggle('statements')} onUpload={() => setIsStatementModalOpen(true)} />
      <DatasetsSection
        datasets={task.datasets}
        activeDatasetId={task.active_dataset_id}
        expanded={expanded.datasets}
        onToggle={() => toggle('datasets')}
        onCreate={() => {
          setEditingDataset(null);
          setIsDatasetModalOpen(true);
        }}
        onEdit={(ds) => {
          setEditingDataset(ds);
          setIsDatasetModalOpen(true);
        }}
        onActivate={handleActivateDataset}
        onClone={handleCloneDataset}
        onRename={handleRenameDataset}
        onToggleAutojudge={handleToggleAutojudge}
        onDelete={handleDeleteDataset}
        onOpenTestcaseUpload={setCurrentDatasetId}
        onDeleteTestcase={handleDeleteTestcase}
        onTogglePublic={handleTogglePublic}
        locale={locale}
      />
      <AttachmentsSection attachments={task.attachments} onUpload={() => setIsAttachmentModalOpen(true)} />

      <TaskModal isOpen={isTaskSettingsOpen} onClose={() => setIsTaskSettingsOpen(false)} task={task as unknown as Parameters<typeof TaskModal>[0]['task']} onSuccess={reload} />
      <DatasetModal isOpen={isDatasetModalOpen} onClose={() => setIsDatasetModalOpen(false)} taskId={task.id} dataset={editingDataset as unknown as Parameters<typeof DatasetModal>[0]['dataset']} onSuccess={reload} />
      <StatementModal isOpen={isStatementModalOpen} onClose={() => setIsStatementModalOpen(false)} taskId={task.id} existingLanguages={task.statements.map((s) => s.language)} onSuccess={reload} />
      <AttachmentModal isOpen={isAttachmentModalOpen} onClose={() => setIsAttachmentModalOpen(false)} taskId={task.id} onSuccess={reload} />
      {currentDatasetId && <TestcaseUploadModal isOpen={true} onClose={() => setCurrentDatasetId(null)} datasetId={currentDatasetId} onSuccess={reload} />}
    </div>
  );
}
