import Link from 'next/link';
import { ExternalLink, Trophy } from 'lucide-react';

import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import type { Dictionary } from '@/lib/dictionary';
import { buildRoute } from '@/lib/navigation/routes';
import type { TeamContest } from '@/lib/people-read-model-types';

export interface TeamContestsTabProps {
  readonly contests: readonly TeamContest[];
  readonly navigation: Dictionary['navigation'];
  readonly locale: 'en' | 'th';
}

// Why: a contest whose id is not readable must not become a link, because the
// canonical record route can only be built from a readable id.
function contestHref(locale: 'en' | 'th', contest: TeamContest): string | null {
  if (contest.id === null) return null;
  return buildRoute(locale, 'contests.tabs.overview', { id: contest.id });
}

function ContestRow({ contest, locale }: { readonly contest: TeamContest; readonly locale: 'en' | 'th' }): React.JSX.Element {
  const href = contestHref(locale, contest);
  return (
    <div className="p-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-warning/10 border border-warning/20 flex items-center justify-center text-warning font-bold text-sm">
          {(contest.name ?? '—').substring(0, 2).toUpperCase()}
        </div>
        <div>
          <div className="font-medium">{contest.name ?? '—'}</div>
          <div className="text-xs text-muted-foreground">{contest.description ?? '—'}</div>
        </div>
      </div>
      {href && (
        <Link href={href} className="inline-flex size-11 shrink-0 items-center justify-center text-muted-foreground hover:text-primary transition-colors" aria-label={contest.name ?? undefined}>
          <ExternalLink className="w-4 h-4" />
        </Link>
      )}
    </div>
  );
}

export function TeamContestsTab({ contests, navigation, locale }: TeamContestsTabProps): React.JSX.Element {
  if (contests.length === 0) {
    return <EmptyState icon={Trophy} title="No contests found." description="This team is not participating in any contests yet." />;
  }
  return (
    <Card className="overflow-hidden">
      <div className="p-4 font-bold">
        {`${navigation.people['team-tabs'].contests.label} (${contests.length})`}
      </div>
      <div className="divide-y divide-border">
        {contests.map((contest, index) => (
          // Why: a field-filtered contest may carry no id, so the row position
          // joins the readable key instead of relying on it alone.
          <ContestRow key={`${contest.id ?? contest.name ?? 'contest'}-${index}`} contest={contest} locale={locale} />
        ))}
      </div>
    </Card>
  );
}
