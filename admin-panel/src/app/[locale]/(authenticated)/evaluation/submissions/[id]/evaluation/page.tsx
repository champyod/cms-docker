import { notFound } from 'next/navigation';
import { SubmissionEvaluationTab } from '@/components/submissions/SubmissionEvaluationTab';
import { getDictionary } from '@/i18n';
import { getSubmissionEvaluation, getSubmissionSummary } from '@/lib/evaluation-read-models';
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

export default async function SubmissionEvaluationPage({ params }: { params: Promise<{ locale: string; id: string }> }): Promise<React.JSX.Element> {
  const { locale, id: rawId } = await params;
  const id = parseRecordId(rawId);
  if (id === null) notFound();
  await authorizeSubmissionTab('evaluation.submission-tabs.evaluation');
  const dictionary = await getDictionary(locale);
  // Why the summary read here: it carries the record capabilities that gate the
  // lane move entry point, and its submission:read key is already part of this
  // route's own reader set.
  const [model, summary] = await Promise.all([
    readRecordOrNotFound(() => getSubmissionEvaluation(id)),
    readRecordOrNotFound(() => getSubmissionSummary(id)),
  ]);
  return (
    <SubmissionEvaluationTab
      model={model}
      capabilities={summary.capabilities}
      navigation={dictionary.navigation}
    />
  );
}
