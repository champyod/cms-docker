'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Database, Loader2, Save, Terminal } from 'lucide-react';
import { Portal } from '../core/Portal';
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
}

const DEFAULT_FORM: DatasetFormData = {
  description: '',
  time_limit: 1,
  memory_limit: 256,
  task_type: 'Batch',
  score_type: 'Sum',
};

export function DatasetModal({ isOpen, onClose, taskId, dataset, onSuccess }: DatasetModalProps): React.JSX.Element | null {
  const [activeTab, setActiveTab] = useState<'general' | 'managers'>('general');
  const [formData, setFormData] = useState<DatasetFormData>(DEFAULT_FORM);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loadingManagers, setLoadingManagers] = useState(false);

  const loadManagers = useCallback(async (): Promise<void> => {
    if (!dataset?.id) return;
    setLoadingManagers(true);
    try {
      const res = await apiClient.get(`/api/datasets/${dataset.id}/managers`);
      if (res.success) setManagers(res.data as Manager[]);
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
      });
      void loadManagers();
    } else {
      setFormData(DEFAULT_FORM);
      setManagers([]);
    }
    setActiveTab('general');
  }, [dataset, isOpen, loadManagers]);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const payload = { ...formData, memory_limit: formData.memory_limit * 1024 * 1024 };
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
    <Portal>
      <div className="fixed inset-0 z-50 flex overflow-hidden">
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={onClose} />
        <div className="relative w-full max-w-2xl bg-neutral-900 border-l border-white/10 shadow-2xl flex flex-col ml-auto h-full animate-in slide-in-from-right duration-300">
          <div className="flex items-center justify-between p-6 border-b border-white/10">
            <div className="flex items-center gap-3">
              <Database className="w-6 h-6 text-amber-400" />
              <div>
                <h2 className="text-xl font-bold text-white">
                  {dataset ? `Edit Dataset: ${dataset.description}` : 'Create New Dataset'}
                </h2>
                <p className="text-sm text-neutral-400">Configure dataset parameters and managers</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-neutral-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 flex overflow-hidden">
            <div className="w-48 border-r border-white/5 bg-black/20 p-4 space-y-2">
              <button
                onClick={() => setActiveTab('general')}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'general' ? 'bg-amber-600/20 text-amber-400' : 'text-neutral-400 hover:text-white hover:bg-white/5'}`}
              >
                <Database className="w-4 h-4" />
                General
              </button>
              <button
                onClick={() => setActiveTab('managers')}
                disabled={!dataset}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'managers' ? 'bg-amber-600/20 text-amber-400' : !dataset ? 'opacity-50 cursor-not-allowed text-neutral-500' : 'text-neutral-400 hover:text-white hover:bg-white/5'}`}
                title={!dataset ? 'Save dataset first' : ''}
              >
                <Terminal className="w-4 h-4" />
                Managers
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {activeTab === 'general' && <DatasetGeneralForm formData={formData} onChange={setFormData} onSubmit={handleSubmit} error={error} />}
              {activeTab === 'managers' && dataset && (
                <DatasetManagersTab datasetId={dataset.id} managers={managers} loadingManagers={loadingManagers} onReload={loadManagers} />
              )}
            </div>
          </div>

          <div className="p-6 border-t border-white/10 bg-black/20 flex justify-end gap-3">
            <button onClick={onClose} className="px-4 py-2 bg-transparent hover:bg-white/5 text-neutral-300 rounded-lg transition-colors border border-transparent hover:border-white/10">
              Close
            </button>
            {activeTab === 'general' && (
              <button
                onClick={() => (document.getElementById('dataset-form') as HTMLFormElement)?.requestSubmit()}
                disabled={loading}
                className="flex items-center gap-2 px-6 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-amber-900/20"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {dataset ? 'Save Changes' : 'Create Dataset'}
              </button>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
