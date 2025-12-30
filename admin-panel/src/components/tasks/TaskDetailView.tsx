'use client';

import { useState } from 'react';
import { tasks, statements, attachments, datasets, testcases, managers, contests } from '@prisma/client';
import { Card } from '@/components/core/Card';
import Link from 'next/link';
import { 
  Settings, FileText, Paperclip, Database, TestTube, 
  ChevronDown, ChevronUp, Save, Plus, Trash2, ExternalLink, Upload,
  Copy, Edit, CheckCircle, ToggleLeft, ToggleRight, Download, HelpCircle
} from 'lucide-react';
import { activateDataset, cloneDataset, deleteDataset, renameDataset, toggleAutojudge } from '@/app/actions/datasets';
import { deleteTestcase, toggleTestcasePublic } from '@/app/actions/testcases';
import { deleteStatement, deleteAttachment } from '@/app/actions/statements';
import { DatasetModal } from './DatasetModal';
import { StatementModal } from './StatementModal';
import { AttachmentModal } from './AttachmentModal';
import { TaskModal } from './TaskModal';
import { TestcaseUploadModal } from './TestcaseUploadModal';

type DatasetWithRelations = datasets & {
  testcases: testcases[];
  managers: managers[];
};

type TaskWithRelations = tasks & {
  contests: contests | null;
  statements: statements[];
  attachments: attachments[];
  datasets: DatasetWithRelations[];
  _count: { submissions: number };
};

interface TaskDetailViewProps {
  task: TaskWithRelations;
}

