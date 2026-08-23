'use client';

import Link from 'next/link';
import { HelpCircle, ChevronDown, ChevronUp, Settings, FileText, Trash2, Upload, ExternalLink } from 'lucide-react';
import { Card } from '@/components/core/Card';
import { apiClient } from '@/lib/apiClient';

interface TaskDetailConfigProps {
  task: { score_precision: number; score_mode: string; feedback_level: string; _count: { submissions: number } };
  expanded: boolean;
  onToggle: () => void;
  locale: string;
}

export function ConfigSection({ task, expanded, onToggle, locale }: TaskDetailConfigProps): React.JSX.Element {
  return (
    <Card className="glass-card border-white/5 overflow-hidden">
      <div className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-3">
          <Settings className="w-5 h-5 text-indigo-400" />
          <span className="font-bold text-white">Configuration</span>
        </div>
        <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
          <Link href={`/${locale}/docs#task-types`} className="p-1 hover:bg-white/10 rounded-full transition-colors text-neutral-400 hover:text-white" title="View Documentation">
            <HelpCircle className="w-4 h-4" />
          </Link>
          <button onClick={onToggle} className="p-1">{expanded ? <ChevronUp className="w-4 h-4 text-neutral-400" /> : <ChevronDown className="w-4 h-4 text-neutral-400" />}</button>
        </div>
      </div>
      {expanded && (
        <div className="p-4 pt-0 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-black/30 p-3 rounded-lg border border-white/5"><label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Score Precision</label><div className="text-white text-sm">{task.score_precision}</div></div>
          <div className="bg-black/30 p-3 rounded-lg border border-white/5"><label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Score Mode</label><div className="text-white text-sm capitalize">{task.score_mode.replace(/_/g, ' ')}</div></div>
          <div className="bg-black/30 p-3 rounded-lg border border-white/5"><label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Feedback</label><div className="text-white text-sm capitalize">{task.feedback_level.replace(/_/g, ' ')}</div></div>
          <div className="bg-black/30 p-3 rounded-lg border border-white/5"><label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Submissions</label><div className="text-white text-sm">{task._count.submissions}</div></div>
        </div>
      )}
    </Card>
  );
}

interface StatementsSectionProps {
  statements: Array<{ id: number; language: string; digest: string }>;
  expanded: boolean;
  onToggle: () => void;
  onUpload: () => void;
}

export function StatementsSection({ statements, expanded, onToggle, onUpload }: StatementsSectionProps): React.JSX.Element {
  return (
    <Card className="glass-card border-white/5 overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors">
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-emerald-400" />
          <span className="font-bold text-white">Statements</span>
          <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full text-neutral-400">{statements.length}</span>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-neutral-400" /> : <ChevronDown className="w-4 h-4 text-neutral-400" />}
      </button>
      {expanded && (
        <div className="p-4 pt-0">
          <button onClick={onUpload} className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600/20 text-emerald-400 rounded-lg text-sm hover:bg-emerald-600/30 transition-colors mb-4"><Upload className="w-4 h-4" />Upload Statement</button>
          {statements.length === 0 ? <p className="text-neutral-500 text-sm">No statements uploaded yet.</p> : (
            <div className="space-y-2">
              {statements.map((stmt) => (
                <div key={stmt.id} className="flex items-center justify-between p-3 bg-black/30 rounded-lg">
                  <div className="flex items-center gap-3"><FileText className="w-4 h-4 text-emerald-400" /><span className="text-sm text-white">Language: {stmt.language}</span></div>
                  <div className="flex items-center gap-2">
                    <a href={`/api/statements/${stmt.digest}`} target="_blank" rel="noreferrer" className="text-xs text-indigo-400 hover:underline">Download</a>
                    <button onClick={async () => { if (confirm('Delete this statement?')) { await apiClient.delete(`/api/statements/${stmt.id}`); window.location.reload(); } }} className="p-1 text-red-400 hover:bg-red-500/20 rounded" title="Delete statement"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

interface TaskHeaderProps {
  task: { id: number; title: string; name: string; contests: { id: number; name: string } | null };
  locale: string;
  onOpenSettings: () => void;
}

export function TaskHeader({ task, locale, onOpenSettings }: TaskHeaderProps): React.JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-3xl font-bold text-white">{task.title}</h1>
        <p className="text-neutral-400 mt-1 font-mono text-sm">{task.name}</p>
        {task.contests && <a href={`/${locale}/contests/${task.contests.id}`} className="text-indigo-400 text-sm hover:underline flex items-center gap-1 mt-2">Contest: {task.contests.name}<ExternalLink className="w-3 h-3" /></a>}
      </div>
      <button onClick={onOpenSettings} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"><Settings className="w-4 h-4" />Task Settings</button>
    </div>
  );
}
