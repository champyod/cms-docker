'use client';

import { Info } from 'lucide-react';
import type { TaskData } from '@/app/actions/tasks';

export function InfoButton({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="group relative inline-block ml-1.5 align-middle">
      <Info className="w-3.5 h-3.5 text-neutral-500 hover:text-indigo-400 cursor-help transition-colors" />
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-neutral-800 border border-white/10 rounded-lg text-[11px] font-medium text-neutral-300 w-48 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 pointer-events-none shadow-xl">
        {text}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-neutral-800" />
      </div>
    </div>
  );
}

interface TabProps {
  formData: TaskData;
  onChange: (data: TaskData) => void;
}

export function GeneralTab({ formData, onChange }: TabProps): React.JSX.Element {
  return (
    <div className="space-y-6">
      <div>
        <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">
          Task Name (Short ID)
          <InfoButton text="Unique identifier (e.g., 'aplusb'). Only letters, numbers, underscores and dashes allowed." />
        </label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => onChange({ ...formData, name: e.target.value })}
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
          onChange={(e) => onChange({ ...formData, title: e.target.value })}
          placeholder="e.g., A Plus B Problem"
          required
          className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50 transition-colors"
        />
      </div>
    </div>
  );
}

export function GradingTab({ formData, onChange }: TabProps): React.JSX.Element {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-6">
        <div>
          <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">
            Score Mode
            <InfoButton text="Defines how the final score is calculated from multiple datasets/submissions." />
          </label>
          <select
            value={formData.score_mode}
            onChange={(e) => onChange({ ...formData, score_mode: e.target.value })}
            className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50"
          >
            <option value="max">Max</option>
            <option value="max_subtask">Max Subtask</option>
            <option value="max_tokened_last">Max Tokened Last</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">
            Feedback Level
            <InfoButton text="Determines how much information is shown to the participant after a submission." />
          </label>
          <select
            value={formData.feedback_level}
            onChange={(e) => onChange({ ...formData, feedback_level: e.target.value })}
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
          value={formData.score_precision ?? ''}
          onChange={(e) => onChange({ ...formData, score_precision: e.target.value ? parseInt(e.target.value, 10) : null })}
          placeholder="0"
          className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50"
        />
        <p className="text-xs text-neutral-500 mt-1">Number of decimal places for score.</p>
      </div>
    </div>
  );
}

export function LimitsTab({ formData, onChange }: TabProps): React.JSX.Element {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-6">
        <div>
          <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">
            Max Submissions
            <InfoButton text="Maximum submissions per user. Enter 0 or leave empty for unlimited." />
          </label>
          <input
            type="number"
            value={formData.max_submission_number ?? ''}
            onChange={(e) => onChange({ ...formData, max_submission_number: e.target.value ? parseInt(e.target.value, 10) : null })}
            placeholder="Unlimited"
            className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">
            Max User Tests
            <InfoButton text="Maximum user tests per user. Enter 0 or leave empty for unlimited." />
          </label>
          <input
            type="number"
            value={formData.max_user_test_number ?? ''}
            onChange={(e) => onChange({ ...formData, max_user_test_number: e.target.value ? parseInt(e.target.value, 10) : null })}
            placeholder="Unlimited"
            className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Min Submission Interval (s)</label>
          <input
            type="number"
            value={formData.min_submission_interval ?? ''}
            onChange={(e) => onChange({ ...formData, min_submission_interval: e.target.value ? parseInt(e.target.value, 10) : null })}
            placeholder="0"
            className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Min User Test Interval (s)</label>
          <input
            type="number"
            value={formData.min_user_test_interval ?? ''}
            onChange={(e) => onChange({ ...formData, min_user_test_interval: e.target.value ? parseInt(e.target.value, 10) : null })}
            placeholder="0"
            className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50"
          />
        </div>
      </div>
    </div>
  );
}

export { TokensTab, LanguagesTab } from './task-modal-extra';
