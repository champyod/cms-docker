import Link from 'next/link';
import { ExternalLink, Trophy } from 'lucide-react';

import { EmptyState } from '@/components/core/EmptyState';
import type { Dictionary } from '@/lib/dictionary';
import { buildRoute } from '@/lib/navigation/routes';
import type { TeamContest } from '@/lib/people-read-model-types';

export interface TeamContestsTabProps {
  readonly contests: readonly TeamContest[];
  readonly locale: 'en' | 'th';
  /** common.notSet: a contest whose name or description the record does not hold. */
  readonly missing: string;
}

// A contest whose id is not readable must not become a link: the record route needs a readable id.
function contestHref(locale: 'en' | 'th', contest: TeamContest): string | null {
  if (contest.id === null) return null;
  return buildRoute(locale, 'contests.tabs.overview', { id: contest.id });
}

function ContestRow({ contest, locale, missing }: { readonly contest: TeamContest; readonly locale: 'en' | 'th'; readonly missing: string }): React.JSX.Element {
  const href = contestHref(locale, contest);
  return (
    <div className="p-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-warning/10 border border-warning/20 flex items-center justify-center text-warning font-bold text-sm">
          {(contest.name ?? missing).substring(0, 2).toUpperCase()}
        </div>
        <div>
          <div className="font-medium">{contest.name ?? missing}</div>
          <div className="text-xs text-muted-foreground">{contest.description ?? missing}</div>
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

export function TeamContestsTab({ contests, locale, missing }: TeamContestsTabProps): React.JSX.Element {
  return (
    <div className="divide-y divide-border">
      {contests.map((contest, index) => (
        // A field-filtered contest may carry no id, so the row position joins the readable key.
        <ContestRow key={`${contest.id ?? contest.name ?? 'contest'}-${index}`} contest={contest} locale={locale} missing={missing} />
      ))}
    </div>
  );
}

/** What empty means here: this team has not been fielded in a contest yet. */
export function TeamContestsEmpty({ copy }: { readonly copy: Dictionary['teams'] }): React.JSX.Element {
  return (
    <EmptyState
      icon={Trophy}
      title={copy.contests.emptyTitle}
      description={copy.contests.emptyDescription}
    />
  );
}
