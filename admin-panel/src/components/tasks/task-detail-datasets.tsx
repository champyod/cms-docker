'use client';

import Link from 'next/link';
import { HelpCircle, ChevronDown, ChevronUp, Settings, Database, CheckCircle, Copy, Edit, ToggleLeft, ToggleRight, TestTube, Plus, Trash2, Upload, Paperclip } from 'lucide-react';
import { Card } from '@/components/core/Card';
import { Button } from '@/components/core/Button';
import { apiClient } from '@/lib/apiClient';

interface Dataset {
  id: number;
  description: string;
  task_type: string;
  time_limit: number | null;
  memory_limit: string | null;
  score_type: string;
  autojudge: boolean;
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
}: DatasetsSectionProps): React.JSX.Element {
  return (
    <Card className="border-border overflow-hidden">
      <div className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-3">
          <Database className="w-5 h-5 text-warning" />
          <span className="font-bold text-foreground">Datasets</span>
          <span className="text-xs bg-accent px-2 py-0.5 rounded-full text-muted-foreground">{datasets.length}</span>
        </div>
        <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
          <Link href={`/${locale}/docs#datasets`} className="p-1 hover:bg-accent rounded-full transition-colors text-muted-foreground hover:text-foreground" title="View Documentation">
            <HelpCircle className="w-4 h-4" />
          </Link>
          <button onClick={onToggle} className="p-1">{expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}</button>
        </div>
      </div>
      {expanded && (
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
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Database className="w-4 h-4 text-warning" />
                    <span className="font-medium text-foreground">{dataset.description}</span>
                    {dataset.id === activeDatasetId && <span className="px-2 py-0.5 text-xs bg-success/10 text-success rounded-full">Active</span>}
                    {dataset.autojudge && <span className="px-2 py-0.5 text-xs bg-info/10 text-info rounded-full">Autojudge</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" icon={Settings} iconOnly tooltip="Settings" onClick={() => onEdit(dataset)} />
                    {dataset.id !== activeDatasetId && <Button variant="ghost" size="sm" icon={CheckCircle} iconOnly tooltip="Make Live" onClick={() => onActivate(dataset.id)} className="text-success hover:text-success" />}
                    <Button variant="ghost" size="sm" icon={Copy} iconOnly tooltip="Clone" onClick={() => onClone(dataset.id, dataset.description)} className="text-primary hover:text-primary" />
                    <Button variant="ghost" size="sm" icon={Edit} iconOnly tooltip="Rename" onClick={() => onRename(dataset.id, dataset.description)} />
                    <Button variant="ghost" size="sm" icon={dataset.autojudge ? ToggleRight : ToggleLeft} iconOnly tooltip="Toggle Autojudge" onClick={() => onToggleAutojudge(dataset.id)} className="text-info hover:text-info" />
                    {dataset.id !== activeDatasetId && <Button variant="ghost" size="sm" icon={Trash2} iconOnly tooltip="Delete" onClick={() => onDelete(dataset.id)} className="text-destructive hover:text-destructive" />}
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-4 text-sm">
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
                    <div className="grid grid-cols-6 gap-1">
                      {dataset.testcases.slice(0, 12).map((tc) => (
                        <div key={tc.id} className="px-2 py-1 bg-muted/40 rounded text-xs text-muted-foreground flex items-center justify-between group">
                          <span className="truncate">{tc.codename}</span>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => onTogglePublic(tc.id)} className={tc.public ? 'text-success' : 'text-muted-foreground'} title={tc.public ? 'Public' : 'Private'}>{tc.public ? 'P' : 'H'}</button>
                            <button onClick={() => onDeleteTestcase(tc.id)} className="text-destructive">×</button>
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
      )}
    </Card>
  );
}

export function AttachmentsSection({ attachments, onUpload }: { attachments: Array<{ id: number; filename: string }>; onUpload: () => void }): React.JSX.Element {
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
              <Button variant="ghost" size="sm" icon={Trash2} iconOnly tooltip="Delete attachment" onClick={async () => { if (confirm('Delete this attachment?')) { await apiClient.delete(`/api/attachments/${att.id}`); window.location.reload(); } }} className="text-destructive opacity-0 group-hover:opacity-100" />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
