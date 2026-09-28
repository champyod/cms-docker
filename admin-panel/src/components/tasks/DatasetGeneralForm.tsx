'use client';

import { useRef } from 'react';
import { DatasetScoreParamsEditor } from './DatasetScoreParamsEditor';
import { DatasetTaskTypeParamsEditor } from './DatasetTaskTypeParamsEditor';
import { InlineAlert } from '@/components/core/InlineAlert';
import { convertScoreParams } from './dataset-score-params';
import { defaultTaskTypeParams, lintTaskTypeFields, taskTypeParamsToFields } from './dataset-tasktype-params';

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

interface ParsedTaskParams {
  params: unknown;
  error: string;
}

/** The list the editor reads back: a stored JSON list, or null when nothing is
 *  stored, which the editor shows as the defaults for the task type. */
function readTaskParamsText(text: string): ParsedTaskParams {
  if (text.trim() === '') return { params: null, error: '' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { params: null, error: 'Task type parameters must be valid JSON.' };
  }
  if (!Array.isArray(parsed)) return { params: null, error: 'Task type parameters must be a JSON array.' };
  return { params: parsed, error: '' };
}

function formatTaskParamsText(params: unknown): string {
  if (params === null || params === undefined) return '';
  if (Array.isArray(params) && params.length === 0) return '';
  return JSON.stringify(params);
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
  const { params: taskParams, error: taskParamsTextError } = readTaskParamsText(formData.task_type_parameters_text);
  const taskParamsFieldError = lintTaskTypeFields(taskTypeParamsToFields(taskParams, formData.task_type), formData.task_type);
  const shownTaskParamsError = taskParamsError || taskParamsTextError || taskParamsFieldError;

  // Why the ref: the editor reports the verdict before the list it was read
  // from, so the list write has to carry the verdict again. Safe because the
  // editor never reports a list without reporting a fresh verdict first.
  const taskParamsVerdictRef = useRef(taskParamsError);

  const handleTaskParamsChange = (params: unknown): void => {
    onTaskParamsTextChange(formatTaskParamsText(params), taskParamsVerdictRef.current);
  };

  const handleTaskParamsLint = (error: string): void => {
    taskParamsVerdictRef.current = error;
    onTaskParamsTextChange(formData.task_type_parameters_text, error);
  };

  // Why the defaults: another task type reads a different list, so keeping the
  // previous one would store a list the worker cannot use.
  const handleTaskTypeChange = (taskType: string): void => {
    onChange({ ...formData, task_type: taskType });
    onTaskParamsTextChange(formatTaskParamsText(defaultTaskTypeParams(taskType)), '');
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
      {error && <InlineAlert tone="destructive" className="border-destructive/20 text-destructive">{error}</InlineAlert>}

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
              onChange={(e) => handleTaskTypeChange(e.target.value)}
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

        <div>
          <label className="block text-xs font-bold text-muted-foreground uppercase mb-1.5">Task type parameters</label>
          <DatasetTaskTypeParamsEditor
            taskType={formData.task_type}
            params={taskParams}
            onParamsChange={handleTaskParamsChange}
            onLintError={handleTaskParamsLint}
          />
          <p className="text-xs text-muted-foreground mt-1.5">
            Parameters the {formData.task_type} task type reads. The visual fields hold this type&apos;s defaults; JSON is the list the worker receives.
          </p>
          {shownTaskParamsError && <p className="text-xs text-destructive mt-1.5">{shownTaskParamsError}</p>}
        </div>
      </div>
    </form>
  );
}
