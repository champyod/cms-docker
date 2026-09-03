'use client';

import { ChevronDown, ChevronUp, ExternalLink, Save, Settings, Trash2, Trophy, Users } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

import { deleteTeam, updateTeam } from '@/app/actions/teams';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';

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
  const pathname = usePathname();
  const locale = pathname.split('/')[1] || 'en';
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
        router.push(`/${locale}/teams`);
      } else {
        alert('Failed: ' + result.error);
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{team.name}</h1>
          <p className="text-muted-foreground mt-1">Team Code: <code className="text-primary">{team.code}</code></p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="negativeOutline" icon={Trash2} onClick={handleDelete}>
            Delete Team
          </Button>
          <Button variant="positive" icon={Save} loading={saving} disabled={saving} onClick={handleSave}>
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>
      <Card className="overflow-hidden">
        <button
          onClick={() => toggleSection('info')}
          className="w-full p-4 flex items-center justify-between hover:bg-accent/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Settings className="w-5 h-5 text-primary" />
            <span className="font-bold">Team Information</span>
          </div>
          {expandedSections.info ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>

        {expandedSections.info && (
          <div className="p-4 pt-0 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-muted-foreground uppercase mb-1">Team Code</label>
              <input
                type="text"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                className="w-full px-3 py-2 bg-background/60 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/30 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground uppercase mb-1">Team Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 bg-background/60 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/30 transition-colors"
              />
            </div>
          </div>
        )}
      </Card>
      <Card className="overflow-hidden">
        <button
          onClick={() => toggleSection('members')}
          className="w-full p-4 flex items-center justify-between hover:bg-accent/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Users className="w-5 h-5 text-success" />
            <span className="font-bold">Team Members ({team.members.length})</span>
          </div>
          {expandedSections.members ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>

        {expandedSections.members && (
          <div className="divide-y divide-border">
            {team.members.map((member) => (
              <div key={member.user.id} className="p-4 flex items-center justify-between hover:bg-accent/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center text-xs font-bold text-primary">
                    {member.user.username.substring(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="font-medium">{member.user.username}</div>
                    <div className="text-xs text-muted-foreground">{member.user.first_name} {member.user.last_name}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {member.contests.slice(0, 3).map(c => (
                    <span key={c.id} className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full">
                      {c.name}
                    </span>
                  ))}
                  {member.contests.length > 3 && (
                    <span className="text-xs text-muted-foreground">+{member.contests.length - 3} more</span>
                  )}
                  <a
                    href={`/${locale}/users/${member.user.id}`}
                    className="p-1.5 text-muted-foreground hover:text-primary transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>
            ))}
            {team.members.length === 0 && (
              <div className="p-8 text-center text-muted-foreground text-sm">
                No members in this team yet. Add members by assigning this team to a participation in a contest.
              </div>
            )}
          </div>
        )}
      </Card>
      <Card className="overflow-hidden">
        <button
          onClick={() => toggleSection('contests')}
          className="w-full p-4 flex items-center justify-between hover:bg-accent/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Trophy className="w-5 h-5 text-warning" />
            <span className="font-bold">Contests ({team.contests.length})</span>
          </div>
          {expandedSections.contests ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>

        {expandedSections.contests && (
          <div className="divide-y divide-border">
            {team.contests.map((contest) => (
              <div key={contest.id} className="p-4 flex items-center justify-between hover:bg-accent/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-warning/10 border border-warning/20 flex items-center justify-center text-warning font-bold text-sm">
                    {contest.name.substring(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="font-medium">{contest.name}</div>
                    <div className="text-xs text-muted-foreground">{contest.description}</div>
                  </div>
                </div>
                <a
                  href={`/${locale}/contests/${contest.id}`}
                  className="p-1.5 text-muted-foreground hover:text-primary transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            ))}
            {team.contests.length === 0 && (
              <div className="p-8 text-center text-muted-foreground text-sm">
                This team is not participating in any contests yet.
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
