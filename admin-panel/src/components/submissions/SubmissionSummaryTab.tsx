'use client';

import Link from 'next/link';
import { AlertCircle, ArrowRight } from 'lucide-react';

import { Card } from '@/components/core/Card';
import { useFormatTimestamp } from '@/components/layout/TimezoneProvider';
import { useDictionary } from '@/hooks/useDictionary';
import type { SubmissionPreviousModel, SubmissionSourceModel, SubmissionSummary } from '@/lib/evaluation-read-model-types';
import { interpolate } from '@/lib/interpolate';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { buildRoute } from '@/lib/navigation/routes';
import type { RouteId } from '@/lib/navigation/types';

import { SubmissionCompareView } from './SubmissionCompareView';
import { SubmissionSourceViewer } from './SubmissionSourceViewer';

export interface SubmissionSummaryTabProps {
  readonly summary: SubmissionSummary;
  /** Null when the submission stores no file. */
  readonly source: SubmissionSourceModel | null;
  /** Null when no earlier submission shares this participation and task. */
  readonly previous?: SubmissionPreviousModel | null;
  readonly permissionKeys: readonly string[];
  readonly locale: 'en' | 'th';
}

function SummaryIdentity({ summary }: { readonly summary: SubmissionSummary }): React.JSX.Element {
  // Why: a submission belongs to no contest context on this route, so its instant reads in the
  // reviewer's own zone.
  const formatTimestamp = useFormatTimestamp();
  const record = useDictionary().submissions.record;
  return (
    <Card className="space-y-4">
      <div className="text-muted-foreground text-sm flex flex-wrap gap-4">
        <span>{record.identity.time}: {formatTimestamp(summary.timestamp)}</span>
        <span>{record.identity.language}: <span className="font-medium text-foreground">{summary.language ?? '—'}</span></span>
      </div>
      <div className="text-sm">
        <span className="text-muted-foreground">{record.comment.label}: </span>
        <span className="text-foreground">{summary.comment || '—'}</span>
      </div>
    </Card>
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

// Why a link and not a status: the outcome columns need reader keys this route
// does not grant, so this card offers the tab that owns the state and shows no
// state of its own. The icon is a navigation affordance, never a spinner.
function OutcomeCard({ title, href }: { readonly title: string; readonly href: string | null }): React.JSX.Element {
  const copy = useDictionary().submissions.record.outcome;
  return (
    <div className="bg-muted/40 rounded-xl p-4 border border-border">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{title}</h3>
      {href ? (
        <Link className="font-medium inline-flex items-center gap-2" href={href}>
          {interpolate(copy.open, { title })}
          <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </Link>
      ) : (
        <span className="text-sm text-muted-foreground font-medium inline-flex items-center gap-2">
          <AlertCircle className="w-5 h-5" aria-hidden="true" />
          {interpolate(copy.unreadable, { title })}
        </span>
      )}
    </div>
  );
}

export function SubmissionSummaryTab({ summary, source, previous, permissionKeys, locale }: SubmissionSummaryTabProps): React.JSX.Element {
  const outcome = useDictionary().submissions.record.outcome;
  return (
    <div className="space-y-6">
      <SummaryIdentity summary={summary} />
      <SubmissionSourceViewer source={source} />
      {previous ? (
        <section id="submission-compare" className="scroll-mt-24">
          <SubmissionCompareView current={source} previous={previous} />
        </section>
      ) : null}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <OutcomeCard
          title={outcome.compilation}
          href={reachableTabHref('evaluation.submission-tabs.results', locale, summary.id, permissionKeys)}
        />
        <OutcomeCard
          title={outcome.evaluation}
          href={reachableTabHref('evaluation.submission-tabs.evaluation', locale, summary.id, permissionKeys)}
        />
      </div>
    </div>
  );
}
