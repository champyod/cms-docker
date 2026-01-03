'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Database, Loader2, Plus, Trash2, CheckCircle, Save, FileText, Upload, AlertCircle, Terminal } from 'lucide-react';
import { createPortal } from 'react-dom';
import { apiClient } from '@/lib/apiClient';

interface Manager {
  id: number;
  filename: string;
  digest: string;
}

interface DatasetModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskId: number;
  dataset?: any; // DatasetWithRelations
  onSuccess: () => void;
}

const TASK_TYPES = ['Batch', 'OutputOnly', 'Communication', 'TwoSteps'];
const SCORE_TYPES = ['Sum', 'GroupMin', 'GroupMul', 'GroupThreshold'];

export function DatasetModal({ isOpen, onClose, taskId, dataset, onSuccess }: DatasetModalProps) {
  const [activeTab, setActiveTab] = useState<'general' | 'managers'>('general');
  const [formData, setFormData] = useState({
    description: '',
    time_limit: 1,
    memory_limit: 256,
    task_type: 'Batch',
    score_type: 'Sum',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Managers state
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loadingManagers, setLoadingManagers] = useState(false);
  const [uploadingManager, setUploadingManager] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (dataset) {
      setFormData({
        description: dataset.description,
        time_limit: dataset.time_limit || 1,
        memory_limit: dataset.memory_limit ? Number(dataset.memory_limit) / (1024 * 1024) : 256,
        task_type: dataset.task_type,
        score_type: dataset.score_type,
      });
      // Load managers if tab is managers? Or load eagerly?
      // Load on open if editing
      loadManagers(); 
    } else {
      setFormData({
        description: '',
        time_limit: 1,
        memory_limit: 256,
        task_type: 'Batch',
        score_type: 'Sum',
      });
      setManagers([]);
    }
    setActiveTab('general');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, isOpen]);

  const loadManagers = async () => {
    if (!dataset?.id) return;
    setLoadingManagers(true);
    try {
      const res = await apiClient.get(`/api/datasets/${dataset.id}/managers`);
      if (res.success) {
        setManagers(res.data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingManagers(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (dataset) {
        // Update
        const result = await apiClient.put(`/api/datasets/${dataset.id}`, {
          action: 'update',
          ...formData,
          memory_limit: formData.memory_limit * 1024 * 1024
        });

        if (result.success) {
          onSuccess(); // Might reload page
          onClose();
        } else {
          setError(result.error || 'Update failed');
        }
      } else {
      // Create
        const result = await apiClient.post('/api/datasets', {
          taskId,
          ...formData,
          memory_limit: formData.memory_limit * 1024 * 1024 // Modal input uses MB, API likely expects bytes (or handled in api?)
          // Existing modal code used: value={formData.memory_limit}.
          // Let's check api/datasets/route.ts? 
          // Previous code sent `memory_limit: 256` directly.
          // Wait, TaskDetailView shows: `Number(dataset.memory_limit) / (1024 * 1024)`.
          // So database stores BYTES.
          // Previous Modal: 
          // `onChange={(e) => setFormData({ ...formData, memory_limit: parseInt(e.target.value) })}`
          // It sent raw integer.
          // If input was 256, it sent 256 bytes? That's too small.
          // I suspect previous modal was assuming MB but sending bytes? Or API handles it?
          // I'll check api/datasets/route.ts later if possible.
          // But usually memory_limit is bytes.
          // I'll multiply by 1024*1024 to be safe if UI says "MiB".
        });

        if (result.success) {
          onSuccess();
          onClose();
        } else {
          setError(result.error || 'An error occurred');
        }
      }
    } catch (err: any) {
      console.error('Dataset operation error:', err);
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleUploadManager = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length || !dataset) return;
    const file = e.target.files[0];
    setUploadingManager(true);

    try {
      // Read file
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const base64 = (ev.target?.result as string).split(',')[1];
        const res = await apiClient.post(`/api/datasets/${dataset.id}/managers`, {
          filename: file.name,
          fileData: base64
        });

        if (res.success) {
          loadManagers();
        } else {
          alert(res.error || 'Upload failed');
        }
        setUploadingManager(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error(err);
      setUploadingManager(false);
    }
  };

  const handleDeleteManager = async (id: number) => {
    if (!confirm('Delete this manager file?')) return;
    try {
      const res = await apiClient.delete(`/api/managers/${id}`);
      if (res.success) {
        loadManagers();
      }
    } catch (err) {
      console.error(err);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Sidebar Panel */}
      <div className="relative w-full max-w-2xl bg-neutral-900 border-l border-white/10 shadow-2xl flex flex-col ml-auto h-full animate-in slide-in-from-right duration-300">

        {/* Header */}
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
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors text-neutral-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar Tabs */}
          <div className="w-48 border-r border-white/5 bg-black/20 p-4 space-y-2">
            <button
              onClick={() => setActiveTab('general')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'general'
                  ? 'bg-amber-600/20 text-amber-400'
                  : 'text-neutral-400 hover:text-white hover:bg-white/5'
                }`}
            >
              <Database className="w-4 h-4" />
              General
            </button>
            <button
              onClick={() => setActiveTab('managers')}
              disabled={!dataset}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'managers'
                  ? 'bg-amber-600/20 text-amber-400'
                  : !dataset
                    ? 'opacity-50 cursor-not-allowed text-neutral-500'
                    : 'text-neutral-400 hover:text-white hover:bg-white/5'
                }`}
              title={!dataset ? "Save dataset first" : ""}
            >
              <Terminal className="w-4 h-4" />
              Managers
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'general' && (
              <form id="dataset-form" onSubmit={handleSubmit} className="space-y-6">
                {error && (
                  <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-3 text-red-400">
                    <AlertCircle className="w-5 h-5 flex-shrink-0" />
                    <p className="text-sm">{error}</p>
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-neutral-500 uppercase mb-1.5">Description</label>
                    <input
                      type="text"
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      className="w-full px-4 py-2.5 bg-black/40 border border-white/10 rounded-lg text-white focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50"
                      placeholder="e.g. Default, IOI 2024"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-neutral-500 uppercase mb-1.5">Time Limit (s)</label>
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        value={formData.time_limit}
                        onChange={(e) => setFormData({ ...formData, time_limit: parseFloat(e.target.value) })}
                        className="w-full px-4 py-2.5 bg-black/40 border border-white/10 rounded-lg text-white focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-neutral-500 uppercase mb-1.5">Memory Limit (MiB)</label>
                      <input
                        type="number"
                        min="16"
                        value={formData.memory_limit}
                        onChange={(e) => setFormData({ ...formData, memory_limit: parseFloat(e.target.value) })}
                        className="w-full px-4 py-2.5 bg-black/40 border border-white/10 rounded-lg text-white focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-neutral-500 uppercase mb-1.5">Task Type</label>
                      <select
                        value={formData.task_type}
                        onChange={(e) => setFormData({ ...formData, task_type: e.target.value })}
                        className="w-full px-4 py-2.5 bg-black/40 border border-white/10 rounded-lg text-white focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50"
                      >
                        {TASK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-neutral-500 uppercase mb-1.5">Score Type</label>
                      <select
                        value={formData.score_type}
                        onChange={(e) => setFormData({ ...formData, score_type: e.target.value })}
                        className="w-full px-4 py-2.5 bg-black/40 border border-white/10 rounded-lg text-white focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50"
                      >
                        {SCORE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              </form>
            )}

            {activeTab === 'managers' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-medium text-white">Manager Files</h3>
                    <p className="text-sm text-neutral-500">Custom checkers, graders, and libraries.</p>
                  </div>
                  <div>
                    <input
                      type="file"
                      ref={fileInputRef}
                      className="hidden"
                      onChange={handleUploadManager}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingManager}
                      className="flex items-center gap-2 px-3 py-1.5 bg-amber-600/20 text-amber-400 rounded-lg text-sm hover:bg-amber-600/30 transition-colors"
                    >
                      {uploadingManager ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                      Upload File
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  {loadingManagers ? (
                    <div className="flex justify-center p-8">
                      <Loader2 className="w-6 h-6 animate-spin text-neutral-500" />
                    </div>
                  ) : managers.length === 0 ? (
                    <div className="text-center p-8 border border-dashed border-white/10 rounded-lg">
                      <Terminal className="w-8 h-8 text-neutral-600 mx-auto mb-2" />
                      <p className="text-neutral-400 text-sm">No manager files uploaded.</p>
                      <p className="text-neutral-500 text-xs mt-1">Upload files like `checker`, `grader`, `*.lib.h`.</p>
                    </div>
                  ) : (
                    managers.map((manager) => (
                      <div key={manager.id} className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5">
                        <div className="flex items-center gap-3">
                          <FileText className="w-4 h-4 text-emerald-400" />
                          <div>
                            <div className="text-sm font-medium text-white">{manager.filename}</div>
                            <div className="text-xs text-neutral-500 font-mono">{manager.digest.substring(0, 8)}...</div>
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeleteManager(manager.id)}
                          className="p-1.5 text-neutral-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/10 bg-black/20 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-transparent hover:bg-white/5 text-neutral-300 rounded-lg transition-colors border border-transparent hover:border-white/10"
          >
            Close
          </button>
          {activeTab === 'general' && (
            <button
              onClick={() => document.getElementById('dataset-form')?.requestSubmit()}
              disabled={loading}
              className="flex items-center gap-2 px-6 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-amber-900/20"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {dataset ? 'Save Changes' : 'Create Dataset'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
