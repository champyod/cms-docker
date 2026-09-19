'use client';

import { useState, useEffect, useCallback } from 'react';
import { Database, Save, Terminal } from 'lucide-react';
import { Dialog } from '@/components/core/Dialog';
import { Button } from '@/components/core/Button';
import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/apiClient';
import { DatasetGeneralForm } from './DatasetGeneralForm';
import { DatasetManagersTab } from './DatasetManagersTab';

interface Manager {
  id: number;
  filename: string;
  digest: string;
}

interface DatasetRecord {
  id: number;
  description: string;
  time_limit: number | null;
  memory_limit: bigint | number | string | null;
  task_type: string;
  score_type: string;
  task_type_parameters?: unknown;
  score_type_parameters?: unknown;
}

interface DatasetModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskId: number;
  dataset?: DatasetRecord | null;
  onSuccess: () => void;
}

interface DatasetFormData {
  description: string;
  time_limit: number;
  memory_limit: number;
  task_type: string;
  score_type: string;
  score_type_parameters: unknown;
  task_type_parameters_text: string;
}

const DEFAULT_FORM: DatasetFormData = {
  description: '',
  time_limit: 1,
  memory_limit: 256,
  task_type: 'Batch',
  score_type: 'Sum',
  score_type_parameters: [],
  task_type_parameters_text: '',
};

function taskParamsToText(params: unknown): string {
  if (params === null || params === undefined) return '';
  if (Array.isArray(params) && params.length === 0) return '';
  try {
    return JSON.stringify(params);
  } catch {
    return '';
  }
}

export function DatasetModal({ isOpen, onClose, taskId, dataset, onSuccess }: DatasetModalProps): React.JSX.Element | null {
  const [activeTab, setActiveTab] = useState<'general' | 'managers'>('general');
  const [formData, setFormData] = useState<DatasetFormData>(DEFAULT_FORM);
  const [error, setError] = useState('');
  const [scoreParamsError, setScoreParamsError] = useState('');
  const [taskParamsError, setTaskParamsError] = useState('');
  const [loading, setLoading] = useState(false);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loadingManagers, setLoadingManagers] = useState(false);

  const loadManagers = useCallback(async (): Promise<void> => {
    if (!dataset?.id) return;
    setLoadingManagers(true);
    try {
      const res = await apiClient.get(`/api/datasets/${dataset.id}/managers`);
      const list: unknown = (res as { data?: unknown }).data;
      if (res.success) setManagers(Array.isArray(list) ? (list as Manager[]) : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingManagers(false);
    }
  }, [dataset?.id]);

  useEffect(() => {
    if (dataset) {
      setFormData({
        description: dataset.description,
        time_limit: dataset.time_limit ?? 1,
        memory_limit: dataset.memory_limit ? Number(dataset.memory_limit) / (1024 * 1024) : 256,
        task_type: dataset.task_type,
        score_type: dataset.score_type,
        score_type_parameters: dataset.score_type_parameters ?? [],
        task_type_parameters_text: taskParamsToText(dataset.task_type_parameters),
      });
      void loadManagers();
    } else {
      setFormData(DEFAULT_FORM);
      setManagers([]);
    }
    setScoreParamsError('');
    setTaskParamsError('');
    setError('');
    setActiveTab('general');
  }, [dataset, isOpen, loadManagers]);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (scoreParamsError || taskParamsError) {
      setError(scoreParamsError || taskParamsError);
      return;
    }
    let taskTypeParameters: unknown = [];
    if (formData.task_type_parameters_text.trim() !== '') {
      try {
        taskTypeParameters = JSON.parse(formData.task_type_parameters_text) as unknown;
      } catch {
        setError('Task type parameters must be valid JSON.');
        return;
      }
    }
    setError('');
    setLoading(true);
    try {
      const payload = {
        ...formData,
        // Why megabytes here: the datasets routes validate 1-4096 MB and
        // convert to bytes themselves, so sending bytes fails validation.
        memory_limit: formData.memory_limit,
        task_type_parameters: taskTypeParameters,
        task_type_parameters_text: undefined,
      };
      const result = dataset
        ? await apiClient.put(`/api/datasets/${dataset.id}`, { action: 'update', ...payload })
        : await apiClient.post('/api/datasets', { taskId, ...payload });
      if (result.success) {
        onSuccess();
        onClose();
      } else {
        setError(result.error ?? 'Operation failed');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      console.error('Dataset operation error:', err);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={dataset ? `Edit Dataset: ${dataset.description}` : 'Create New Dataset'}
      description="Configure dataset parameters and managers"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
            Close
          </Button>
          {activeTab === 'general' && (
            <Button
              type="button"
              variant="positive"
              icon={Save}
              loading={loading}
              disabled={loading}
              onClick={() => (document.getElementById('dataset-form') as HTMLFormElement)?.requestSubmit()}
            >
              {dataset ? 'Save Changes' : 'Create Dataset'}
            </Button>
          )}
        </>
      }
      className="flex max-h-[70vh] w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-3xl"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">
        <div className="w-full shrink-0 space-y-2 overflow-y-auto border-b border-border bg-muted/20 p-4 max-sm:flex max-sm:flex-row max-sm:flex-wrap max-sm:gap-1 max-sm:overflow-x-auto sm:w-48 sm:border-b-0 sm:border-r">
          <button
            onClick={() => setActiveTab('general')}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors max-sm:flex-1 max-sm:justify-center max-sm:rounded-md max-sm:border max-sm:border-border',
              activeTab === 'general'
                ? 'bg-primary/10 text-primary ring-1 ring-ring/50'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Database className="w-4 h-4" />
            General
          </button>
          <button
            onClick={() => setActiveTab('managers')}
            disabled={!dataset}
            title={!dataset ? 'Save dataset first' : undefined}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors max-sm:flex-1 max-sm:justify-center max-sm:rounded-md max-sm:border max-sm:border-border',
              activeTab === 'managers'
                ? 'bg-primary/10 text-primary ring-1 ring-ring/50'
                : !dataset
                  ? 'cursor-not-allowed text-muted-foreground opacity-50'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Terminal className="w-4 h-4" />
            Managers
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'general' && (
            <DatasetGeneralForm
              formData={formData}
              onChange={setFormData}
              onSubmit={handleSubmit}
              error={error}
              scoreParamsError={scoreParamsError}
              taskParamsError={taskParamsError}
              onScoreParamsChange={(scoreParams) => setFormData((prev) => ({ ...prev, score_type_parameters: scoreParams }))}
              onScoreParamsError={setScoreParamsError}
              onTaskParamsTextChange={(text, paramsError) => {
                setFormData((prev) => ({ ...prev, task_type_parameters_text: text }));
                setTaskParamsError(paramsError);
              }}
            />
          )}
          {activeTab === 'managers' && dataset && (
            <DatasetManagersTab datasetId={dataset.id} managers={managers} loadingManagers={loadingManagers} onReload={loadManagers} />
          )}
        </div>
      </div>
    </Dialog>
  );
}
