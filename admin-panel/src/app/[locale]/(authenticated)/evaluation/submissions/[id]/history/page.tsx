import { notFound } from 'next/navigation';
import { getSubmissionHistory } from '@/app/actions/audit';
import { DetailPage } from '@/components/patterns/DetailPage';
import { SubmissionArrival } from '@/components/submissions/SubmissionArrival';
import { SubmissionHistoryTab } from '@/components/submissions/SubmissionHistoryTab';
import { getDictionary } from '@/i18n';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteId } from '@/lib/navigation/types';
import { parseRecordId } from '@/lib/queries/record-access';
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

export default async function SubmissionHistoryPage({ params }: { params: Promise<{ locale: string; id: string }> }): Promise<React.JSX.Element> {
  const { locale, id: rawId } = await params;
  const id = parseRecordId(rawId);
  if (id === null) notFound();
  await authorizeSubmissionTab('evaluation.submission-tabs.history');
  const dictionary = await getDictionary(locale);
  const history = await getSubmissionHistory(id);
  const copy = dictionary.submissions.record;
  // The read returns one page of entries, so a total would claim rows it never asked for.
  const latest = history.success ? history.data[0] : undefined;
  return (
    <DetailPage
      ownsHeader={false}
      facts={[
        { term: copy.history.actor, value: latest?.actor_name ?? dictionary.common.notSet },
        { term: copy.history.action, value: latest?.verb ?? dictionary.common.notSet },
      ]}
      freshness={latest === undefined ? undefined : <SubmissionArrival timestamp={latest.timestamp} />}
    >
      <SubmissionHistoryTab history={history} />
    </DetailPage>
  );
}
