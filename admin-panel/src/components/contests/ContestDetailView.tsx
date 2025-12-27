'use client';

import { useState } from 'react';
import { contests, tasks, users, participations } from '@prisma/client';
import { Card } from '@/components/core/Card';
import { 
  Settings, Users, Trophy, Clock, Shield, Zap, 
  Plus, Trash2, ExternalLink, Play, Square, 
  ChevronDown, ChevronUp, Save
} from 'lucide-react';
import { ParticipantModal } from './ParticipantModal';
import { ContestCommunications } from './ContestCommunications';
import { updateContestSettings, addParticipant, removeParticipant } from '@/app/actions/contests';


type ContestWithRelations = contests & {
  tasks: tasks[];
  participations: (participations & { users: users })[];
};

interface ContestDetailViewProps {
  contest: ContestWithRelations;
  availableUsers: users[];
  availableTasks: tasks[];
}

export function ContestDetailView({ contest, availableUsers, availableTasks }: ContestDetailViewProps) {
  const [isParticipantModalOpen, setIsParticipantModalOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    info: true,
    participants: true,
    tasks: true,
    services: true,
  });
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: contest.name,
    description: contest.description,
    timezone: contest.timezone || '',
    allow_questions: contest.allow_questions,
    allow_user_tests: contest.allow_user_tests,
    submissions_download_allowed: contest.submissions_download_allowed,
    allow_password_authentication: contest.allow_password_authentication,
    allow_registration: contest.allow_registration,
    analysis_enabled: contest.analysis_enabled,
    token_mode: contest.token_mode,
    score_precision: contest.score_precision,
    start: contest.start ? new Date(contest.start).toISOString().slice(0, 16) : '',
    stop: contest.stop ? new Date(contest.stop).toISOString().slice(0, 16) : '',
    analysis_start: contest.analysis_start ? new Date(contest.analysis_start).toISOString().slice(0, 16) : '',
    analysis_stop: contest.analysis_stop ? new Date(contest.analysis_stop).toISOString().slice(0, 16) : '',
  });

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateContestSettings(contest.id, formData);
      window.location.reload();
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveParticipant = async (participationId: number) => {
    if (confirm('Remove this participant from the contest?')) {
      await removeParticipant(participationId);
      window.location.reload();
    }
  };

  // Non-participants (users not in this contest)
  const participantUserIds = new Set(contest.participations.map(p => p.user_id));
  const nonParticipants = availableUsers.filter(u => !participantUserIds.has(u.id));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">{contest.name}</h1>
          <p className="text-neutral-400 mt-1">{contest.description}</p>
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

      {/* Contest Status & Times */}
      <Card className="p-4 glass-card border-white/5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Zap className="w-5 h-5 text-amber-400" />
            <span className="font-bold text-white">Contest Status</span>
          </div>
          <div className="flex items-center gap-2">
            {(() => {
              const now = new Date();
              const start = contest.start ? new Date(contest.start) : null;
              const stop = contest.stop ? new Date(contest.stop) : null;
              const analysisStart = contest.analysis_start ? new Date(contest.analysis_start) : null;
              const analysisStop = contest.analysis_stop ? new Date(contest.analysis_stop) : null;

              if (!start || now < start) {
                return <span className="px-3 py-1 bg-neutral-600/30 text-neutral-400 rounded-full text-sm">Not Started</span>;
              } else if (stop && now < stop) {
                return <span className="px-3 py-1 bg-emerald-600/30 text-emerald-400 rounded-full text-sm animate-pulse">Running</span>;
              } else if (analysisStart && analysisStop && now >= analysisStart && now < analysisStop) {
                return <span className="px-3 py-1 bg-purple-600/30 text-purple-400 rounded-full text-sm">Analysis Mode</span>;
              } else {
                return <span className="px-3 py-1 bg-red-600/30 text-red-400 rounded-full text-sm">Ended</span>;
              }
            })()}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Contest Start</label>
            <input
              type="datetime-local"
              value={formData.start}
              onChange={(e) => setFormData({ ...formData, start: e.target.value })}
              className="w-full px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Contest Stop</label>
            <input
              type="datetime-local"
              value={formData.stop}
              onChange={(e) => setFormData({ ...formData, stop: e.target.value })}
              className="w-full px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Analysis Start</label>
            <input
              type="datetime-local"
              value={formData.analysis_start}
              onChange={(e) => setFormData({ ...formData, analysis_start: e.target.value })}
              className="w-full px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Analysis Stop</label>
            <input
              type="datetime-local"
              value={formData.analysis_stop}
              onChange={(e) => setFormData({ ...formData, analysis_stop: e.target.value })}
              className="w-full px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50"
            />
          </div>
        </div>
      </Card>

      {/* Contest Settings */}
      <Card className="glass-card border-white/5 overflow-hidden">
        <button
          onClick={() => toggleSection('info')}
          className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Settings className="w-5 h-5 text-indigo-400" />
            <span className="font-bold text-white">Contest Settings</span>
          </div>
          {expandedSections.info ? <ChevronUp className="w-4 h-4 text-neutral-400" /> : <ChevronDown className="w-4 h-4 text-neutral-400" />}
        </button>
        
        {expandedSections.info && (
          <div className="p-4 pt-0 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-4">
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
                <label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Timezone</label>
                <input
                  type="text"
                  value={formData.timezone}
                  onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                  placeholder="Asia/Bangkok"
                  className="w-full px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50"
                />
              </div>
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm text-neutral-300">Allow Questions</label>
                <input
                  type="checkbox"
                  checked={formData.allow_questions}
                  onChange={(e) => setFormData({ ...formData, allow_questions: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-sm text-neutral-300">Allow User Tests</label>
                <input
                  type="checkbox"
                  checked={formData.allow_user_tests}
                  onChange={(e) => setFormData({ ...formData, allow_user_tests: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-sm text-neutral-300">Download Submissions</label>
                <input
                  type="checkbox"
                  checked={formData.submissions_download_allowed}
                  onChange={(e) => setFormData({ ...formData, submissions_download_allowed: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-sm text-neutral-300">Password Auth</label>
                <input
                  type="checkbox"
                  checked={formData.allow_password_authentication}
                  onChange={(e) => setFormData({ ...formData, allow_password_authentication: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-sm text-neutral-300">Allow Registration</label>
                <input
                  type="checkbox"
                  checked={formData.allow_registration}
                  onChange={(e) => setFormData({ ...formData, allow_registration: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-sm text-neutral-300">Analysis Mode</label>
                <input
                  type="checkbox"
                  checked={formData.analysis_enabled}
                  onChange={(e) => setFormData({ ...formData, analysis_enabled: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Participants */}
      <Card className="glass-card border-white/5 overflow-hidden">
        <button
          onClick={() => toggleSection('participants')}
          className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Users className="w-5 h-5 text-emerald-400" />
            <span className="font-bold text-white">Participants</span>
            <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full text-neutral-400">
              {contest.participations.length}
            </span>
          </div>
          {expandedSections.participants ? <ChevronUp className="w-4 h-4 text-neutral-400" /> : <ChevronDown className="w-4 h-4 text-neutral-400" />}
        </button>
        
        {expandedSections.participants && (
          <div className="p-4 pt-0">
            <button
              onClick={() => setIsParticipantModalOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600/20 text-indigo-400 rounded-lg text-sm hover:bg-indigo-600/30 transition-colors mb-4"
            >
              <Plus className="w-4 h-4" />
              Add Participant
            </button>
            
            {contest.participations.length === 0 ? (
              <p className="text-neutral-500 text-sm">No participants yet.</p>
            ) : (
              <div className="space-y-2">
                {contest.participations.map((p) => (
                  <div key={p.id} className="flex items-center justify-between p-3 bg-black/30 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-indigo-600/20 flex items-center justify-center text-indigo-400 font-bold text-sm">
                        {p.users.username.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-white">{p.users.username}</div>
                        <div className="text-xs text-neutral-500">
                          {p.users.first_name} {p.users.last_name}
                          {p.hidden && <span className="ml-2 text-amber-400">(Hidden)</span>}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveParticipant(p.id)}
                      className="p-1.5 text-red-400 hover:bg-red-500/20 rounded transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Tasks */}
      <Card className="glass-card border-white/5 overflow-hidden">
        <button
          onClick={() => toggleSection('tasks')}
          className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Trophy className="w-5 h-5 text-amber-400" />
            <span className="font-bold text-white">Tasks</span>
            <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full text-neutral-400">
              {contest.tasks.length}
            </span>
          </div>
          {expandedSections.tasks ? <ChevronUp className="w-4 h-4 text-neutral-400" /> : <ChevronDown className="w-4 h-4 text-neutral-400" />}
        </button>
        
        {expandedSections.tasks && (
          <div className="p-4 pt-0">
            {contest.tasks.length === 0 ? (
              <p className="text-neutral-500 text-sm">No tasks assigned to this contest.</p>
            ) : (
              <div className="space-y-2">
                {contest.tasks.map((task, index) => (
                  <a
                    key={task.id}
                    href={`/en/tasks/${task.id}`}
                    className="flex items-center justify-between p-3 bg-black/30 rounded-lg hover:bg-black/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-amber-600/20 flex items-center justify-center text-amber-400 font-bold text-sm">
                        {index + 1}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-white">{task.title || task.name}</div>
                        <div className="text-xs text-neutral-500">{task.name}</div>
                      </div>
                    </div>
                    <ExternalLink className="w-4 h-4 text-neutral-500" />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Communications: Announcements, Questions, Ranking */}
      <ContestCommunications contestId={contest.id} adminId={1} />

      {/* Participant Modal */}
      <ParticipantModal
        isOpen={isParticipantModalOpen}
        onClose={() => setIsParticipantModalOpen(false)}
        contestId={contest.id}
        availableUsers={nonParticipants}
      />
    </div>
  );
}

