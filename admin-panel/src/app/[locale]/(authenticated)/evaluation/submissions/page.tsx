import { notFound } from 'next/navigation';
import { PageSurface } from '@/components/core/PageSurface';
import { SubmissionList } from '@/components/submissions/SubmissionList';
import { getDictionary } from '@/i18n';
import type { Dictionary } from '@/lib/dictionary';
import { listBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteDescriptor, RouteId } from '@/lib/navigation/types';
import { getSubmissions } from '@/lib/people-read-models';
import type { SubmissionsPageResult } from '@/lib/people-read-model-types';
import { readListSort, type ListSortInput } from '@/lib/list-sorting';
import { hasEffectivePermission } from '@/lib/permission-engine';

/** The contest/task/user narrowing the list query already supports. */
export interface SubmissionFilters {
  readonly contestId?: number;
  readonly taskId?: number;
  readonly userId?: number;
}

/**
 * Every key the bulk requeue gates on, mirrored from `recalculateSubmissions`.
 *
 * WHY it is declared here rather than imported: importing the action module into this
 * server page would pull its whole dependency graph in for one constant, and the action
 * remains the authority — it re-checks each key on every call. This list only decides
 * whether the control is rendered.
 */
const BATCH_RECALC_KEYS = [
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
 * The filters the list accepts, read from the URL.
 *
 * WHY these exist: `getSubmissions` has always taken `contestId`, `taskId` and `userId`,
 * but this page only ever parsed `page`, `sort` and `dir`, so the capability was
 * unreachable from the UI. Reading them here is the whole of S1 — the query already
 * knows how to apply them.
 *
 * WHY a non-numeric value is dropped rather than defaulting to 0: contest id 0 matches
 * nothing, so a typo would silently show an empty list that looks like "no submissions"
 * instead of a bad filter.
 */
function readSubmissionFilters(query: {
  contest?: string;
  task?: string;
  user?: string;
}): SubmissionFilters {
  return {
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
  searchParams: Promise<{ page?: string; sort?: string; dir?: string; contest?: string; task?: string; user?: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  const submissionsLabel = labelForDescriptor(dict, evaluationRouteDescriptor('evaluation.submissions'));
  const { page, sort: sortParam, dir, contest, task, user } = await searchParams;
  const currentPage = Number(page) || 1;
  const sort = readListSort({ sort: sortParam, dir });
  const filters = readSubmissionFilters({ contest, task, user });
  const result = await loadSubmissionsListPage(currentPage, sort, filters);
  // Why the gate is resolved here and passed down: the batch action re-checks every key
  // server-side, so this only decides whether the control is worth showing. Resolving it
  // from the same four keys keeps the control and the action in agreement.
  const canBatchRecompute = BATCH_RECALC_KEYS.every((key) =>
    hasEffectivePermission(result.effectivePermissions, key),
  );
  return (
    <PageSurface
      breadcrumbs={listBreadcrumbs(locale, 'evaluation', 'evaluation.submissions', dict)}
      title={submissionsLabel}
      description={dict.submissions.subtitle}
    >
      <SubmissionList
        initialSubmissions={result.submissions}
        totalPages={result.totalPages}
        currentPage={currentPage}
        navigation={dict.navigation}
        initialSort={sort}
        filters={filters}
        canBatchRecompute={canBatchRecompute}
      />
    </PageSurface>
  );
}