export function TaskDetailView({ task }: TaskDetailViewProps) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    info: true,
    statements: true,
    datasets: true,
  });

  const [isTaskSettingsOpen, setIsTaskSettingsOpen] = useState(false);
  const [isDatasetModalOpen, setIsDatasetModalOpen] = useState(false);
  const [isStatementModalOpen, setIsStatementModalOpen] = useState(false);
  const [isAttachmentModalOpen, setIsAttachmentModalOpen] = useState(false);

  // Testcase upload state
  const [currentDatasetId, setCurrentDatasetId] = useState<number | null>(null);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const handleActivateDataset = async (datasetId: number) => {
    await activateDataset(datasetId);
    window.location.reload();
  };

  const handleCloneDataset = async (datasetId: number, description: string) => {
    const newName = prompt('Enter name for cloned dataset:', `${description} (copy)`);
    if (newName) {
      await cloneDataset(datasetId, newName);
      window.location.reload();
    }
  };

  const handleRenameDataset = async (datasetId: number, currentDesc: string) => {
    const newName = prompt('Enter new name:', currentDesc);
    if (newName && newName !== currentDesc) {
      await renameDataset(datasetId, newName);
      window.location.reload();
    }
  };

  const handleDeleteDataset = async (datasetId: number) => {
    if (confirm('Delete this dataset? This cannot be undone.')) {
      const result = await deleteDataset(datasetId);
      if (!result.success) {
        alert(result.error);
      } else {
        window.location.reload();
      }
    }
  };

  const handleToggleAutojudge = async (datasetId: number) => {
    await toggleAutojudge(datasetId);
    window.location.reload();
  };

  const handleDeleteTestcase = async (tcId: number) => {
    if (confirm('Delete this testcase?')) {
      await deleteTestcase(tcId);
      window.location.reload();
    }
  };

  const handleToggleTestcasePublic = async (tcId: number) => {
    await toggleTestcasePublic(tcId);
    window.location.reload();
  };

  const openTestcaseUpload = (datasetId: number) => {
    setCurrentDatasetId(datasetId);
  };

  const taskDatasets = task.datasets;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">{task.title}</h1>
          <p className="text-neutral-400 mt-1 font-mono text-sm">{task.name}</p>
          {task.contests && (
            <a 
              href={`/en/contests/${task.contests.id}`}
              className="text-indigo-400 text-sm hover:underline flex items-center gap-1 mt-2"
            >
              Contest: {task.contests.name}
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
        <button
          onClick={() => setIsTaskSettingsOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
        >
          <Settings className="w-4 h-4" />
          Task Settings
        </button>
      </div>

      {/* Task Settings Summary (Read-Only) */}
      <Card className="glass-card border-white/5 overflow-hidden">
        <div
          className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors cursor-pointer"
          onClick={() => toggleSection('info')}
        >
          <div className="flex items-center gap-3">
            <Settings className="w-5 h-5 text-indigo-400" />
            <span className="font-bold text-white">Configuration</span>
          </div>
          <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
            <Link href="/en/docs#task-types" className="p-1 hover:bg-white/10 rounded-full transition-colors text-neutral-400 hover:text-white" title="View Documentation">
              <HelpCircle className="w-4 h-4" />
            </Link>
            <button onClick={() => toggleSection('info')} className="p-1">
              {expandedSections.info ? <ChevronUp className="w-4 h-4 text-neutral-400" /> : <ChevronDown className="w-4 h-4 text-neutral-400" />}
            </button>
          </div>
        </div>
        
        {expandedSections.info && (
          <div className="p-4 pt-0 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-black/30 p-3 rounded-lg border border-white/5">
              <label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Score Precision</label>
              <div className="text-white text-sm">{task.score_precision}</div>
            </div>
            <div className="bg-black/30 p-3 rounded-lg border border-white/5">
              <label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Score Mode</label>
              <div className="text-white text-sm capitalize">{task.score_mode.replace(/_/g, ' ')}</div>
            </div>
            <div className="bg-black/30 p-3 rounded-lg border border-white/5">
              <label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Feedback</label>
              <div className="text-white text-sm capitalize">{task.feedback_level.replace(/_/g, ' ')}</div>
            </div>
            <div className="bg-black/30 p-3 rounded-lg border border-white/5">
              <label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Submissions</label>
              <div className="text-white text-sm">{task._count.submissions}</div>
            </div>
          </div>
        )}
      </Card>

      {/* Statements */}
      <Card className="glass-card border-white/5 overflow-hidden">
        <button
          onClick={() => toggleSection('statements')}
          className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-emerald-400" />
            <span className="font-bold text-white">Statements</span>
            <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full text-neutral-400">
              {task.statements.length}
            </span>
          </div>
          {expandedSections.statements ? <ChevronUp className="w-4 h-4 text-neutral-400" /> : <ChevronDown className="w-4 h-4 text-neutral-400" />}
        </button>
        
        {expandedSections.statements && (
          <div className="p-4 pt-0">
            <button
              onClick={() => setIsStatementModalOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600/20 text-emerald-400 rounded-lg text-sm hover:bg-emerald-600/30 transition-colors mb-4"
            >
              <Upload className="w-4 h-4" />
              Upload Statement
            </button>
            
            {task.statements.length === 0 ? (
              <p className="text-neutral-500 text-sm">No statements uploaded yet.</p>
            ) : (
              <div className="space-y-2">
                  {task.statements.map((stmt) => (
                  <div key={stmt.id} className="flex items-center justify-between p-3 bg-black/30 rounded-lg">
                    <div className="flex items-center gap-3">
                      <FileText className="w-4 h-4 text-emerald-400" />
                      <span className="text-sm text-white">Language: {stmt.language}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <a href={`/api/statements/${stmt.digest}`} target="_blank" className="text-xs text-indigo-400 hover:underline">Download</a>
                        <button
                          onClick={async () => {
                            if (confirm('Delete this statement?')) {
                              await deleteStatement(stmt.id);
                              window.location.reload();
                            }
                          }}
                          className="p-1 text-red-400 hover:bg-red-500/20 rounded"
                        >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Datasets */}
      <Card className="glass-card border-white/5 overflow-hidden">
        <div
          className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors cursor-pointer"
          onClick={() => toggleSection('datasets')}
        >
          <div className="flex items-center gap-3">
            <Database className="w-5 h-5 text-amber-400" />
            <span className="font-bold text-white">Datasets</span>
            <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full text-neutral-400">
              {taskDatasets.length}
            </span>
          </div>
          <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
            <Link href="/en/docs#datasets" className="p-1 hover:bg-white/10 rounded-full transition-colors text-neutral-400 hover:text-white" title="View Documentation">
              <HelpCircle className="w-4 h-4" />
            </Link>
            <button onClick={() => toggleSection('datasets')} className="p-1">
              {expandedSections.datasets ? <ChevronUp className="w-4 h-4 text-neutral-400" /> : <ChevronDown className="w-4 h-4 text-neutral-400" />}
            </button>
          </div>
        </div>
        
        {expandedSections.datasets && (
          <div className="p-4 pt-0">
            {taskDatasets.length === 0 ? (
              <>
                <button
                  onClick={() => setIsDatasetModalOpen(true)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-amber-600/20 text-amber-400 rounded-lg text-sm hover:bg-amber-600/30 transition-colors mb-4"
                >
                  <Plus className="w-4 h-4" />
                  Create Dataset
                </button>
                <p className="text-neutral-500 text-sm">No datasets created yet. Create one to add testcases.</p>
              </>
            ) : (
              // Dataset Management Logic handled in map below
                <div className="mb-4">
                  <button
                    onClick={() => setIsDatasetModalOpen(true)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-amber-600/20 text-amber-400 rounded-lg text-sm hover:bg-amber-600/30 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    New Dataset
                  </button>
                </div>
            )}

            <div className="space-y-4">
                  {taskDatasets.map((dataset) => (
                  <div key={dataset.id} className="p-4 bg-black/30 rounded-lg space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Database className="w-4 h-4 text-amber-400" />
                        <span className="font-medium text-white">{dataset.description}</span>
                        {dataset.id === task.active_dataset_id && (
                          <span className="px-2 py-0.5 text-xs bg-emerald-500/20 text-emerald-400 rounded-full">Active</span>
                        )}
                        {dataset.autojudge && (
                          <span className="px-2 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded-full">Autojudge</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {dataset.id !== task.active_dataset_id && (
                          <button
                            onClick={() => handleActivateDataset(dataset.id)}
                            className="p-1.5 text-emerald-400 hover:bg-emerald-500/20 rounded text-xs flex items-center gap-1"
                            title="Make Live"
                          >
                            <CheckCircle className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          onClick={() => handleCloneDataset(dataset.id, dataset.description)}
                          className="p-1.5 text-indigo-400 hover:bg-indigo-500/20 rounded"
                          title="Clone"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleRenameDataset(dataset.id, dataset.description)}
                          className="p-1.5 text-neutral-400 hover:bg-white/10 rounded"
                          title="Rename"
                        >
                          <Edit className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleToggleAutojudge(dataset.id)}
                          className="p-1.5 text-blue-400 hover:bg-blue-500/20 rounded"
                          title="Toggle Autojudge"
                        >
                          {dataset.autojudge ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                        </button>
                        {dataset.id !== task.active_dataset_id && (
                          <button
                            onClick={() => handleDeleteDataset(dataset.id)}
                            className="p-1.5 text-red-400 hover:bg-red-500/20 rounded"
                            title="Delete"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-neutral-500 text-xs uppercase">Type</span>
                        <div className="text-white text-xs">{dataset.task_type}</div>
                      </div>
                      <div>
                        <span className="text-neutral-500 text-xs uppercase">Time</span>
                        <div className="text-white text-xs">{dataset.time_limit ? `${dataset.time_limit}s` : '-'}</div>
                      </div>
                      <div>
                        <span className="text-neutral-500 text-xs uppercase">Memory</span>
                        <div className="text-white text-xs">{dataset.memory_limit ? `${Number(dataset.memory_limit) / (1024 * 1024)} MiB` : '-'}</div>
                      </div>
                      <div>
                        <span className="text-neutral-500 text-xs uppercase">Score</span>
                        <div className="text-white text-xs">{dataset.score_type}</div>
                      </div>
                    </div>

                    {/* Testcases */}
                    <div className="mt-3 pt-3 border-t border-white/5">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <TestTube className="w-4 h-4 text-cyan-400" />
                            <span className="text-xs font-bold text-neutral-400 uppercase">Testcases ({dataset.testcases.length})</span>
                        </div>
                          <button
                            onClick={() => openTestcaseUpload(dataset.id)}
                            className="text-xs text-cyan-400 hover:underline flex items-center gap-1"
                          >
                            <Plus className="w-3 h-3" /> Add Testcases (Bulk)
                          </button>
                      </div>
                        {dataset.testcases.length === 0 ? (
                        <p className="text-neutral-500 text-xs">No testcases yet.</p>
                      ) : (
                        <div className="grid grid-cols-6 gap-1">
                              {dataset.testcases.slice(0, 12).map((tc) => (
                            <div
                              key={tc.id}
                              className="px-2 py-1 bg-black/40 rounded text-xs text-neutral-300 flex items-center justify-between group"
                            >
                              <span className="truncate">{tc.codename}</span>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => handleToggleTestcasePublic(tc.id)}
                                  className={tc.public ? 'text-emerald-400' : 'text-neutral-500'}
                                  title={tc.public ? 'Public' : 'Private'}
                                >
                                  {tc.public ? 'P' : 'H'}
                                </button>
                                <button
                                  onClick={() => handleDeleteTestcase(tc.id)}
                                  className="text-red-400"
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                          ))}
                              {dataset.testcases.length > 12 && (
                            <div className="px-2 py-1 bg-black/40 rounded text-xs text-neutral-500">
                                  +{dataset.testcases.length - 12} more
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  ))}
            </div>
          </div>
        )}
      </Card>

      {/* Attachments */}
      <Card className="glass-card border-white/5 p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Paperclip className="w-5 h-5 text-purple-400" />
            <span className="font-bold text-white">Attachments</span>
            <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full text-neutral-400">
              {task.attachments.length}
            </span>
          </div>
          <button
            onClick={() => setIsAttachmentModalOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-purple-600/20 text-purple-400 rounded-lg text-sm hover:bg-purple-600/30 transition-colors"
          >
            <Upload className="w-4 h-4" />
            Upload
          </button>
        </div>
        
        {task.attachments.length === 0 ? (
          <p className="text-neutral-500 text-sm">No attachments.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {task.attachments.map((att) => (
              <div key={att.id} className="flex items-center gap-2 p-2 bg-black/30 rounded-lg text-sm text-neutral-300 group">
                <Paperclip className="w-3 h-3 text-purple-400" />
                <span className="truncate flex-1">{att.filename}</span>
                <button
                  onClick={async () => {
                    if (confirm('Delete this attachment?')) {
                      await deleteAttachment(att.id);
                      window.location.reload();
                    }
                  }}
                  className="p-1 text-red-400 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 rounded transition-all"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Modals */}
      <TaskModal
        isOpen={isTaskSettingsOpen}
        onClose={() => setIsTaskSettingsOpen(false)}
        task={task}
        onSuccess={() => window.location.reload()}
      />

      <DatasetModal
        isOpen={isDatasetModalOpen}
        onClose={() => setIsDatasetModalOpen(false)}
        taskId={task.id}
        onSuccess={() => window.location.reload()}
      />

      <StatementModal
        isOpen={isStatementModalOpen}
        onClose={() => setIsStatementModalOpen(false)}
        taskId={task.id}
        existingLanguages={task.statements.map(s => s.language)}
        onSuccess={() => window.location.reload()}
      />

      <AttachmentModal
        isOpen={isAttachmentModalOpen}
        onClose={() => setIsAttachmentModalOpen(false)}
        taskId={task.id}
        onSuccess={() => window.location.reload()}
      />

      {currentDatasetId && (
        <TestcaseUploadModal
          isOpen={true}
          onClose={() => setCurrentDatasetId(null)}
          datasetId={currentDatasetId}
          onSuccess={() => window.location.reload()}
        />
      )}
    </div>
  );
}
