import { notFound } from 'next/navigation';
import { DetailPage } from '@/components/patterns/DetailPage';
import { SubmissionResultsTab } from '@/components/submissions/SubmissionResultsTab';
import { getDictionary } from '@/i18n';
import { getSubmissionResults } from '@/lib/evaluation-read-models';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteId } from '@/lib/navigation/types';
import { parseRecordId, readRecordOrNotFound } from '@/lib/queries/record-access';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';
import { formatCount } from '@/lib/format-number';

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
  const model = await readRecordOrNotFound(() => getSubmissionResults(id));
  const copy = dictionary.submissions.record;
  // Why failed compilations and not failed evaluations: a dataset whose compilation failed was
  // never evaluated, so counting both would report the same dataset twice.
  const compilationsFailed = model.results.filter((result) => result.compilationOutcome === 'fail').length;
  return (
    <DetailPage
      // The record shell above renders the submission's name, its trail, its status and its tabs.
      // This tab adds the two totals the shell cannot derive, then the per-dataset cards.
      ownsHeader={false}
      facts={[
        { term: copy.results.datasets, value: formatCount(model.results.length, locale) },
        { term: copy.results.compilationsFailed, value: formatCount(compilationsFailed, locale) },
      ]}
    >
      <SubmissionResultsTab model={model} />
    </DetailPage>
  );
}
