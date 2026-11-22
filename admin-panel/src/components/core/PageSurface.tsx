import type { ReactNode } from 'react';

import { SurfaceHeader } from '@/components/core/SurfaceHeader';
import { SurfaceState, type SurfaceStatus } from '@/components/core/SurfaceState';
import type { BreadcrumbItem } from '@/lib/navigation/types';
import { cn } from '@/lib/utils';

export interface PageSurfaceProps {
  readonly breadcrumbs?: readonly BreadcrumbItem[];
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly status?: SurfaceStatus;
  readonly children: ReactNode;
  readonly className?: string;
  /**
   * False when a module shell above this page already renders the title, the description and the
   * trail. Two headers over one page is the defect this flag prevents: the reader meets the same
   * title twice, and the second one scrolls away first.
   */
  readonly ownsHeader?: boolean;
}

export function PageSurface({
  breadcrumbs = [],
  title,
  description,
  actions,
  status,
  children,
  className,
  ownsHeader = true,
}: PageSurfaceProps): React.JSX.Element {
  const hasBlockingStatus = status !== undefined && status.kind !== 'idle';
  return (
    <section
      data-surface="page"
      data-surface-owns-header={ownsHeader ? 'own' : 'shell'}
      className={cn(
        'mx-auto w-full max-w-7xl space-y-6 pb-[env(safe-area-inset-bottom)] md:pb-0',
        className,
      )}
    >
      {ownsHeader && (
        <SurfaceHeader
          breadcrumbs={breadcrumbs}
          title={title}
          description={description}
          actions={actions}
          status={<SurfaceState status={status} />}
        />
      )}
      {!hasBlockingStatus && <div className="min-w-0">{children}</div>}
    </section>
  );
}
