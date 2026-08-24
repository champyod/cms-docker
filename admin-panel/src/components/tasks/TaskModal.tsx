'use client';

import { useState, useEffect } from 'react';
import { FileCode, Settings, Clock, Cpu, FileType, CheckSquare } from 'lucide-react';
import type { TaskData } from '@/app/actions/tasks';
import { apiClient } from '@/lib/apiClient';
import { useToast } from '@/components/providers/ToastProvider';
import { Dialog } from '@/components/core/Dialog';
import { Button } from '@/components/core/Button';
import { cn } from '@/lib/utils';
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={task ? 'Edit Task' : 'Create New Task'}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" form="task-form" variant="positive" loading={loading} disabled={loading} className="min-w-[140px]">
            {task ? 'Save Changes' : 'Create Task'}
          </Button>
        </>
      }
      className="flex h-[85vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
    >
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="w-64 shrink-0 space-y-2 overflow-y-auto border-r border-border bg-muted/20 p-4">
          {TAB_CONFIG.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors',
                activeTab === tab.id
                  ? 'bg-primary/10 text-primary ring-1 ring-ring/50'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative flex-1 overflow-y-auto p-8">
          <form id="task-form" onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
            {error && <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
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
    </Dialog>
  );
}
