'use client';

import Link from 'next/link';
import { AlertCircle, Loader2 } from 'lucide-react';

import { Card } from '@/components/core/Card';
import type { Dictionary } from '@/lib/dictionary';
import type { SubmissionSummary } from '@/lib/evaluation-read-model-types';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { buildRoute } from '@/lib/navigation/routes';
import type { RouteId } from '@/lib/navigation/types';

import { SubmissionActionBar } from './SubmissionActionBar';

export interface SubmissionSummaryTabProps {
  readonly summary: SubmissionSummary;
  readonly permissionKeys: readonly string[];
  readonly navigation: Dictionary['navigation'];
  readonly locale: 'en' | 'th';
}

function identityLink(href: string, label: string): React.JSX.Element {
  return (
    <Link href={href} className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full font-mono">
      {label}
    </Link>
  );
}

// Why the omission: a relation the reader may not read is null in the summary,
// and a link to a record that would 404 tells them the row exists.
function relationLinks(summary: SubmissionSummary, locale: 'en' | 'th'): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {summary.user && identityLink(buildRoute(locale, 'people.user-record', { id: summary.user.id }), summary.user.username)}
      {summary.task && identityLink(buildRoute(locale, 'tasks.record', { id: summary.task.id }), summary.task.name)}
      {summary.contest && identityLink(buildRoute(locale, 'contests.record', { id: summary.contest.id }), summary.contest.name)}
    </div>
  );
}

// Why the descriptor check: the outcome tabs need their own reader keys, and a
// link to a tab the caller cannot open would lead straight to the concealed view.
function reachableTabHref(
  routeId: RouteId,
  locale: 'en' | 'th',
  submissionId: number,
  permissionKeys: readonly string[],
): string | null {
  const descriptor = ROUTE_REGISTRY.find((route) => route.id === routeId);
  if (!descriptor?.enabled || !isRoutePermitted(descriptor, new Set(permissionKeys))) return null;
  return buildRoute(locale, routeId, { id: submissionId });
}

// Why the link: the outcome columns need reader keys this route does not grant,
// so the state is only reachable on the tab that owns it — and only when that
// tab is reachable for this caller.
function OutcomeCard({ title, href }: { readonly title: string; readonly href: string | null }): React.JSX.Element {
  return (
    <div className="bg-muted/40 rounded-xl p-4 border border-border">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{title}</h3>
      <div className="flex items-center gap-2">
        {href ? (
          <>
            <Loader2 className="text-info w-5 h-5 animate-spin shrink-0" />
            <Link className="font-medium" href={href}>
              Open {title.toLowerCase()}
            </Link>
          </>
        ) : (
          <>
            <AlertCircle className="text-muted-foreground w-5 h-5 shrink-0" />
            <span className="text-sm text-muted-foreground font-medium">{title} not readable</span>
          </>
        )}
      </div>
    </div>
  );
}

export function SubmissionSummaryTab({ summary, permissionKeys, navigation, locale }: SubmissionSummaryTabProps): React.JSX.Element {
  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <div className="text-muted-foreground text-sm flex flex-wrap gap-4">
          <span>Time: {new Date(summary.timestamp).toLocaleString()}</span>
          <span>Language: <span className="font-medium text-foreground">{summary.language ?? '—'}</span></span>
          <span>Official: <span className="font-medium text-foreground">{summary.official ? 'Yes' : 'No'}</span></span>
        </div>
        {relationLinks(summary, locale)}
        <div className="text-sm">
          <span className="text-muted-foreground">Comment: </span>
          <span className="text-foreground">{summary.comment || '—'}</span>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <OutcomeCard
          title="Compilation"
          href={reachableTabHref('evaluation.submission-tabs.results', locale, summary.id, permissionKeys)}
        />
        <OutcomeCard
          title="Evaluation"
          href={reachableTabHref('evaluation.submission-tabs.evaluation', locale, summary.id, permissionKeys)}
        />
        <div className="bg-muted/40 rounded-xl p-4 border border-border">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Detailed Status</h3>
          <span className="font-medium flex items-center gap-2">
            <AlertCircle className="text-muted-foreground w-5 h-5" />
            {`${navigation.evaluation['submission-record'].label} #${summary.id}`}
          </span>
        </div>
      </div>

      <SubmissionActionBar
        submissionId={summary.id}
        capabilities={summary.capabilities}
        comment={summary.comment}
        official={summary.official}
        entries={['recompute', 'download', 'comment', 'official']}
        navigation={navigation}
      />
    </div>
  );
}
