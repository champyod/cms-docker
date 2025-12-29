'use client';

import { useState } from 'react';
import { tasks, statements, attachments, datasets, testcases, managers, contests } from '@prisma/client';
import { Card } from '@/components/core/Card';
import { 
  Settings, FileText, Paperclip, Database, TestTube, 
  ChevronDown, ChevronUp, Save, Plus, Trash2, ExternalLink, Upload,
  Copy, Edit, CheckCircle, ToggleLeft, ToggleRight, Download
} from 'lucide-react';
import { updateTask } from '@/app/actions/tasks';
import { activateDataset, cloneDataset, deleteDataset, renameDataset, toggleAutojudge } from '@/app/actions/datasets';
import { deleteTestcase, toggleTestcasePublic } from '@/app/actions/testcases';
import { deleteStatement, deleteAttachment } from '@/app/actions/statements';
import { DatasetModal } from './DatasetModal';
import { StatementModal } from './StatementModal';
import { AttachmentModal } from './AttachmentModal';

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
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: task.name,
    title: task.title,
    score_precision: task.score_precision,
  });
  const [isDatasetModalOpen, setIsDatasetModalOpen] = useState(false);
  const [isStatementModalOpen, setIsStatementModalOpen] = useState(false);
  const [isAttachmentModalOpen, setIsAttachmentModalOpen] = useState(false);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateTask(task.id, formData);
      window.location.reload();
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setSaving(false);
    }
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

  // Defensive defaults - ensure all array fields are actually arrays
  const taskStatements = Array.isArray(task.statements) ? task.statements : [];
  const taskAttachments = Array.isArray(task.attachments) ? task.attachments : [];
  const taskDatasets = Array.isArray(task.datasets) ? task.datasets : [];

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
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {/* Task Settings */}
      <Card className="glass-card border-white/5 overflow-hidden">
        <button
          onClick={() => toggleSection('info')}
          className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Settings className="w-5 h-5 text-indigo-400" />
            <span className="font-bold text-white">Task Settings</span>
          </div>
          {expandedSections.info ? <ChevronUp className="w-4 h-4 text-neutral-400" /> : <ChevronDown className="w-4 h-4 text-neutral-400" />}
        </button>
        
        {expandedSections.info && (
          <div className="p-4 pt-0 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Title</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Score Precision</label>
              <input
                type="number"
                value={formData.score_precision}
                onChange={(e) => setFormData({ ...formData, score_precision: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Submissions</label>
              <div className="px-3 py-2 bg-black/30 border border-white/5 rounded-lg text-neutral-400 text-sm">
                {task._count.submissions} total
              </div>
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
              {taskStatements.length}
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
            
            {taskStatements.length === 0 ? (
              <p className="text-neutral-500 text-sm">No statements uploaded yet.</p>
            ) : (
              <div className="space-y-2">
                  {taskStatements.map((stmt) => (
                  <div key={stmt.id} className="flex items-center justify-between p-3 bg-black/30 rounded-lg">
                    <div className="flex items-center gap-3">
                      <FileText className="w-4 h-4 text-emerald-400" />
                      <span className="text-sm text-white">Language: {stmt.language}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <a href="#" className="text-xs text-indigo-400 hover:underline">Download</a>
                      <button className="p-1 text-red-400 hover:bg-red-500/20 rounded">
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
        <button
          onClick={() => toggleSection('datasets')}
          className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Database className="w-5 h-5 text-amber-400" />
            <span className="font-bold text-white">Datasets</span>
            <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full text-neutral-400">
              {taskDatasets.length}
            </span>
          </div>
          {expandedSections.datasets ? <ChevronUp className="w-4 h-4 text-neutral-400" /> : <ChevronDown className="w-4 h-4 text-neutral-400" />}
        </button>
        
        {expandedSections.datasets && (
          <div className="p-4 pt-0">
            <button
              onClick={() => setIsDatasetModalOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-amber-600/20 text-amber-400 rounded-lg text-sm hover:bg-amber-600/30 transition-colors mb-4"
            >
              <Plus className="w-4 h-4" />
              Create Dataset
            </button>
            
            {taskDatasets.length === 0 ? (
              <p className="text-neutral-500 text-sm">No datasets created yet.</p>
            ) : (
              <div className="space-y-4">
                  {taskDatasets.map((dataset) => {
                    // Defensive: ensure testcases is always an array
                    const datasetTestcases = Array.isArray(dataset.testcases) ? dataset.testcases : [];
                    return (
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
                              <span className="text-xs font-bold text-neutral-400 uppercase">Testcases ({datasetTestcases.length})</span>
                        </div>
                        <button className="text-xs text-cyan-400 hover:underline">+ Add Testcase</button>
                      </div>
                          {datasetTestcases.length === 0 ? (
                        <p className="text-neutral-500 text-xs">No testcases yet.</p>
                      ) : (
                        <div className="grid grid-cols-6 gap-1">
                                {datasetTestcases.slice(0, 12).map((tc) => (
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
                                {datasetTestcases.length > 12 && (
                            <div className="px-2 py-1 bg-black/40 rounded text-xs text-neutral-500">
                                    +{datasetTestcases.length - 12} more
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                    );
                  })}
              </div>
            )}
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
              {taskAttachments.map((att) => (
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

      {/* Dataset Modal */}
      <DatasetModal
        isOpen={isDatasetModalOpen}
        onClose={() => setIsDatasetModalOpen(false)}
        taskId={task.id}
        onSuccess={() => window.location.reload()}
      />

      {/* Statement Modal */}
      <StatementModal
        isOpen={isStatementModalOpen}
        onClose={() => setIsStatementModalOpen(false)}
        taskId={task.id}
        existingLanguages={taskStatements.map(s => s.language)}
        onSuccess={() => window.location.reload()}
      />

      {/* Attachment Modal */}
      <AttachmentModal
        isOpen={isAttachmentModalOpen}
        onClose={() => setIsAttachmentModalOpen(false)}
        taskId={task.id}
        onSuccess={() => window.location.reload()}
      />
    </div>
  );
}
