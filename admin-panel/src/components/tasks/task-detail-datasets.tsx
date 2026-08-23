'use client';

import Link from 'next/link';
import { HelpCircle, ChevronDown, ChevronUp, Settings, Database, CheckCircle, Copy, Edit, ToggleLeft, ToggleRight, TestTube, Plus, Trash2, Upload, Paperclip } from 'lucide-react';
import { Card } from '@/components/core/Card';
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
    <Card className="glass-card border-white/5 overflow-hidden">
      <div className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-3">
          <Database className="w-5 h-5 text-amber-400" />
          <span className="font-bold text-white">Datasets</span>
          <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full text-neutral-400">{datasets.length}</span>
        </div>
        <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
          <Link href={`/${locale}/docs#datasets`} className="p-1 hover:bg-white/10 rounded-full transition-colors text-neutral-400 hover:text-white" title="View Documentation">
            <HelpCircle className="w-4 h-4" />
          </Link>
          <button onClick={onToggle} className="p-1">{expanded ? <ChevronUp className="w-4 h-4 text-neutral-400" /> : <ChevronDown className="w-4 h-4 text-neutral-400" />}</button>
        </div>
      </div>
      {expanded && (
        <div className="p-4 pt-0">
          <div className="mb-4">
            <button onClick={onCreate} className="flex items-center gap-2 px-3 py-1.5 bg-amber-600/20 text-amber-400 rounded-lg text-sm hover:bg-amber-600/30 transition-colors">
              <Plus className="w-4 h-4" />
              {datasets.length === 0 ? 'Create Dataset' : 'New Dataset'}
            </button>
            {datasets.length === 0 && <p className="text-neutral-500 text-sm mt-2">No datasets created yet. Create one to add testcases.</p>}
          </div>
          <div className="space-y-4">
            {datasets.map((dataset) => (
              <div key={dataset.id} className="p-4 bg-black/30 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Database className="w-4 h-4 text-amber-400" />
                    <span className="font-medium text-white">{dataset.description}</span>
                    {dataset.id === activeDatasetId && <span className="px-2 py-0.5 text-xs bg-emerald-500/20 text-emerald-400 rounded-full">Active</span>}
                    {dataset.autojudge && <span className="px-2 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded-full">Autojudge</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => onEdit(dataset)} className="p-1.5 text-neutral-400 hover:bg-white/10 rounded" title="Settings"><Settings className="w-3 h-3" /></button>
                    {dataset.id !== activeDatasetId && <button onClick={() => onActivate(dataset.id)} className="p-1.5 text-emerald-400 hover:bg-emerald-500/20 rounded text-xs flex items-center gap-1" title="Make Live"><CheckCircle className="w-3 h-3" /></button>}
                    <button onClick={() => onClone(dataset.id, dataset.description)} className="p-1.5 text-indigo-400 hover:bg-indigo-500/20 rounded" title="Clone"><Copy className="w-3 h-3" /></button>
                    <button onClick={() => onRename(dataset.id, dataset.description)} className="p-1.5 text-neutral-400 hover:bg-white/10 rounded" title="Rename"><Edit className="w-3 h-3" /></button>
                    <button onClick={() => onToggleAutojudge(dataset.id)} className="p-1.5 text-blue-400 hover:bg-blue-500/20 rounded" title="Toggle Autojudge">{dataset.autojudge ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}</button>
                    {dataset.id !== activeDatasetId && <button onClick={() => onDelete(dataset.id)} className="p-1.5 text-red-400 hover:bg-red-500/20 rounded" title="Delete"><Trash2 className="w-3 h-3" /></button>}
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-4 text-sm">
                  <div><span className="text-neutral-500 text-xs uppercase">Type</span><div className="text-white text-xs">{dataset.task_type}</div></div>
                  <div><span className="text-neutral-500 text-xs uppercase">Time</span><div className="text-white text-xs">{dataset.time_limit ? `${dataset.time_limit}s` : '-'}</div></div>
                  <div><span className="text-neutral-500 text-xs uppercase">Memory</span><div className="text-white text-xs">{dataset.memory_limit ? `${Number(dataset.memory_limit) / (1024 * 1024)} MiB` : '-'}</div></div>
                  <div><span className="text-neutral-500 text-xs uppercase">Score</span><div className="text-white text-xs">{dataset.score_type}</div></div>
                </div>
                <div className="mt-3 pt-3 border-t border-white/5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2"><TestTube className="w-4 h-4 text-cyan-400" /><span className="text-xs font-bold text-neutral-400 uppercase">Testcases ({dataset.testcases.length})</span></div>
                    <button onClick={() => onOpenTestcaseUpload(dataset.id)} className="text-xs text-cyan-400 hover:underline flex items-center gap-1"><Plus className="w-3 h-3" /> Add Testcases (Bulk)</button>
                  </div>
                  {dataset.testcases.length === 0 ? <p className="text-neutral-500 text-xs">No testcases yet.</p> : (
                    <div className="grid grid-cols-6 gap-1">
                      {dataset.testcases.slice(0, 12).map((tc) => (
                        <div key={tc.id} className="px-2 py-1 bg-black/40 rounded text-xs text-neutral-300 flex items-center justify-between group">
                          <span className="truncate">{tc.codename}</span>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => onTogglePublic(tc.id)} className={tc.public ? 'text-emerald-400' : 'text-neutral-500'} title={tc.public ? 'Public' : 'Private'}>{tc.public ? 'P' : 'H'}</button>
                            <button onClick={() => onDeleteTestcase(tc.id)} className="text-red-400">×</button>
                          </div>
                        </div>
                      ))}
                      {dataset.testcases.length > 12 && <div className="px-2 py-1 bg-black/40 rounded text-xs text-neutral-500">+{dataset.testcases.length - 12} more</div>}
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
    <Card className="glass-card border-white/5 p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3"><Paperclip className="w-5 h-5 text-purple-400" /><span className="font-bold text-white">Attachments</span><span className="text-xs bg-white/10 px-2 py-0.5 rounded-full text-neutral-400">{attachments.length}</span></div>
        <button onClick={onUpload} className="flex items-center gap-2 px-3 py-1.5 bg-purple-600/20 text-purple-400 rounded-lg text-sm hover:bg-purple-600/30 transition-colors"><Upload className="w-4 h-4" />Upload</button>
      </div>
      {attachments.length === 0 ? <p className="text-neutral-500 text-sm">No attachments.</p> : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {attachments.map((att) => (
            <div key={att.id} className="flex items-center gap-2 p-2 bg-black/30 rounded-lg text-sm text-neutral-300 group">
              <Paperclip className="w-3 h-3 text-purple-400" /><span className="truncate flex-1">{att.filename}</span>
              <button onClick={async () => { if (confirm('Delete this attachment?')) { await apiClient.delete(`/api/attachments/${att.id}`); window.location.reload(); } }} className="p-1 text-red-400 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 rounded transition-all" title="Delete attachment"><Trash2 className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
