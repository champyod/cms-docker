'use client';

import Link from 'next/link';
import { HelpCircle, ChevronDown, ChevronUp, Settings, FileText, Trash2, Upload, ExternalLink } from 'lucide-react';
import { Card } from '@/components/core/Card';
import { Button } from '@/components/core/Button';
import { apiClient } from '@/lib/apiClient';

interface TaskDetailConfigProps {
  task: { score_precision: number; score_mode: string; feedback_level: string; _count: { submissions: number } };
  expanded: boolean;
  onToggle: () => void;
  locale: string;
}

export function ConfigSection({ task, expanded, onToggle, locale }: TaskDetailConfigProps): React.JSX.Element {
  return (
    <Card className="border-border overflow-hidden">
      <div className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-3">
          <Settings className="w-5 h-5 text-primary" />
          <span className="font-bold text-foreground">Configuration</span>
        </div>
        <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
          <Link href={`/${locale}/docs#task-types`} className="p-1 hover:bg-accent rounded-full transition-colors text-muted-foreground hover:text-foreground" title="View Documentation">
            <HelpCircle className="w-4 h-4" />
          </Link>
          <button onClick={onToggle} className="p-1">{expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}</button>
        </div>
      </div>
      {expanded && (
        <div className="p-4 pt-0 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-muted/30 p-3 rounded-lg border border-border"><label className="block text-xs font-bold text-muted-foreground uppercase mb-1">Score Precision</label><div className="text-foreground text-sm">{task.score_precision}</div></div>
          <div className="bg-muted/30 p-3 rounded-lg border border-border"><label className="block text-xs font-bold text-muted-foreground uppercase mb-1">Score Mode</label><div className="text-foreground text-sm capitalize">{task.score_mode.replace(/_/g, ' ')}</div></div>
          <div className="bg-muted/30 p-3 rounded-lg border border-border"><label className="block text-xs font-bold text-muted-foreground uppercase mb-1">Feedback</label><div className="text-foreground text-sm capitalize">{task.feedback_level.replace(/_/g, ' ')}</div></div>
          <div className="bg-muted/30 p-3 rounded-lg border border-border"><label className="block text-xs font-bold text-muted-foreground uppercase mb-1">Submissions</label><div className="text-foreground text-sm">{task._count.submissions}</div></div>
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
    <Card className="border-border overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors">
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-success" />
          <span className="font-bold text-foreground">Statements</span>
          <span className="text-xs bg-accent px-2 py-0.5 rounded-full text-muted-foreground">{statements.length}</span>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {expanded && (
        <div className="p-4 pt-0">
          <Button variant="positiveOutline" size="sm" icon={Upload} onClick={onUpload} className="mb-4">Upload Statement</Button>
          {statements.length === 0 ? <p className="text-muted-foreground text-sm">No statements uploaded yet.</p> : (
            <div className="space-y-2">
              {statements.map((stmt) => (
                <div key={stmt.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-3"><FileText className="w-4 h-4 text-success" /><span className="text-sm text-foreground">Language: {stmt.language}</span></div>
                  <div className="flex items-center gap-2">
                    <a href={`/api/statements/${stmt.digest}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">Download</a>
                    <Button variant="ghost" size="sm" icon={Trash2} iconOnly tooltip="Delete statement" onClick={async () => { if (confirm('Delete this statement?')) { await apiClient.delete(`/api/statements/${stmt.id}`); window.location.reload(); } }} className="text-destructive" />
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
        <h1 className="text-3xl font-bold text-foreground">{task.title}</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">{task.name}</p>
        {task.contests && <a href={`/${locale}/contests/${task.contests.id}`} className="text-primary text-sm hover:underline flex items-center gap-1 mt-2">Contest: {task.contests.name}<ExternalLink className="w-3 h-3" /></a>}
      </div>
      <Button variant="positiveOutline" icon={Settings} onClick={onOpenSettings}>Task Settings</Button>
    </div>
  );
}
