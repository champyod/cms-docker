import type { ReactNode } from 'react';

import { SurfaceHeader } from '@/components/core/SurfaceHeader';
import { SurfaceState, type SurfaceStatus } from '@/components/core/SurfaceState';
import { SurfaceTabs } from '@/components/core/SurfaceTabs';
import type { BreadcrumbItem, RouteTab } from '@/lib/navigation/types';
import { cn } from '@/lib/utils';

export interface DetailSurfaceProps {
  readonly breadcrumbs: readonly BreadcrumbItem[];
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly status?: SurfaceStatus;
  readonly tabs: readonly RouteTab[];
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}

export function DetailSurface({
  breadcrumbs,
  title,
  description,
  status,
  tabs,
  actions,
  children,
  className,
}: DetailSurfaceProps): React.JSX.Element {
  const hasBlockingStatus = status !== undefined && status.kind !== 'idle';
  return (
    <section
      data-surface="detail"
      className={cn(
        'mx-auto w-full max-w-7xl space-y-6 pb-[env(safe-area-inset-bottom)] md:pb-0',
        className,
      )}
    >
      <SurfaceHeader
        breadcrumbs={breadcrumbs}
        title={title}
        description={description}
        actions={actions}
        status={<SurfaceState status={status} />}
      />
      <SurfaceTabs tabs={tabs} />
      {!hasBlockingStatus && <div className="min-w-0">{children}</div>}
    </section>
  );
}
