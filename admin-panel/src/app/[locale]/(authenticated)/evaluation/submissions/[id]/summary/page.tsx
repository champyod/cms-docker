import { notFound } from 'next/navigation';
import { SubmissionSummaryTab } from '@/components/submissions/SubmissionSummaryTab';
import { getDictionary } from '@/i18n';
import { getSubmissionSource, getSubmissionSummary } from '@/lib/evaluation-read-models';
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
  // Why the keys reach the tab: the summary renders links to the outcome tabs, so
  // it must know which of them this caller may open.
  const effective = await authorizeSubmissionTab('evaluation.submission-tabs.summary');
  const dictionary = await getDictionary(locale);
  // Why the source read is not wrapped in readRecordOrNotFound: storing no file is
  // a valid record, so a null source renders as an empty viewer rather than a 404.
  const [summary, source] = await Promise.all([
    readRecordOrNotFound(() => getSubmissionSummary(id)),
    getSubmissionSource(id),
  ]);
  return (
    <SubmissionSummaryTab
      summary={summary}
      source={source}
      permissionKeys={[...effective]}
      navigation={dictionary.navigation}
      locale={locale as 'en' | 'th'}
    />
  );
}
