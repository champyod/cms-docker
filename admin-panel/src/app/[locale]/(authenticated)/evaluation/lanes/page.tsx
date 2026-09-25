import { notFound } from 'next/navigation';
import { getLaneBoard, type LaneBoard as LaneBoardData } from '@/app/actions/evaluationLanes';
import { PageSurface } from '@/components/core/PageSurface';
import { LaneBoard } from '@/components/submissions/LaneBoard';
import { getDictionary } from '@/i18n';
import type { Dictionary } from '@/lib/dictionary';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { buildRoute } from '@/lib/navigation/routes';
import type { RouteDescriptor, RouteId } from '@/lib/navigation/types';
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

// Why: the board is built from lane audit rows behind evaluation:list, and a
// caller without that key sees the concealed 404 surface instead.
async function loadLanesPage(): Promise<{ board: LaneBoardData; permissionKeys: string[] }> {
  try {
    const effective = await requirePermission('evaluation:list');
    return { board: await getLaneBoard(), permissionKeys: [...effective] };
  } catch (error: unknown) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }
}

export default async function EvaluationLanesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  const lanesLabel = labelForDescriptor(dict, evaluationRouteDescriptor('evaluation.lanes'));
  const { board, permissionKeys } = await loadLanesPage();
  return (
    <PageSurface
      breadcrumbs={[{ label: lanesLabel, href: buildRoute(locale, 'evaluation.lanes') }]}
      title={lanesLabel}
      description="Drag submissions between lanes or move them with a reason."
    >
      <LaneBoard board={board} permissionKeys={permissionKeys} />
    </PageSurface>
  );
}
