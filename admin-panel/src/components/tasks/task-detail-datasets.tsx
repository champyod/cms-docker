'use client';

import Link from 'next/link';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { HelpCircle, Database, CheckCircle, Copy, Edit, ToggleLeft, ToggleRight, TestTube, Plus, Trash2, Upload, Paperclip, Settings2 } from 'lucide-react';
import { Card } from '@/components/core/Card';
import { Button } from '@/components/core/Button';
import { RowActions, type RowAction } from '@/components/core/RowActions';
import { SectionCard } from '@/components/core/SectionCard';
import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/apiClient';
import { useConfirm } from '@/hooks/useConfirm';
import { useTaskConfirmationCopy, useTaskTabRefresh } from './task-detail/useTaskTabRefresh';
import { buildRoute } from '@/lib/navigation/routes';
import type { Dictionary } from '@/lib/dictionary';

interface Dataset {
  id: number;
  description: string;
  task_type: string;
  time_limit: number | null;
  memory_limit: string | null;
  score_type: string;
  autojudge: boolean;
  task_type_parameters?: unknown;
  score_type_parameters?: unknown;
  testcases: Array<{ id: number; codename: string; public: boolean }>;
}

interface DatasetsSectionProps {
  datasets: Dataset[];
  activeDatasetId: number | null;
  expanded: boolean;
  onToggle: () => void;
  onCreate: () => void;
  onEdit: (ds: Dataset) => void;
  onActivate: (id: number) => void;
  onClone: (id: number, desc: string) => void;
  onRename: (id: number, desc: string) => void;
  onToggleAutojudge: (id: number) => void;
  onDelete: (id: number) => void;
  onOpenTestcaseUpload: (id: number) => void;
  onDeleteTestcase: (id: number) => void;
  onTogglePublic: (id: number) => void;
  locale: string;
  /** The affordance label for the docs link, not the documentation's own name. */
  docsLinkLabel: Dictionary['docs']['viewDocumentation'];
}

// Why one builder per dataset: the cluster is a permission-shaped list, and
// inline JSX made each affordance's visibility a separate reading task.
function buildDatasetActions(
  dataset: Dataset,
  isActive: boolean,
  handlers: DatasetHandlers,
): readonly RowAction[] {
  return [
    { key: 'settings', label: 'Dataset Settings', icon: Settings2, onClick: () => handlers.onEdit(dataset) },
    { key: 'live', label: 'Make Live', icon: CheckCircle, onClick: () => handlers.onActivate(dataset.id), isVisible: !isActive },
    { key: 'clone', label: 'Clone', icon: Copy, onClick: () => handlers.onClone(dataset.id, dataset.description) },
    { key: 'rename', label: 'Rename', icon: Edit, onClick: () => handlers.onRename(dataset.id, dataset.description) },
    { key: 'autojudge', label: 'Toggle Autojudge', icon: dataset.autojudge ? ToggleRight : ToggleLeft, onClick: () => handlers.onToggleAutojudge(dataset.id) },
    { key: 'delete', label: 'Delete', icon: Trash2, onClick: () => handlers.onDelete(dataset.id), isVisible: !isActive },
  ];
}

interface DatasetHandlers {
  onEdit: (ds: Dataset) => void;
  onActivate: (id: number) => void;
  onClone: (id: number, desc: string) => void;
  onRename: (id: number, desc: string) => void;
  onToggleAutojudge: (id: number) => void;
  onDelete: (id: number) => void;
}

