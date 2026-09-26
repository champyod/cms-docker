import { notFound } from 'next/navigation';
import { DetailSurface } from '@/components/core/DetailSurface';
import { getDictionary } from '@/i18n';
import type { Dictionary } from '@/lib/dictionary';
import { getSubmissionSummary } from '@/lib/evaluation-read-models';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { NAVIGATION_GROUPS, ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { buildRoute } from '@/lib/navigation/routes';
import type { BreadcrumbItem, RouteDescriptor, RouteId, RouteTab } from '@/lib/navigation/types';
import { parseRecordId, readRecordOrNotFound } from '@/lib/queries/record-access';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';

function labelForKey(dictionary: Dictionary, key: string): string {
  const label = key.split('.').reduce<unknown>((value, segment) => {
    if (typeof value !== 'object' || value === null) return undefined;
    return Reflect.get(value, segment);
  }, dictionary);
  if (typeof label !== 'string' || label.trim() === '') {
    throw new Error(`Missing navigation label: ${key}`);
  }
  return label;
}

function labelForDescriptor(dictionary: Dictionary, descriptor: RouteDescriptor): string {
  return labelForKey(dictionary, descriptor.labelKey);
}

function findRoute(routeId: RouteId): RouteDescriptor {
  const route = ROUTE_REGISTRY.find((candidate) => candidate.id === routeId);
  if (!route) notFound();
  return route;
}

// Why: a tab the reader may not open is omitted entirely rather than rendered
// disabled, so the record rail never advertises a route that would 404.
export function buildSubmissionTabs(
  locale: string,
  submissionId: number,
  effective: ReadonlySet<string>,
  dictionary: Dictionary,
): readonly RouteTab[] {
  const record = findRoute('evaluation.submission-record');
  if (!record.enabled || !isRoutePermitted(record, effective)) notFound();
  return record.tabIds.flatMap((routeId: RouteId) => {
    const route = ROUTE_REGISTRY.find((candidate) => candidate.id === routeId);
    if (!route || !route.enabled || !isRoutePermitted(route, effective)) return [];
    return [{
      id: route.id,
      label: labelForDescriptor(dictionary, route),
      href: buildRoute(locale, route.id, { id: submissionId }),
    } satisfies RouteTab];
  });
}

// Why two crumbs: the group label owns the list URL and the record label owns
// the record URL, which is the shape the User and Team record layouts emit. A
// third crumb would have to repeat one of those two URLs.
function submissionRecordBreadcrumbs(
  locale: string,
  submissionId: number,
  dictionary: Dictionary,
): readonly BreadcrumbItem[] {
  const evaluationGroup = NAVIGATION_GROUPS.find((group) => group.id === 'evaluation');
  if (!evaluationGroup) notFound();
  return [
    { label: labelForKey(dictionary, evaluationGroup.labelKey), href: buildRoute(locale, 'evaluation.submissions') },
    { label: labelForDescriptor(dictionary, findRoute('evaluation.submission-record')), href: buildRoute(locale, 'evaluation.submission-record', { id: submissionId }) },
  ];
}

// Why: the summary read is what proves the record exists and that the caller may
// open it, so a missing row and a 403 both render as the concealed not-found
// view while a 401 or an unexpected failure keeps propagating.
async function loadSubmissionRecord(submissionId: number): Promise<ReadonlySet<string>> {
  let effective: ReadonlySet<string>;
  try {
    effective = await requirePermission('submission:read');
  } catch (error: unknown) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }
  await readRecordOrNotFound(() => getSubmissionSummary(submissionId));
  return effective;
}

export default async function SubmissionRecordLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string; id: string }>;
}): Promise<React.JSX.Element> {
  const { locale, id: rawId } = await params;
  const dictionary = await getDictionary(locale);
  const id = parseRecordId(rawId);
  if (id === null) notFound();
  const effective = await loadSubmissionRecord(id);
  return (
    <DetailSurface
      breadcrumbs={submissionRecordBreadcrumbs(locale, id, dictionary)}
      title={`Submission #${id}`}
      tabs={buildSubmissionTabs(locale, id, effective, dictionary)}
    >
      {children}
    </DetailSurface>
  );
}
