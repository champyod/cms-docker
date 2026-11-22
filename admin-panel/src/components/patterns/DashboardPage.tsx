import type { ReactNode } from 'react';

import { PageSurface } from '@/components/core/PageSurface';
import type { PageSlots } from '@/components/patterns/types';

/**
 * The dashboard layout. Its job is to keep the system's state above every count, so `state` is
 * required here even though it is optional on a list: a dashboard that leads with numbers has
 * stopped being a dashboard.
 */
export interface DashboardPageProps extends PageSlots {
  /** The system's state, above every metric. */
  readonly state: ReactNode;
  /** False when a module shell above already renders the page identity. */
  readonly identity?: boolean;
}

export function DashboardPage({
  breadcrumbs,
  title,
  description,
  actions,
  state,
  children,
  identity = true,
}: DashboardPageProps): React.JSX.Element {
  return (
    <PageSurface breadcrumbs={breadcrumbs} title={title} description={description} actions={actions} identity={identity}>
      <div className="space-y-4">
        {state}
        {children}
      </div>
    </PageSurface>
  );
}
