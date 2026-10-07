'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { HelpCircle, Settings, FileText, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { SectionCard } from '@/components/core/SectionCard';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/core/ResponsiveTable';
import { EmptyState } from '@/components/core/EmptyState';
import { apiClient } from '@/lib/apiClient';
import { useConfirm } from '@/hooks/useConfirm';
import { useTaskConfirmationCopy, useTaskTabRefresh } from './task-detail/useTaskTabRefresh';
import { buildRoute } from '@/lib/navigation/routes';
import type { Dictionary } from '@/lib/dictionary';
import { cn } from '@/lib/utils';

interface TaskDetailConfigProps {
  task: { score_precision: number; score_mode: string; feedback_level: string; _count: { submissions: number } };
  expanded: boolean;
  onToggle: () => void;
  locale: string;
  /** The affordance label for the docs link, not the documentation's own name. */
  docsLinkLabel: Dictionary['docs']['viewDocumentation'];
}

function DocsLink({ href, label }: { href: string; label: string }): React.JSX.Element {
  return (
    <Link href={href} className="p-1 hover:bg-accent rounded-full transition-colors text-muted-foreground hover:text-foreground" title={label}>
      <HelpCircle className="w-4 h-4" />
    </Link>
  );
}

export function ConfigSection({ task, expanded, onToggle, locale, docsLinkLabel }: TaskDetailConfigProps): React.JSX.Element {
  return (
    <SectionCard
      className="border-border"
      title="Configuration"
      icon={<Settings className="w-5 h-5 text-primary" />}
      expanded={expanded}
      onToggle={onToggle}
      actions={<DocsLink href={`${buildRoute(locale, 'system.docs')}#task-types`} label={docsLinkLabel} />}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-muted/30 p-3 rounded-lg border border-border"><label className="block text-xs font-bold text-muted-foreground uppercase mb-1">Score Precision</label><div className="text-foreground text-sm">{task.score_precision}</div></div>
        <div className="bg-muted/30 p-3 rounded-lg border border-border"><label className="block text-xs font-bold text-muted-foreground uppercase mb-1">Score Mode</label><div className="text-foreground text-sm capitalize">{task.score_mode.replace(/_/g, ' ')}</div></div>
        <div className="bg-muted/30 p-3 rounded-lg border border-border"><label className="block text-xs font-bold text-muted-foreground uppercase mb-1">Feedback</label><div className="text-foreground text-sm capitalize">{task.feedback_level.replace(/_/g, ' ')}</div></div>
        <div className="bg-muted/30 p-3 rounded-lg border border-border"><label className="block text-xs font-bold text-muted-foreground uppercase mb-1">Submissions</label><div className="text-foreground text-sm">{task._count.submissions}</div></div>
      </div>
    </SectionCard>
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
  onDeleteStatement?: (statementId: number) => Promise<void>;
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

// Why: one fragment drives desktop rows and mobile cards, with 44px
// targets kept here so both layouts stay touch-sized.
function renderStatementActions(stmt: StatementRow, onDelete: (statementId: number) => void): React.JSX.Element {
  return (
    <>
      <a href={`/api/statements/${stmt.digest}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center px-2 text-xs text-primary hover:underline">Download</a>
      <Button variant="ghost" size="sm" icon={Trash2} iconOnly tooltip="Delete statement" onClick={() => onDelete(stmt.id)} className="text-destructive" />
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

export function StatementsSection({ statements, expanded, onToggle, onUpload, onDeleteStatement }: StatementsSectionProps): React.JSX.Element {
  const refresh = useTaskTabRefresh();
  const confirm = useConfirm();
  const { destructiveConfirm } = useTaskConfirmationCopy();
  const [activeLanguage, setActiveLanguage] = useState<string | null>(null);

  const runAction = useActionFeedback();

  const handleDeleteStatement = useCallback(async (statementId: number): Promise<void> => {
    if (!(await confirm(destructiveConfirm('statement')))) return;
    const result = await runAction(
      { pending: 'Deleting statement...', success: 'Statement deleted', failure: 'Delete failed' },
      () => apiClient.delete(`/api/statements/${statementId}`)
    );
    if (result?.success) refresh();
  }, [confirm, destructiveConfirm, runAction, refresh]);

  // Why: the overview tab owns statement deletion — the section keeps its
  // own active-path handler only so a bare render still deletes safely.
  const deleteStatement = onDeleteStatement ?? handleDeleteStatement;

  const languages = useMemo(() => Array.from(new Set(statements.map((s) => s.language))).sort(), [statements]);
  const filtered = useMemo(() => (activeLanguage ? statements.filter((s) => s.language === activeLanguage) : statements), [statements, activeLanguage]);
  const columns = useMemo(() => buildStatementColumns(), []);
  const renderActions = useCallback(
    (stmt: StatementRow): React.JSX.Element =>
      renderStatementActions(stmt, (statementId: number): void => { void deleteStatement(statementId); }),
    [deleteStatement],
  );

  return (
    <SectionCard
      className="border-border"
      title="Statements"
      icon={<FileText className="w-5 h-5 text-success" />}
      count={statements.length}
      expanded={expanded}
      onToggle={onToggle}
    >
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
              renderRowActions={renderActions}
              emptyState={<p className="text-center text-sm text-muted-foreground">No statements for &quot;{activeLanguage}&quot;.</p>}
            />
          </>
        )}
      </div>
    </SectionCard>
  );
}

