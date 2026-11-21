import type { ReactNode } from 'react';

import { SurfaceHeader } from '@/components/core/SurfaceHeader';
import { SurfaceState, type SurfaceStatus } from '@/components/core/SurfaceState';
import type { BreadcrumbItem } from '@/lib/navigation/types';
import { cn } from '@/lib/utils';

export interface PageSurfaceProps {
  readonly breadcrumbs: readonly BreadcrumbItem[];
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly status?: SurfaceStatus;
  readonly children: ReactNode;
  readonly className?: string;
}

export function PageSurface({
  breadcrumbs,
  title,
  description,
  actions,
  status,
  children,
  className,
}: PageSurfaceProps): React.JSX.Element {
  const hasBlockingStatus = status !== undefined && status.kind !== 'idle';
  return (
    <section
      data-surface="page"
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
      {!hasBlockingStatus && <div className="min-w-0">{children}</div>}
    </section>
  );
}
