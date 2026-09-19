'use client';

import { useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { DatasetScoreParamsEditor } from './DatasetScoreParamsEditor';
import { convertScoreParams } from './dataset-score-params';

interface DatasetFormData {
  description: string;
  time_limit: number;
  memory_limit: number;
  task_type: string;
  score_type: string;
  score_type_parameters: unknown;
  task_type_parameters_text: string;
}

const TASK_TYPES = ['Batch', 'OutputOnly', 'Communication', 'TwoSteps'];
const SCORE_TYPES = ['Sum', 'GroupMin', 'GroupMul', 'GroupThreshold'];

interface DatasetGeneralFormProps {
  formData: DatasetFormData;
  onChange: (data: DatasetFormData) => void;
  onSubmit: (e: React.FormEvent) => void;
  error: string;
  scoreParamsError: string;
  taskParamsError: string;
  onScoreParamsChange: (params: unknown) => void;
  onScoreParamsError: (error: string) => void;
  onTaskParamsTextChange: (text: string, error: string) => void;
}

function lintTaskTypeParams(text: string): string {
  if (text.trim() === '') return '';
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return 'Task type parameters must be a JSON array.';
  } catch {
    return 'Task type parameters must be valid JSON.';
  }
  return '';
}

export function DatasetGeneralForm({
  formData,
  onChange,
  onSubmit,
  error,
  scoreParamsError,
  taskParamsError,
  onScoreParamsChange,
  onScoreParamsError,
  onTaskParamsTextChange,
}: DatasetGeneralFormProps): React.JSX.Element {
  const pastedTaskParamsRef = useRef(false);
  const [taskParamsPasted, setTaskParamsPasted] = useState(false);

  const handleTaskParamsChange = (value: string): void => {
    if (pastedTaskParamsRef.current) {
      pastedTaskParamsRef.current = false;
      setTaskParamsPasted(true);
      onTaskParamsTextChange(value, '');
      return;
    }
    setTaskParamsPasted(false);
    onTaskParamsTextChange(value, lintTaskTypeParams(value));
  };

  const handleScoreTypeChange = (scoreType: string): void => {
    onScoreParamsError('');
    onChange({
      ...formData,
      score_type: scoreType,
      score_type_parameters: convertScoreParams(formData.score_type_parameters, formData.score_type, scoreType),
    });
  };
  return (
    <form id="dataset-form" onSubmit={onSubmit} className="space-y-6">
      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-3 text-destructive">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-bold text-muted-foreground uppercase mb-1.5">Description</label>
          <input
            type="text"
            value={formData.description}
            onChange={(e) => onChange({ ...formData, description: e.target.value })}
            className="w-full px-4 py-2.5 bg-muted/40 border border-border rounded-lg text-foreground focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
            placeholder="e.g. Default, IOI 2024"
            required
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="block text-xs font-bold text-muted-foreground uppercase mb-1.5">Time Limit (s)</label>
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={formData.time_limit}
              onChange={(e) => onChange({ ...formData, time_limit: parseFloat(e.target.value) })}
              className="w-full px-4 py-2.5 bg-muted/40 border border-border rounded-lg text-foreground focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-muted-foreground uppercase mb-1.5">Memory Limit (MiB)</label>
            <input
              type="number"
              min="16"
              value={formData.memory_limit}
              onChange={(e) => onChange({ ...formData, memory_limit: parseFloat(e.target.value) })}
              className="w-full px-4 py-2.5 bg-muted/40 border border-border rounded-lg text-foreground focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="block text-xs font-bold text-muted-foreground uppercase mb-1.5">Task Type</label>
            <select
              value={formData.task_type}
              onChange={(e) => onChange({ ...formData, task_type: e.target.value })}
              className="w-full px-4 py-2.5 bg-muted/40 border border-border rounded-lg text-foreground focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
            >
              {TASK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-muted-foreground uppercase mb-1.5">Score Type</label>
            <select
              value={formData.score_type}
              onChange={(e) => handleScoreTypeChange(e.target.value)}
              className="w-full px-4 py-2.5 bg-muted/40 border border-border rounded-lg text-foreground focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
            >
              {SCORE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-muted-foreground uppercase mb-1.5">Subtasks (score parameters)</label>
          <DatasetScoreParamsEditor
            scoreType={formData.score_type}
            params={formData.score_type_parameters}
            onParamsChange={onScoreParamsChange}
            onLintError={onScoreParamsError}
          />
          {scoreParamsError && <p className="text-xs text-destructive mt-2">{scoreParamsError}</p>}
        </div>

        <div onPasteCapture={() => { pastedTaskParamsRef.current = true; }}>
          <label className="block text-xs font-bold text-muted-foreground uppercase mb-1.5">Task type parameters (JSON)</label>
          <textarea
            value={formData.task_type_parameters_text}
            onChange={(e) => handleTaskParamsChange(e.target.value)}
            rows={3}
            spellCheck={false}
            className="w-full px-4 py-2.5 bg-muted/40 border border-border rounded-lg text-foreground font-mono text-sm focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
            placeholder='e.g. ["alone", ["input.txt", "output.txt"], "diff"]'
          />
          <p className="text-xs text-muted-foreground mt-1.5">
            Raw parameters passed to the {formData.task_type} task type. Leave empty for defaults.
            {taskParamsPasted && ' Pasted content applied without lint. Edit manually to re-lint.'}
          </p>
          {taskParamsError && <p className="text-xs text-destructive mt-1.5">{taskParamsError}</p>}
        </div>
      </div>
    </form>
  );
}
