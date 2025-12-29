'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateTeam, deleteTeam } from '@/app/actions/teams';
import { Card } from '@/components/core/Card';
import { 
  Users, Trophy, Settings, Save, Trash2, 
  ChevronDown, ChevronUp, ExternalLink, Edit2
} from 'lucide-react';

interface TeamMember {
  user: {
    id: number;
    username: string;
    first_name: string;
    last_name: string;
  };
  contests: { id: number; name: string }[];
}

interface TeamContest {
  id: number;
  name: string;
  description: string;
  start: string;
  stop: string;
}

interface TeamDetailViewProps {
  team: {
    id: number;
    code: string;
    name: string;
    members: TeamMember[];
    contests: TeamContest[];
  };
}

export function TeamDetailView({ team }: TeamDetailViewProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    code: team.code,
    name: team.name,
  });
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    info: true,
    members: true,
    contests: true,
  });

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await updateTeam(team.id, formData);
      if (result.success) {
        router.refresh();
      } else {
        alert('Failed: ' + result.error);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (confirm('Are you sure you want to delete this team? This cannot be undone.')) {
      const result = await deleteTeam(team.id);
      if (result.success) {
        router.push('/teams');
      } else {
        alert('Failed: ' + result.error);
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">{team.name}</h1>
          <p className="text-neutral-400 mt-1">Team Code: <code className="text-indigo-400">{team.code}</code></p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleDelete}
            className="flex items-center gap-2 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Delete Team
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* General Info */}
      <Card className="glass-card border-white/5 overflow-hidden">
        <button
          onClick={() => toggleSection('info')}
          className="w-full p-4 flex items-center justify-between hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Settings className="w-5 h-5 text-indigo-400" />
            <span className="font-bold text-white">Team Information</span>
          </div>
          {expandedSections.info ? <ChevronUp className="w-4 h-4 text-neutral-400" /> : <ChevronDown className="w-4 h-4 text-neutral-400" />}
        </button>
        
        {expandedSections.info && (
          <div className="p-4 pt-0 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Team Code</label>
              <input
                type="text"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                className="w-full px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Team Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 bg-black/50 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50"
              />
            </div>
          </div>
        )}
      </Card>

      {/* Members */}
      <Card className="glass-card border-white/5 overflow-hidden">
        <button
          onClick={() => toggleSection('members')}
          className="w-full p-4 flex items-center justify-between hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Users className="w-5 h-5 text-green-400" />
            <span className="font-bold text-white">Team Members ({team.members.length})</span>
          </div>
          {expandedSections.members ? <ChevronUp className="w-4 h-4 text-neutral-400" /> : <ChevronDown className="w-4 h-4 text-neutral-400" />}
        </button>

        {expandedSections.members && (
          <div className="divide-y divide-white/5">
            {team.members.map((member) => (
              <div key={member.user.id} className="p-4 flex items-center justify-between hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-green-500 to-emerald-500 flex items-center justify-center text-xs font-bold text-white">
                    {member.user.username.substring(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="font-medium text-white">{member.user.username}</div>
                    <div className="text-xs text-neutral-500">{member.user.first_name} {member.user.last_name}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {member.contests.slice(0, 3).map(c => (
                    <span key={c.id} className="text-xs px-2 py-0.5 bg-indigo-600/20 text-indigo-400 rounded-full">
                      {c.name}
                    </span>
                  ))}
                  {member.contests.length > 3 && (
                    <span className="text-xs text-neutral-500">+{member.contests.length - 3} more</span>
                  )}
                  <a
                    href={`/users/${member.user.id}`}
                    className="p-1.5 text-neutral-500 hover:text-indigo-400 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>
            ))}
            {team.members.length === 0 && (
              <div className="p-8 text-center text-neutral-500 text-sm">
                No members in this team yet. Add members by assigning this team to a participation in a contest.
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Contests */}
      <Card className="glass-card border-white/5 overflow-hidden">
        <button
          onClick={() => toggleSection('contests')}
          className="w-full p-4 flex items-center justify-between hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Trophy className="w-5 h-5 text-amber-400" />
            <span className="font-bold text-white">Contests ({team.contests.length})</span>
          </div>
          {expandedSections.contests ? <ChevronUp className="w-4 h-4 text-neutral-400" /> : <ChevronDown className="w-4 h-4 text-neutral-400" />}
        </button>

        {expandedSections.contests && (
          <div className="divide-y divide-white/5">
            {team.contests.map((contest) => (
              <div key={contest.id} className="p-4 flex items-center justify-between hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-600/20 flex items-center justify-center text-amber-400 font-bold text-sm">
                    {contest.name.substring(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="font-medium text-white">{contest.name}</div>
                    <div className="text-xs text-neutral-500">{contest.description}</div>
                  </div>
                </div>
                <a
                  href={`/contests/${contest.id}`}
                  className="p-1.5 text-neutral-500 hover:text-indigo-400 transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            ))}
            {team.contests.length === 0 && (
              <div className="p-8 text-center text-neutral-500 text-sm">
                This team is not participating in any contests yet.
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