export function DatasetsSection({
  datasets,
  activeDatasetId,
  expanded,
  onToggle,
  onCreate,
  onEdit,
  onActivate,
  onClone,
  onRename,
  onToggleAutojudge,
  onDelete,
  onOpenTestcaseUpload,
  onDeleteTestcase,
  onTogglePublic,
  locale,
  docsLinkLabel,
}: DatasetsSectionProps): React.JSX.Element {
  const handlers: DatasetHandlers = { onEdit, onActivate, onClone, onRename, onToggleAutojudge, onDelete };
  return (
    <SectionCard
      className="border-border"
      title="Datasets"
      icon={<Database className="w-5 h-5 text-warning" />}
      count={datasets.length}
      expanded={expanded}
      onToggle={onToggle}
      actions={
        <Link href={`${buildRoute(locale, 'system.docs')}#datasets`} className="p-1 hover:bg-accent rounded-full transition-colors text-muted-foreground hover:text-foreground" title={docsLinkLabel}>
          <HelpCircle className="w-4 h-4" />
        </Link>
      }
    >
      <div className="p-4 pt-0">
        <div className="mb-4">
          <button onClick={onCreate} className="flex items-center gap-2 px-3 py-1.5 bg-warning/10 text-warning rounded-lg text-sm hover:bg-warning/20 transition-colors">
            <Plus className="w-4 h-4" />
            {datasets.length === 0 ? 'Create Dataset' : 'New Dataset'}
          </button>
          {datasets.length === 0 && <p className="text-muted-foreground text-sm mt-2">No datasets created yet. Create one to add testcases.</p>}
        </div>
        <div className="space-y-4">
          {datasets.map((dataset) => (
            <div key={dataset.id} className="p-4 bg-muted/30 rounded-lg space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Database className="w-4 h-4 text-warning" />
                  <span className="font-medium text-foreground">{dataset.description}</span>
                  {dataset.id === activeDatasetId && <span className="px-2 py-0.5 text-xs bg-success/10 text-success rounded-full">Active</span>}
                  {dataset.autojudge && <span className="px-2 py-0.5 text-xs bg-info/10 text-info rounded-full">Autojudge</span>}
                </div>
                <RowActions
                  ariaLabel="Datasets"
                  actions={buildDatasetActions(dataset, dataset.id === activeDatasetId, handlers)}
                />
              </div>
                <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                  <div><span className="text-muted-foreground text-xs uppercase">Type</span><div className="text-foreground text-xs">{dataset.task_type}</div></div>
                  <div><span className="text-muted-foreground text-xs uppercase">Time</span><div className="text-foreground text-xs">{dataset.time_limit ? `${dataset.time_limit}s` : '-'}</div></div>
                  <div><span className="text-muted-foreground text-xs uppercase">Memory</span><div className="text-foreground text-xs">{dataset.memory_limit ? `${Number(dataset.memory_limit) / (1024 * 1024)} MiB` : '-'}</div></div>
                  <div><span className="text-muted-foreground text-xs uppercase">Score</span><div className="text-foreground text-xs">{dataset.score_type}</div></div>
                </div>
                <div className="mt-3 pt-3 border-t border-border">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2"><TestTube className="w-4 h-4 text-info" /><span className="text-xs font-bold text-muted-foreground uppercase">Testcases ({dataset.testcases.length})</span></div>
                    <Button variant="link" size="sm" icon={Plus} onClick={() => onOpenTestcaseUpload(dataset.id)} className="text-info">
                      Add Testcases (Bulk)
                    </Button>
                  </div>
                  {dataset.testcases.length === 0 ? <p className="text-muted-foreground text-xs">No testcases yet.</p> : (
                    <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-6">
                      {dataset.testcases.slice(0, 12).map((tc) => (
                        <div key={tc.id} className="px-2 py-1 bg-muted/40 rounded text-xs text-muted-foreground flex items-center justify-between group">
                          <span className="truncate">{tc.codename}</span>
                          <div className="flex shrink-0 items-center gap-1">
                            <button onClick={() => onTogglePublic(tc.id)} title={tc.public ? 'Public' : 'Private'} aria-label={tc.public ? 'Make testcase private' : 'Make testcase public'} className={cn('flex size-11 items-center justify-center rounded-md text-xs font-bold transition-colors', tc.public ? 'text-success' : 'text-muted-foreground')}>{tc.public ? 'P' : 'H'}</button>
                            <button onClick={() => onDeleteTestcase(tc.id)} title="Delete testcase" aria-label="Delete testcase" className="flex size-11 items-center justify-center rounded-md text-destructive transition-colors hover:bg-destructive/10">×</button>
                          </div>
                        </div>
                      ))}
                      {dataset.testcases.length > 12 && <div className="px-2 py-1 bg-muted/40 rounded text-xs text-muted-foreground">+{dataset.testcases.length - 12} more</div>}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
    </SectionCard>
  );
}

export function AttachmentsSection({ attachments, onUpload, onDeleteAttachment }: { attachments: Array<{ id: number; filename: string }>; onUpload: () => void; onDeleteAttachment?: (attachmentId: number) => Promise<void> }): React.JSX.Element {
  const refresh = useTaskTabRefresh();
  const confirm = useConfirm();
  const { destructiveConfirm } = useTaskConfirmationCopy();
  const runAction = useActionFeedback();

  const handleDeleteAttachment = async (attachmentId: number): Promise<void> => {
    if (!(await confirm(destructiveConfirm('attachment')))) return;
    const result = await runAction(
      { pending: 'Deleting attachment...', success: 'Attachment deleted', failure: 'Delete failed' },
      () => apiClient.delete(`/api/attachments/${attachmentId}`)
    );
    if (result?.success) refresh();
  };

  // Why: the files tab owns attachment deletion — the section keeps its own
  // active-path handler only so a bare render still deletes safely.
  const deleteAttachment = onDeleteAttachment ?? handleDeleteAttachment;

  return (
    <Card className="border-border p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3"><Paperclip className="w-5 h-5 text-info" /><span className="font-bold text-foreground">Attachments</span><span className="text-xs bg-accent px-2 py-0.5 rounded-full text-muted-foreground">{attachments.length}</span></div>
        <button onClick={onUpload} className="flex items-center gap-2 px-3 py-1.5 bg-info/10 text-info rounded-lg text-sm hover:bg-info/20 transition-colors"><Upload className="w-4 h-4" />Upload</button>
      </div>
      {attachments.length === 0 ? <p className="text-muted-foreground text-sm">No attachments.</p> : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {attachments.map((att) => (
            <div key={att.id} className="flex items-center gap-2 p-2 bg-muted/30 rounded-lg text-sm text-muted-foreground group">
              <Paperclip className="w-3 h-3 text-info" /><span className="truncate flex-1">{att.filename}</span>
              <Button variant="ghost" size="sm" icon={Trash2} iconOnly tooltip="Delete attachment" onClick={() => { void deleteAttachment(att.id); }} className="text-destructive" />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
