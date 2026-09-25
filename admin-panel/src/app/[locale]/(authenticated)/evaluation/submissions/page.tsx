import { notFound } from 'next/navigation';
import { PageSurface } from '@/components/core/PageSurface';
import { SubmissionList } from '@/components/submissions/SubmissionList';
import { getDictionary } from '@/i18n';
import type { Dictionary } from '@/lib/dictionary';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { buildRoute } from '@/lib/navigation/routes';
import type { RouteDescriptor, RouteId } from '@/lib/navigation/types';
import { getSubmissions } from '@/lib/people-read-models';
import type { SubmissionsPageResult } from '@/lib/people-read-model-types';
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
async function loadSubmissionsListPage(page: number): Promise<SubmissionsPageResult> {
  try {
    await requirePermission('submission:list');
    return await getSubmissions({ page });
  } catch (error: unknown) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }
}

export default async function EvaluationSubmissionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  const submissionsLabel = labelForDescriptor(dict, evaluationRouteDescriptor('evaluation.submissions'));
  const { page } = await searchParams;
  const currentPage = Number(page) || 1;
  const result = await loadSubmissionsListPage(currentPage);
  return (
    <PageSurface
      breadcrumbs={[{ label: submissionsLabel, href: buildRoute(locale, 'evaluation.submissions') }]}
      title={submissionsLabel}
      description={dict.submissions.subtitle}
    >
      <SubmissionList
        initialSubmissions={result.submissions}
        totalPages={result.totalPages}
        currentPage={currentPage}
        navigation={dict.navigation}
      />
    </PageSurface>
  );
}
