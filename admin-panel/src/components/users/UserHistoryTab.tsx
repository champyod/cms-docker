import { History } from 'lucide-react';
import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import type { Dictionary } from '@/lib/dictionary';
import type { UserHistory } from '@/lib/people-read-model-types';

export interface UserHistoryTabProps {
  readonly history: UserHistory;
  readonly navigation: Dictionary['navigation'];
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <Card className="p-4 space-y-3">
      <h2 className="font-bold">{title}</h2>
      {children}
      {children === null && <EmptyState icon={History} title={empty} />}
    </Card>
  );
}

export function UserHistoryTab({ history, navigation }: UserHistoryTabProps): React.JSX.Element {
  const labels = navigation.people['user-tabs'].history.label;
  return (
    <div className="space-y-6">
      <h2 className="sr-only">{labels}</h2>
      <Card className="p-4 space-y-3">
        <h2 className="font-bold">Account Access</h2>
        <div className="text-sm text-foreground">Last login: {history.accountAccess.lastLoginAt ?? '—'}</div>
      </Card>
      <Section title="Contests" empty="No contest activity.">
        {history.contests.length > 0 ? (
          <div className="divide-y divide-border">
            {history.contests.map((contest) => (
              <div key={`${contest.id}-${contest.name}`} className="py-2 text-sm">{contest.name ?? `Contest #${contest.id}`}</div>
            ))}
          </div>
        ) : null}
      </Section>
      <Section title="Participations" empty="No participations.">
        {history.participations.length > 0 ? (
          <div className="divide-y divide-border">
            {history.participations.map((participation) => (
              <div key={participation.id} className="py-2 text-sm">
                {participation.contestName ?? `Contest #${participation.contestId}`} · {participation.teamCode ?? 'No team'}
              </div>
            ))}
          </div>
        ) : null}
      </Section>
      <Section title="Teams" empty="No teams.">
        {history.teams.length > 0 ? (
          <div className="divide-y divide-border">
            {history.teams.map((team) => (
              <div key={`${team.id}-${team.code}`} className="py-2 text-sm font-mono">{team.code ?? team.name ?? `Team #${team.id}`}</div>
            ))}
          </div>
        ) : null}
      </Section>
      <Section title="Submissions" empty="No submissions.">
        {history.submissions.length > 0 ? (
          <div className="divide-y divide-border">
            {history.submissions.map((submission) => (
              <div key={submission.id} className="py-2 text-sm">
                #{submission.id} · {submission.taskName ?? `Task #${submission.taskId}`} · {submission.score ?? '—'}
              </div>
            ))}
          </div>
        ) : null}
      </Section>
      <Section title="Recent Activity" empty="No recent activity.">
        {history.recentContestActivity.length > 0 ? (
          <div className="divide-y divide-border">
            {history.recentContestActivity.map((submission) => (
              <div key={submission.id} className="py-2 text-sm">
                #{submission.id} · {submission.contestName ?? `Contest #${submission.contestId}`} · {submission.timestamp}
              </div>
            ))}
          </div>
        ) : null}
      </Section>
    </div>
  );
}
