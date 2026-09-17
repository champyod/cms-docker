'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { HelpCircle, ChevronDown, ChevronUp, Settings, FileText, Trash2, Upload, ExternalLink } from 'lucide-react';
import { Card } from '@/components/core/Card';
import { Button } from '@/components/core/Button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';
import { EmptyState } from '@/components/core/EmptyState';
import { apiClient } from '@/lib/apiClient';
import { useConfirm } from '@/hooks/useConfirm';
import { useConfirmationCopy } from '@/hooks/useConfirmationCopy';
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

export function StatementsSection({ statements, expanded, onToggle, onUpload }: StatementsSectionProps): React.JSX.Element {
  const router = useRouter();
  const confirm = useConfirm();
  const { destructiveConfirm } = useConfirmationCopy();
  const [activeLanguage, setActiveLanguage] = useState<string | null>(null);

  const handleDeleteStatement = async (statementId: number): Promise<void> => {
    if (!(await confirm(destructiveConfirm('statement')))) return;
    await apiClient.delete(`/api/statements/${statementId}`);
    router.refresh();
  };

  const languages = useMemo(() => Array.from(new Set(statements.map((s) => s.language))).sort(), [statements]);
  const filtered = useMemo(() => (activeLanguage ? statements.filter((s) => s.language === activeLanguage) : statements), [statements, activeLanguage]);

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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Language</TableHead>
                    <TableHead>Filename</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Upload date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">No statements for &quot;{activeLanguage}&quot;.</TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((stmt) => (
                      <TableRow key={stmt.id}>
                        <TableCell className="font-mono text-sm">{stmt.language}</TableCell>
                        <TableCell className="text-sm">{stmt.filename ?? `${stmt.language}.pdf`}</TableCell>
                        <TableCell className="text-sm">{formatSize(stmt.size)}</TableCell>
                        <TableCell className="text-sm">{formatDate(stmt.uploadedAt)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <a href={`/api/statements/${stmt.digest}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">Download</a>
                            <Button variant="ghost" size="sm" icon={Trash2} iconOnly tooltip="Delete statement" onClick={() => { void handleDeleteStatement(stmt.id); }} className="text-destructive" />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
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
