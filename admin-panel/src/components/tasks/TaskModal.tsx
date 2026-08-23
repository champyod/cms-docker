'use client';

import { useState, useEffect } from 'react';
import { X, FileCode, Settings, Clock, Cpu, FileType, CheckSquare } from 'lucide-react';
import type { TaskData } from '@/app/actions/tasks';
import { apiClient } from '@/lib/apiClient';
import { useToast } from '@/components/providers/ToastProvider';
import { Portal } from '@/components/core/Portal';
import { parseIntervalToSeconds } from '@/lib/task-intervals';
import { GeneralTab, GradingTab, LimitsTab, TokensTab, LanguagesTab } from './task-modal-sections';

interface TaskRecord {
  id: number;
  name: string;
  title: string;
  score_mode: string;
  feedback_level: string;
  score_precision: number | null;
  allowed_languages: string[];
  submission_format: string[];
  token_mode: string;
  token_max_number: number | null;
  token_min_interval: unknown;
  token_gen_initial: number | null;
  token_gen_number: number | null;
  token_gen_interval: unknown;
  token_gen_max: number | null;
  max_submission_number: number | null;
  max_user_test_number: number | null;
  min_submission_interval: unknown;
  min_user_test_interval: unknown;
}

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  task?: TaskRecord | null;
  onSuccess: () => void;
}

type Tab = 'general' | 'grading' | 'limits' | 'tokens' | 'languages';

const TAB_CONFIG: Array<{ id: Tab; label: string; icon: typeof FileCode }> = [
  { id: 'general', label: 'General', icon: FileCode },
  { id: 'grading', label: 'Grading', icon: CheckSquare },
  { id: 'limits', label: 'Limits', icon: Clock },
  { id: 'tokens', label: 'Tokens', icon: Cpu },
  { id: 'languages', label: 'Files & Languages', icon: FileType },
];

const EMPTY_FORM: TaskData = {
  name: '',
  title: '',
  score_mode: 'max',
  feedback_level: 'restricted',
  score_precision: 0,
  allowed_languages: [],
  submission_format: [],
  token_mode: 'disabled',
  token_max_number: null,
  token_min_interval: null,
  token_gen_initial: null,
  token_gen_number: null,
  token_gen_interval: null,
  token_gen_max: null,
  max_submission_number: null,
  max_user_test_number: null,
  min_submission_interval: null,
  min_user_test_interval: null,
};

function mapTaskToForm(task: TaskRecord): TaskData {
  const name = task.name;
  const formats = (task.submission_format ?? []).map((fmt: string) =>
    name ? fmt.replace(new RegExp(`^${name}(\\.|$)`), '%s$1') : fmt
  );
  return {
    name: task.name,
    title: task.title,
    score_mode: task.score_mode,
    feedback_level: task.feedback_level,
    score_precision: task.score_precision,
    allowed_languages: task.allowed_languages,
    submission_format: formats,
    token_mode: task.token_mode,
    token_max_number: task.token_max_number,
    token_gen_initial: task.token_gen_initial,
    token_gen_number: task.token_gen_number,
    token_gen_max: task.token_gen_max,
    max_submission_number: task.max_submission_number,
    max_user_test_number: task.max_user_test_number,
    token_min_interval: parseIntervalToSeconds(task.token_min_interval) ?? null,
    token_gen_interval:
      parseIntervalToSeconds(task.token_gen_interval) !== undefined
        ? Math.floor(parseIntervalToSeconds(task.token_gen_interval)! / 60)
        : null,
    min_submission_interval: parseIntervalToSeconds(task.min_submission_interval) ?? null,
    min_user_test_interval: parseIntervalToSeconds(task.min_user_test_interval) ?? null,
  };
}

export function TaskModal({ isOpen, onClose, task, onSuccess }: TaskModalProps): React.JSX.Element | null {
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState<Tab>('general');
  const [formData, setFormData] = useState<TaskData>(EMPTY_FORM);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (task) setFormData(mapTaskToForm(task));
    else setFormData(EMPTY_FORM);
    setError('');
  }, [task, isOpen]);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = task
        ? await apiClient.put(`/api/tasks/${task.id}`, formData)
        : await apiClient.post('/api/tasks', formData);
      if (result.success) {
        addToast({
          type: 'success',
          title: task ? 'Task updated' : 'Task created',
          message: task ? 'Task updated successfully' : 'Task created successfully',
        });
        onSuccess();
        onClose();
      } else {
        setError(result.error ?? 'An error occurred');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleLanguageToggle = (lang: string): void => {
    const current = formData.allowed_languages ?? [];
    const updated = current.includes(lang) ? current.filter((l) => l !== lang) : [...current, lang];
    setFormData({ ...formData, allowed_languages: updated });
  };

  const handleFormatToggle = (fmt: string): void => {
    const current = formData.submission_format ?? [];
    const updated = current.includes(fmt) ? current.filter((f) => f !== fmt) : [...current, fmt];
    setFormData({ ...formData, submission_format: updated });
  };

  if (!isOpen) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-100 flex items-center justify-center overflow-hidden">
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
        <div className="relative z-10 w-full max-w-4xl h-[80vh] bg-neutral-900 border border-white/10 rounded-xl shadow-2xl flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
            <div className="flex items-center gap-2">
              <FileCode className="w-5 h-5 text-indigo-400" />
              <h2 className="text-lg font-bold text-white">{task ? 'Edit Task' : 'Create New Task'}</h2>
            </div>
            <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors" title="Close modal">
              <X className="w-5 h-5 text-neutral-400" />
            </button>
          </div>

          <div className="flex flex-1 overflow-hidden">
            <div className="w-64 bg-black/20 border-r border-white/10 p-4 space-y-2 overflow-y-auto">
              {TAB_CONFIG.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${activeTab === tab.id ? 'bg-indigo-500/20 text-indigo-400 ring-1 ring-indigo-500/50' : 'text-neutral-400 hover:bg-white/5 hover:text-white'}`}
                >
                  <tab.icon className="w-4 h-4" />
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-8 relative">
              <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
                {error && <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">{error}</div>}
                {activeTab === 'general' && <GeneralTab formData={formData} onChange={setFormData} />}
                {activeTab === 'grading' && <GradingTab formData={formData} onChange={setFormData} />}
                {activeTab === 'limits' && <LimitsTab formData={formData} onChange={setFormData} />}
                {activeTab === 'tokens' && <TokensTab formData={formData} onChange={setFormData} />}
                {activeTab === 'languages' && (
                  <LanguagesTab formData={formData} onChange={setFormData} onToggleLanguage={handleLanguageToggle} onToggleFormat={handleFormatToggle} />
                )}
              </form>
            </div>
          </div>

          <div className="p-4 border-t border-white/10 bg-black/40 flex justify-end gap-3 shrink-0">
            <button type="button" onClick={onClose} className="px-6 py-2 bg-transparent hover:bg-white/5 text-neutral-300 rounded-lg transition-colors">
              Cancel
            </button>
            <button onClick={handleSubmit} disabled={loading} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors disabled:opacity-50 font-medium">
              {loading ? 'Saving...' : task ? 'Save Changes' : 'Create Task'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
