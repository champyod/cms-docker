import { notFound } from 'next/navigation';
import { SubmissionSummaryTab } from '@/components/submissions/SubmissionSummaryTab';
import { getDictionary } from '@/i18n';
import { getSubmissionSummary } from '@/lib/evaluation-read-models';
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
  const dictionary = await getDictionary(locale);
  // Why the keys reach the tab: the summary renders links to the outcome tabs, so
  // it must know which of them this caller may open.
  const effective = await authorizeSubmissionTab('evaluation.submission-tabs.summary');
  const summary = await readRecordOrNotFound(() => getSubmissionSummary(id));
  return (
    <SubmissionSummaryTab
      summary={summary}
      permissionKeys={[...effective]}
      navigation={dictionary.navigation}
      locale={locale as 'en' | 'th'}
    />
  );
}
