'use client';

import { useState, useEffect } from 'react';
import { X, FileCode, Settings, Clock, Cpu, FileType, CheckSquare } from 'lucide-react';
import { createTask, updateTask, type TaskData } from '@/app/actions/tasks';
import { tasks } from '@prisma/client';
import { PROGRAMMING_LANGUAGES } from '@/lib/constants';
import { useToast } from '@/components/core/Toast';

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  task?: tasks | null;
  onSuccess: () => void;
}

type Tab = 'general' | 'grading' | 'limits' | 'tokens' | 'languages';

const SUBMISSION_FORMATS = ['%s.%l', '%s.zip'];

export function TaskModal({ isOpen, onClose, task, onSuccess }: TaskModalProps) {
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState<Tab>('general');
  const [formData, setFormData] = useState<TaskData>({
    name: '',
    title: '',
    score_mode: 'max',
    feedback_level: 'restricted',
    score_precision: 0,
    allowed_languages: [],
    submission_format: [],
    token_mode: 'disabled',
    token_max_number: undefined,
    token_min_interval: undefined,
    token_gen_initial: 2,
    token_gen_number: 2,
    token_gen_interval: 30,
    token_gen_max: undefined,
    max_submission_number: undefined,
    max_user_test_number: undefined,
    min_submission_interval: undefined,
    min_user_test_interval: undefined,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (task) {
      setFormData({
        name: task.name,
        title: task.title,
        score_mode: task.score_mode,
        feedback_level: task.feedback_level,
        score_precision: task.score_precision,
        allowed_languages: task.allowed_languages,
        submission_format: task.submission_format,
        token_mode: task.token_mode,
        token_max_number: task.token_max_number ?? undefined,
        token_gen_initial: task.token_gen_initial,
        token_gen_number: task.token_gen_number,
        token_gen_max: task.token_gen_max ?? undefined,
        max_submission_number: task.max_submission_number ?? undefined,
        max_user_test_number: task.max_user_test_number ?? undefined,
        token_min_interval: undefined,
        token_gen_interval: undefined,
        min_submission_interval: undefined,
        min_user_test_interval: undefined,
      });
    } else {
      setFormData({
        name: '', title: '', score_mode: 'max', feedback_level: 'restricted', score_precision: 0,
        allowed_languages: [], submission_format: [], token_mode: 'disabled',
        token_gen_initial: 2, token_gen_number: 2, token_gen_interval: 30
      });
    }
    setError('');
  }, [task, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = task
        ? await updateTask(task.id, formData)
        : await createTask(formData);

      if (result.success) {
        if ('warning' in result && result.warning) {
          addToast(result.warning, 'warning');
        } else {
          addToast(task ? 'Task updated successfully' : 'Task created successfully', 'success');
        }
        onSuccess();
        onClose();
      } else {
        setError('error' in result && result.error ? (result.error as string) : 'An error occurred');
      }
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleLanguageToggle = (lang: string) => {
    const current = formData.allowed_languages || [];
    const updated = current.includes(lang)
      ? current.filter((l: string) => l !== lang)
      : [...current, lang];
    setFormData({ ...formData, allowed_languages: updated });
  };

  const handleFormatToggle = (fmt: string) => {
    const current = formData.submission_format || [];
    const updated = current.includes(fmt)
      ? current.filter((f: string) => f !== fmt)
      : [...current, fmt];
    setFormData({ ...formData, submission_format: updated });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden">
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative z-10 w-full max-w-4xl h-[80vh] bg-neutral-900 border border-white/10 rounded-xl shadow-2xl flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <FileCode className="w-5 h-5 text-indigo-400" />
            <h2 className="text-lg font-bold text-white">
              {task ? 'Edit Task' : 'Create New Task'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-5 h-5 text-neutral-400" />
          </button>
        </div>
        
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar Tabs */}
          <div className="w-64 bg-black/20 border-r border-white/10 p-4 space-y-2 overflow-y-auto">
            {[
              { id: 'general', label: 'General', icon: FileCode },
              { id: 'grading', label: 'Grading', icon: CheckSquare },
              { id: 'limits', label: 'Limits', icon: Clock },
              { id: 'tokens', label: 'Tokens', icon: Cpu },
              { id: 'languages', label: 'Files & Languages', icon: FileType },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as Tab)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${activeTab === tab.id
                    ? 'bg-indigo-500/20 text-indigo-400 ring-1 ring-indigo-500/50'
                    : 'text-neutral-400 hover:bg-white/5 hover:text-white'
                  }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Form Content */}
          <div className="flex-1 overflow-y-auto p-8 relative">
            <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                  {error}
                </div>
              )}

              {/* General Tab */}
              {activeTab === 'general' && (
                <div className="space-y-6">
                  <div>
                    <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Task Name (Short ID)</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g., aplusb"
                      required
                      className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Title</label>
                    <input
                      type="text"
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      placeholder="e.g., A Plus B Problem"
                      required
                      className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50 transition-colors"
                    />
                  </div>
                </div>
              )}

              {/* Grading Tab */}
              {activeTab === 'grading' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Score Mode</label>
                      <select
                        value={formData.score_mode}
                        onChange={(e) => setFormData({ ...formData, score_mode: e.target.value })}
                        className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50"
                      >
                        <option value="max">Max</option>
                        <option value="max_subtask">Max Subtask</option>
                        <option value="max_tokened_last">Max Tokened Last</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Feedback Level</label>
                      <select
                        value={formData.feedback_level}
                        onChange={(e) => setFormData({ ...formData, feedback_level: e.target.value })}
                        className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50"
                      >
                        <option value="restricted">Restricted</option>
                        <option value="oi_restricted">OI Restricted</option>
                        <option value="full">Full</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Score Precision</label>
                    <input
                      type="number"
                      value={formData.score_precision}
                      onChange={(e) => setFormData({ ...formData, score_precision: parseInt(e.target.value) || 0 })}
                      className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50"
                    />
                    <p className="text-xs text-neutral-500 mt-1">Number of decimal places for score.</p>
                  </div>
                </div>
              )}

              {/* Limits Tab */}
              {activeTab === 'limits' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Max Submissions</label>
                      <input
                        type="number"
                        value={formData.max_submission_number === undefined ? '' : formData.max_submission_number}
                        onChange={(e) => setFormData({ ...formData, max_submission_number: e.target.value ? parseInt(e.target.value) : undefined })}
                        placeholder="Unlimited"
                        className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Max User Tests</label>
                      <input
                        type="number"
                        value={formData.max_user_test_number === undefined ? '' : formData.max_user_test_number}
                        onChange={(e) => setFormData({ ...formData, max_user_test_number: e.target.value ? parseInt(e.target.value) : undefined })}
                        placeholder="Unlimited"
                        className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Min Submission Interval (s)</label>
                      <input
                        type="number"
                        value={formData.min_submission_interval === undefined ? '' : formData.min_submission_interval}
                        onChange={(e) => setFormData({ ...formData, min_submission_interval: e.target.value ? parseInt(e.target.value) : undefined })}
                        placeholder="0"
                        className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Min User Test Interval (s)</label>
                      <input
                        type="number"
                        value={formData.min_user_test_interval === undefined ? '' : formData.min_user_test_interval}
                        onChange={(e) => setFormData({ ...formData, min_user_test_interval: e.target.value ? parseInt(e.target.value) : undefined })}
                        placeholder="0"
                        className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Tokens Tab */}
              {activeTab === 'tokens' && (
                <div className="space-y-6">
                  <div>
                    <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Token Mode</label>
                    <select
                      value={formData.token_mode}
                      onChange={(e) => setFormData({ ...formData, token_mode: e.target.value })}
                      className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50"
                    >
                      <option value="disabled">Disabled</option>
                      <option value="finite">Finite</option>
                      <option value="infinite">Infinite</option>
                    </select>
                  </div>

                  {formData.token_mode !== 'disabled' && (
                    <div className="grid grid-cols-2 gap-6 p-4 bg-white/5 rounded-xl">
                      <div>
                        <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Max Tokens</label>
                        <input
                          type="number"
                          value={formData.token_max_number === undefined ? '' : formData.token_max_number}
                          onChange={(e) => setFormData({ ...formData, token_max_number: e.target.value ? parseInt(e.target.value) : undefined })}
                          className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Min Interval (s)</label>
                        <input
                          type="number"
                          value={formData.token_min_interval === undefined ? '' : formData.token_min_interval}
                          onChange={(e) => setFormData({ ...formData, token_min_interval: e.target.value ? parseInt(e.target.value) : undefined })}
                          className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Initial Tokens</label>
                        <input
                          type="number"
                          value={formData.token_gen_initial}
                          onChange={(e) => setFormData({ ...formData, token_gen_initial: parseInt(e.target.value) || 0 })}
                          className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Gen Amount</label>
                        <input
                          type="number"
                          value={formData.token_gen_number}
                          onChange={(e) => setFormData({ ...formData, token_gen_number: parseInt(e.target.value) || 0 })}
                          className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Gen Interval (min)</label>
                        <input
                          type="number"
                          value={formData.token_gen_interval === undefined ? '' : formData.token_gen_interval}
                          onChange={(e) => setFormData({ ...formData, token_gen_interval: e.target.value ? parseInt(e.target.value) : undefined })}
                          className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Max Gen Count</label>
                        <input
                          type="number"
                          value={formData.token_gen_max === undefined ? '' : formData.token_gen_max}
                          onChange={(e) => setFormData({ ...formData, token_gen_max: e.target.value ? parseInt(e.target.value) : undefined })}
                          placeholder="Unlimited"
                          className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Languages Tab */}
              {activeTab === 'languages' && (
                <div className="space-y-8">
                  <div>
                    <label className="block text-xs font-bold text-neutral-500 uppercase mb-4">Submission Formats</label>
                    <div className="grid grid-cols-2 gap-3">
                      {SUBMISSION_FORMATS.map(fmt => (
                        <button
                          key={fmt}
                          type="button"
                          onClick={() => handleFormatToggle(fmt)}
                          className={`flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${(formData.submission_format || []).includes(fmt)
                              ? 'bg-indigo-600/20 border-indigo-500/50 text-white'
                              : 'bg-black/30 border-white/5 text-neutral-400 hover:bg-white/5'
                            }`}
                        >
                          <div className={`w-4 h-4 rounded border flex items-center justify-center ${(formData.submission_format || []).includes(fmt) ? 'bg-indigo-500 border-indigo-500' : 'border-neutral-500'
                            }`}>
                            {(formData.submission_format || []).includes(fmt) && <div className="w-2 h-2 bg-white rounded-sm" />}
                          </div>
                          <span>{fmt}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-neutral-500 uppercase mb-4">Allowed Languages</label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {PROGRAMMING_LANGUAGES.map(lang => (
                        <button
                          key={lang}
                          type="button"
                          onClick={() => handleLanguageToggle(lang)}
                          className={`px-3 py-2 rounded-lg text-xs font-medium transition-all text-left truncate ${(formData.allowed_languages || []).includes(lang)
                              ? 'bg-emerald-600/20 text-emerald-400 ring-1 ring-emerald-500/50'
                              : 'bg-black/30 text-neutral-400 hover:bg-white/5'
                            }`}
                        >
                          {lang}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </form>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-white/10 bg-black/40 flex justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 bg-transparent hover:bg-white/5 text-neutral-300 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors disabled:opacity-50 font-medium"
          >
            {loading ? 'Saving...' : (task ? 'Save Changes' : 'Create Task')}
          </button>
        </div>
      </div>
    </div>
  );
}
