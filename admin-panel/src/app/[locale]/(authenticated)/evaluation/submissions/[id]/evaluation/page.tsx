import { notFound } from 'next/navigation';
import { DetailPage } from '@/components/patterns/DetailPage';
import { SubmissionEvaluationTab } from '@/components/submissions/SubmissionEvaluationTab';
import { getDictionary } from '@/i18n';
import { getSubmissionEvaluation } from '@/lib/evaluation-read-models';
import { formatCount } from '@/lib/format-number';
import type { SubmissionEvaluationModel } from '@/lib/evaluation-read-model-types';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteId } from '@/lib/navigation/types';
import { hasEffectivePermission } from '@/lib/permission-engine';
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

// Why a numeric outcome decides the count: the evaluation service writes a verdict as a score
// ("1.0", "0.0"), so only a readable zero is a failure. A null outcome is still running and a
// non-numeric manager verdict is not this page's to judge, and both are counted as neither.
function failedCount(model: SubmissionEvaluationModel): number {
  return model.evaluations.filter((row) => {
    if (row.outcome === null) return false;
    const score = Number(row.outcome);
    return Number.isFinite(score) && score <= 0;
  }).length;
}

export default async function SubmissionEvaluationPage({ params }: { params: Promise<{ locale: string; id: string }> }): Promise<React.JSX.Element> {
  const { locale, id: rawId } = await params;
  const id = parseRecordId(rawId);
  if (id === null) notFound();
  const effective = await authorizeSubmissionTab('evaluation.submission-tabs.evaluation');
  const dictionary = await getDictionary(locale);
  const model = await readRecordOrNotFound(() => getSubmissionEvaluation(id));
  const copy = dictionary.submissions.record;
  return (
    <DetailPage
      // The record shell above renders the submission's name, its trail, its status and its tabs.
      // This tab adds how the run went overall, then the per-testcase rows.
      ownsHeader={false}
      facts={[
        { term: copy.evaluation.testcases, value: formatCount(model.evaluations.length, locale) },
        { term: copy.evaluation.failed, value: formatCount(failedCount(model), locale) },
      ]}
    >
      <SubmissionEvaluationTab
        missing={dictionary.common.notSet}
        model={model}
        canReadTestcase={hasEffectivePermission(effective, 'testcase:read')}
      />
    </DetailPage>
  );
}
