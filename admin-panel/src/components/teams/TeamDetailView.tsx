'use client';

import { ExternalLink, Save, Settings, Trash2, Trophy, Users } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { useState } from 'react';

import { deleteTeam, updateTeam } from '@/app/actions/teams';
import { buildRoute } from '@/lib/navigation/routes';
import { Button } from '@/components/core/Button';
import { SaveButton } from '@/components/core/SaveButton';
import { SectionCard } from '@/components/core/SectionCard';
import { useConfirm } from '@/hooks/useConfirm';
import { useConfirmationCopy } from '@/hooks/useConfirmationCopy';
import { useJustSavedFlag } from '@/hooks/useJustSavedFlag';

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
  const router = useAppRouter();
  const pathname = usePathname();
  const locale = pathname.split('/')[1] || 'en';
  const confirm = useConfirm();
  const { destructiveConfirm } = useConfirmationCopy();
  const [saving, setSaving] = useState(false);
  const { justSaved, flashSaved } = useJustSavedFlag();
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

  const runAction = useActionFeedback();

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await runAction(
        {
          pending: 'Saving team...',
          success: 'Team saved',
          failure: 'Save failed',
          description: `${team.name} updated successfully.`,
        },
        () => updateTeam(team.id, formData)
      );
      if (!result) return;
      if (result.success) {
        flashSaved();
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!(await confirm(destructiveConfirm('team')))) return;
    const result = await runAction(
      { pending: 'Deleting team...', success: 'Team deleted', failure: 'Delete failed' },
      () => deleteTeam(team.id)
    );
    if (result?.success) router.push(buildRoute(locale, 'people.teams'));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{team.name}</h1>
          <p className="text-muted-foreground mt-1">Team Code: <code className="text-primary">{team.code}</code></p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="negativeOutline" icon={Trash2} iconOnly tooltip="Delete team" onClick={() => { void handleDelete(); }} />
          <SaveButton saving={saving} justSaved={justSaved} idleLabel="Save Changes" disabled={saving} onClick={() => { void handleSave(); }} />
        </div>
      </div>
      <SectionCard
        title="Team Information"
        icon={<Settings className="w-5 h-5 text-primary" />}
        expanded={expandedSections.info}
        onToggle={(): void => toggleSection('info')}
      >
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
      </SectionCard>
      <SectionCard
        title="Team Members"
        count={team.members.length}
        icon={<Users className="w-5 h-5 text-success" />}
        expanded={expandedSections.members}
        onToggle={(): void => toggleSection('members')}
      >
        <div className="divide-y divide-border">
          {team.members.map((member) => (
            <div key={member.user.id} className="p-4 flex flex-wrap items-center justify-between gap-3 hover:bg-accent/50 transition-colors">
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
                  href={buildRoute(locale, 'people.user-tabs.profile', { id: member.user.id })}
                  className="inline-flex size-11 shrink-0 items-center justify-center text-muted-foreground hover:text-primary transition-colors"
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
      </SectionCard>
      <SectionCard
        title="Contests"
        count={team.contests.length}
        icon={<Trophy className="w-5 h-5 text-warning" />}
        expanded={expandedSections.contests}
        onToggle={(): void => toggleSection('contests')}
      >
        <div className="divide-y divide-border">
          {team.contests.map((contest) => (
            <div key={contest.id} className="p-4 flex flex-wrap items-center justify-between gap-3 hover:bg-accent/50 transition-colors">
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
                href={buildRoute(locale, 'contests.tabs.overview', { id: contest.id })}
                className="inline-flex size-11 shrink-0 items-center justify-center text-muted-foreground hover:text-primary transition-colors"
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
      </SectionCard>
    </div>
  );
}
