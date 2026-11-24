import { notFound } from 'next/navigation';
import { DetailPage } from '@/components/patterns/DetailPage';
import { SubmissionArrival } from '@/components/submissions/SubmissionArrival';
import { SubmissionSummaryTab } from '@/components/submissions/SubmissionSummaryTab';
import { getDictionary } from '@/i18n';
import { getPreviousSubmission, getSubmissionSource, getSubmissionSummary } from '@/lib/evaluation-read-models';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteId } from '@/lib/navigation/types';
import { parseRecordId, readRecordOrNotFound } from '@/lib/queries/record-access';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';

async function authorizeSubmissionTab(routeId: RouteId): Promise<ReadonlySet<string>> {
  const route = ROUTE_REGISTRY.find((candidate) => candidate.id === routeId);
  if (!route || !route.enabled) notFound();
  try {
    let effective: ReadonlySet<string> = new Set<string>();
    for (const key of route.permission.all ?? []) effective = await requirePermission(key);
    if (!isRoutePermitted(route, effective)) notFound();
    return effective;
  } catch (error: unknown) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }
}

export default async function SubmissionSummaryPage({ params }: { params: Promise<{ locale: string; id: string }> }): Promise<React.JSX.Element> {
  const { locale, id: rawId } = await params;
  const id = parseRecordId(rawId);
  if (id === null) notFound();
  // The summary renders links to the outcome tabs, so it must know which of them this caller may open.
  const effective = await authorizeSubmissionTab('evaluation.submission-tabs.summary');
  const dictionary = await getDictionary(locale);
  // A null source is a valid record, so it renders an empty viewer rather than a 404.
  const [summary, source, previous] = await Promise.all([
    readRecordOrNotFound(() => getSubmissionSummary(id)),
    getSubmissionSource(id),
    getPreviousSubmission(id),
  ]);
  const copy = dictionary.submissions.record;
  return (
    <DetailPage
      ownsHeader={false}
      facts={[
        { term: copy.identity.language, value: summary.language ?? dictionary.common.notSet },
        { term: copy.comment.label, value: summary.comment === '' ? dictionary.common.notSet : summary.comment },
      ]}
      freshness={<SubmissionArrival timestamp={summary.timestamp} />}
    >
      <SubmissionSummaryTab
        summary={summary}
        source={source}
        previous={previous}
        permissionKeys={[...effective]}
        locale={locale as 'en' | 'th'}
      />
    </DetailPage>
  );
}
