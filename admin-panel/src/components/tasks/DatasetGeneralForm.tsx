'use client';

import { AlertCircle } from 'lucide-react';

interface DatasetFormData {
  description: string;
  time_limit: number;
  memory_limit: number;
  task_type: string;
  score_type: string;
}

const TASK_TYPES = ['Batch', 'OutputOnly', 'Communication', 'TwoSteps'];
const SCORE_TYPES = ['Sum', 'GroupMin', 'GroupMul', 'GroupThreshold'];

interface DatasetGeneralFormProps {
  formData: DatasetFormData;
  onChange: (data: DatasetFormData) => void;
  onSubmit: (e: React.FormEvent) => void;
  error: string;
}

export function DatasetGeneralForm({ formData, onChange, onSubmit, error }: DatasetGeneralFormProps): React.JSX.Element {
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

        <div className="grid grid-cols-2 gap-4">
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

        <div className="grid grid-cols-2 gap-4">
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
              onChange={(e) => onChange({ ...formData, score_type: e.target.value })}
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
      </div>
    </form>
  );
}
