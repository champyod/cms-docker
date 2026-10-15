'use client';

import Link from 'next/link';

import { useDictionary } from '@/hooks/useDictionary';
import { interpolate } from '@/lib/interpolate';
import type { SubmissionSummary } from '@/lib/evaluation-read-model-types';
import { buildRoute } from '@/lib/navigation/routes';

function identityLink(key: string, href: string, label: string): React.JSX.Element {
  return (
    <Link key={key} href={href} className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full font-mono">
      {label}
    </Link>
  );
}

// Why both hrefs per entity: the record chip reaches one submission's owner, the list chip every submission of the same entity.
export function SubmissionRecordLinks({ summary, locale, canListSubmissions, previousId }: {
  readonly summary: SubmissionSummary;
  readonly locale: string;
  readonly canListSubmissions: boolean;
  readonly previousId?: number;
}): React.JSX.Element | null {
  const record = useDictionary().submissions.record;
  const links = record.links;
  const entries: React.JSX.Element[] = [];
  if (previousId !== undefined) {
    entries.push(identityLink(
      'previous-compare',
      buildRoute(locale, 'evaluation.submission-tabs.summary', { id: summary.id }) + '#submission-compare',
      interpolate(record.compare.chip, { id: previousId }),
    ));
  }
  const listLink = (key: string, query: string, label: string): React.JSX.Element =>
    identityLink(key, buildRoute(locale, 'evaluation.submissions') + '?' + query, label);
  if (summary.user) {
    entries.push(identityLink('user-record', buildRoute(locale, 'people.user-record', { id: summary.user.id }), summary.user.username));
    if (canListSubmissions) {
      entries.push(listLink('user-list', 'user=' + summary.user.id, interpolate(links.allByUser, { name: summary.user.username })));
    }
  }
  if (summary.task) {
    entries.push(identityLink('task-record', buildRoute(locale, 'tasks.record', { id: summary.task.id }), summary.task.name));
    if (canListSubmissions) {
      entries.push(listLink('task-list', 'task=' + summary.task.id, interpolate(links.allForTask, { name: summary.task.name })));
    }
  }
  if (summary.contest) {
    entries.push(identityLink('contest-record', buildRoute(locale, 'contests.record', { id: summary.contest.id }), summary.contest.name));
    if (canListSubmissions) {
      entries.push(listLink('contest-list', 'contest=' + summary.contest.id, interpolate(links.allForContest, { name: summary.contest.name })));
    }
  }
  if (entries.length === 0) return null;
  return <>{entries}</>;
}
