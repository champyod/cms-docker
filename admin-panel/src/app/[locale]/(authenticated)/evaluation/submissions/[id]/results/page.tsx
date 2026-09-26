import { notFound } from 'next/navigation';
import { SubmissionResultsTab } from '@/components/submissions/SubmissionResultsTab';
import { getDictionary } from '@/i18n';
import { getSubmissionResults, getSubmissionSummary } from '@/lib/evaluation-read-models';
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

export default async function SubmissionResultsPage({ params }: { params: Promise<{ locale: string; id: string }> }): Promise<React.JSX.Element> {
  const { locale, id: rawId } = await params;
  const id = parseRecordId(rawId);
  if (id === null) notFound();
  await authorizeSubmissionTab('evaluation.submission-tabs.results');
  const dictionary = await getDictionary(locale);
  // Why the summary read here: it carries the record capabilities that gate the
  // download entry point, and its submission:read key is already part of this
  // route's own reader set.
  const [model, summary] = await Promise.all([
    readRecordOrNotFound(() => getSubmissionResults(id)),
    readRecordOrNotFound(() => getSubmissionSummary(id)),
  ]);
  return (
    <SubmissionResultsTab
      model={model}
      capabilities={summary.capabilities}
      navigation={dictionary.navigation}
    />
  );
}
