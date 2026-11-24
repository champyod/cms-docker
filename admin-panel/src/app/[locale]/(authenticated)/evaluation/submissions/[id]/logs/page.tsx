import { notFound } from 'next/navigation';
import { DetailPage } from '@/components/patterns/DetailPage';
import { SubmissionLogsTab } from '@/components/submissions/SubmissionLogsTab';
import { getDictionary } from '@/i18n';
import { getSubmissionLogs } from '@/lib/evaluation-read-models';
import { formatCount } from '@/lib/format-number';
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

/** How much output the reader is about to scroll, across all three streams. */
function logLineCount(model: { compilationText: readonly string[]; compilationStdout: string | null; compilationStderr: string | null }): number {
  return [
    model.compilationText.join('\n'),
    model.compilationStdout ?? '',
    model.compilationStderr ?? '',
  ]
    .join('\n')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .length;
}

export default async function SubmissionLogsPage({ params }: { params: Promise<{ locale: string; id: string }> }): Promise<React.JSX.Element> {
  const { locale, id: rawId } = await params;
  const id = parseRecordId(rawId);
  if (id === null) notFound();
  await authorizeSubmissionTab('evaluation.submission-tabs.logs');
  const [model, dictionary] = await Promise.all([
    readRecordOrNotFound(() => getSubmissionLogs(id)),
    getDictionary(locale),
  ]);
  const copy = dictionary.submissions.record;
  return (
    <DetailPage
      ownsHeader={false}
      facts={[
        { term: copy.outcome.compilation, value: model.compilationOutcome ?? copy.results.pending },
        { term: copy.logs.lines, value: formatCount(logLineCount(model), locale) },
      ]}
    >
      <SubmissionLogsTab model={model} />
    </DetailPage>
  );
}
