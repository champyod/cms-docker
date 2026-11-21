import { notFound } from 'next/navigation';
import { PageSurface } from '@/components/core/PageSurface';
import { SubmissionList } from '@/components/submissions/SubmissionList';
import type { SubmissionFilters } from '@/components/submissions/SubmissionList';
import { getDictionary } from '@/i18n';
import type { Dictionary } from '@/lib/dictionary';
import { LiveRefresh } from '@/lib/live/live-refresh';
import { listBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteDescriptor, RouteId } from '@/lib/navigation/types';
import { getSubmissions } from '@/lib/people-read-models';
import type { SubmissionsPageResult } from '@/lib/people-read-model-types';
import { readListSort, type ListSortInput } from '@/lib/list-sorting';
import { hasEffectivePermission } from '@/lib/permission-engine';

/**
 * Every key the requeue paths gate on, mirrored from `recalculateSubmission` and
 * `recalculateSubmissions`, which share one gate.
 *
 * WHY it is declared here rather than imported: importing the action module into this
 * server page would pull its whole dependency graph in for one constant, and the actions
 * remain the authority — they re-check each key on every call. This list only decides
 * whether the controls are rendered.
 */
const RECALC_GATE_KEYS = [
  'submission:recompute',
  'submission:rejudge',
  'evaluation:delete',
  'submissionresult:delete',
] as const;
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';

function labelForDescriptor(dictionary: Dictionary, descriptor: RouteDescriptor): string {
  const label = descriptor.labelKey.split('.').reduce<unknown>((value, segment) => {
    if (typeof value !== 'object' || value === null) return undefined;
    return Reflect.get(value, segment);
  }, dictionary);
  if (typeof label !== 'string' || label.trim() === '') {
    throw new Error(`Missing navigation label: ${descriptor.labelKey}`);
  }
  return label;
}

// Why: a descriptor that is missing or still disabled has no proven physical
// route, so the page conceals itself instead of rendering an orphaned surface.
function evaluationRouteDescriptor(routeId: RouteId): RouteDescriptor {
  const descriptor = ROUTE_REGISTRY.find((route) => route.id === routeId);
  if (!descriptor?.enabled) notFound();
  return descriptor;
}

// Why: a caller without submission:list sees the concealed 404 surface, while a
// 401 or an unexpected failure keeps propagating to the session and error paths.
async function loadSubmissionsListPage(
  page: number,
  sort: ListSortInput,
  filters: SubmissionFilters,
): Promise<SubmissionsPageResult> {
  try {
    await requirePermission('submission:list');
    return await getSubmissions({ page, sort, ...filters });
  } catch (error: unknown) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }
}

/**
 * The narrowing the list accepts, read from the URL.
 *
 * WHY a non-numeric id is dropped rather than defaulting to 0: contest id 0 matches
 * nothing, so a typo would silently show an empty list that looks like "no submissions"
 * instead of a bad filter. The free-text search is kept as typed.
 */
function readSubmissionFilters(query: {
  contest?: string;
  task?: string;
  user?: string;
  search?: string;
}): SubmissionFilters {
  const search = query.search?.trim() ?? '';
  return {
    ...(search === '' ? {} : { search }),
    ...(readPositiveInt(query.contest) === undefined ? {} : { contestId: readPositiveInt(query.contest) }),
    ...(readPositiveInt(query.task) === undefined ? {} : { taskId: readPositiveInt(query.task) }),
    ...(readPositiveInt(query.user) === undefined ? {} : { userId: readPositiveInt(query.user) }),
  };
}

function readPositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

export default async function EvaluationSubmissionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; sort?: string; dir?: string; contest?: string; task?: string; user?: string; search?: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  const submissionsLabel = labelForDescriptor(dict, evaluationRouteDescriptor('evaluation.submissions'));
  const { page, sort: sortParam, dir, contest, task, user, search } = await searchParams;
  const currentPage = Number(page) || 1;
  const sort = readListSort({ sort: sortParam, dir });
  const filters = readSubmissionFilters({ contest, task, user, search });
  const result = await loadSubmissionsListPage(currentPage, sort, filters);
  // Why the gates are resolved here and passed down: the actions re-check every key
  // server-side, so this only decides whether the controls are worth showing. Resolving
  // them from the same keys keeps each control and its action in agreement.
  const canRecalculate = RECALC_GATE_KEYS.every((key) =>
    hasEffectivePermission(result.effectivePermissions, key),
  );
  // Why the same key: the official flag and the comment field are both governed by
  // `submission:update`, so one resolved value gates both controls.
  const canOfficial = hasEffectivePermission(result.effectivePermissions, 'submission:update');
  const canComment = canOfficial;
  return (
    <PageSurface
      breadcrumbs={listBreadcrumbs(locale, 'evaluation', 'evaluation.submissions', dict)}
      title={submissionsLabel}
      description={dict.submissions.subtitle}
      actions={<LiveRefresh url="/api/submissions/stream" />}
    >
      <SubmissionList
        initialSubmissions={result.submissions}
        totalPages={result.totalPages}
        currentPage={currentPage}
        navigation={dict.navigation}
        initialSort={sort}
        filters={filters}
        canRecalculate={canRecalculate}
        canOfficial={canOfficial}
        canComment={canComment}
      />
    </PageSurface>
  );
}
