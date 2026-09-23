'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { HelpCircle, ChevronDown, ChevronUp, Settings, FileText, Trash2, Upload, ExternalLink } from 'lucide-react';
import { Card } from '@/components/core/Card';
import { Button } from '@/components/core/Button';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/core/ResponsiveTable';
import { EmptyState } from '@/components/core/EmptyState';
import { apiClient } from '@/lib/apiClient';
import { cn } from '@/lib/utils';

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
      {expanded ? (
        <div className="p-4 pt-0 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-muted/30 p-3 rounded-lg border border-border"><label className="block text-xs font-bold text-muted-foreground uppercase mb-1">Score Precision</label><div className="text-foreground text-sm">{task.score_precision}</div></div>
          <div className="bg-muted/30 p-3 rounded-lg border border-border"><label className="block text-xs font-bold text-muted-foreground uppercase mb-1">Score Mode</label><div className="text-foreground text-sm capitalize">{task.score_mode.replace(/_/g, ' ')}</div></div>
          <div className="bg-muted/30 p-3 rounded-lg border border-border"><label className="block text-xs font-bold text-muted-foreground uppercase mb-1">Feedback</label><div className="text-foreground text-sm capitalize">{task.feedback_level.replace(/_/g, ' ')}</div></div>
          <div className="bg-muted/30 p-3 rounded-lg border border-border"><label className="block text-xs font-bold text-muted-foreground uppercase mb-1">Submissions</label><div className="text-foreground text-sm">{task._count.submissions}</div></div>
        </div>
      ) : null}
    </Card>
  );
}

interface StatementRow {
  id: number;
  language: string;
  digest: string;
  filename?: string;
  size?: number | null;
  uploadedAt?: string | null;
}

interface StatementsSectionProps {
  statements: StatementRow[];
  expanded: boolean;
  onToggle: () => void;
  onUpload: () => void;
}

function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

async function deleteStatement(id: number): Promise<void> {
  if (!confirm('Delete this statement?')) return;
  await apiClient.delete(`/api/statements/${id}`);
  window.location.reload();
}

// Why: one fragment drives desktop rows and mobile cards, with 44px
// targets kept here so both layouts stay touch-sized.
function renderStatementActions(stmt: StatementRow): React.JSX.Element {
  return (
    <>
      <a href={`/api/statements/${stmt.digest}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center px-2 text-xs text-primary hover:underline">Download</a>
      <Button variant="ghost" size="sm" icon={Trash2} iconOnly tooltip="Delete statement" onClick={() => void deleteStatement(stmt.id)} className="text-destructive" />
    </>
  );
}

// Why: one column definition drives desktop rows and mobile cards, so
// the two layouts cannot drift apart.
function buildStatementColumns(): ResponsiveColumn<StatementRow>[] {
  return [
    { key: 'language', header: 'Language', render: (stmt) => <span className="font-mono text-sm">{stmt.language}</span> },
    { key: 'filename', header: 'Filename', render: (stmt) => <span className="text-sm">{stmt.filename ?? `${stmt.language}.pdf`}</span> },
    { key: 'size', header: 'Size', render: (stmt) => <span className="text-sm">{formatSize(stmt.size)}</span> },
    { key: 'uploadedAt', header: 'Upload date', render: (stmt) => <span className="text-sm">{formatDate(stmt.uploadedAt)}</span> },
  ];
}

export function StatementsSection({ statements, expanded, onToggle, onUpload }: StatementsSectionProps): React.JSX.Element {
  const [activeLanguage, setActiveLanguage] = useState<string | null>(null);

  const languages = useMemo(() => Array.from(new Set(statements.map((s) => s.language))).sort(), [statements]);
  const filtered = useMemo(() => (activeLanguage ? statements.filter((s) => s.language === activeLanguage) : statements), [statements, activeLanguage]);
  const columns = useMemo(() => buildStatementColumns(), []);

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
      {expanded ? (
        <div className="p-4 pt-0 space-y-4">
          <Button variant="positiveOutline" size="sm" icon={Upload} onClick={onUpload}>Upload Statement</Button>
          {statements.length === 0 ? (
            <EmptyState title="No statements" description="No statements uploaded yet." />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setActiveLanguage(null)} className={cn('rounded-full px-3 py-1 text-xs font-medium border transition-colors', activeLanguage === null ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-border hover:bg-accent')}>All</button>
                {languages.map((lang) => (
                  <button key={lang} type="button" onClick={() => setActiveLanguage(lang)} className={cn('rounded-full px-3 py-1 text-xs font-mono border transition-colors', activeLanguage === lang ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-border hover:bg-accent')}>{lang}</button>
                ))}
              </div>
              <ResponsiveTable
                columns={columns}
                rows={filtered}
                getRowKey={(stmt) => stmt.id}
                renderRowActions={renderStatementActions}
                emptyState={<p className="text-center text-sm text-muted-foreground">No statements for &quot;{activeLanguage}&quot;.</p>}
              />
            </>
          )}
        </div>
      ) : null}
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
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-3xl font-bold text-foreground">{task.title}</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">{task.name}</p>
        {task.contests ? <a href={`/${locale}/contests/${task.contests.id}`} className="text-primary text-sm hover:underline flex items-center gap-1 mt-2">Contest: {task.contests.name}<ExternalLink className="w-3 h-3" /></a> : null}
      </div>
      <Button variant="positiveOutline" icon={Settings} onClick={onOpenSettings}>Task Settings</Button>
    </div>
  );
}
