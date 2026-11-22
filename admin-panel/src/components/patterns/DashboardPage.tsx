import type { ReactNode } from 'react';

import { PageSurface } from '@/components/core/PageSurface';
import type { PageSlots } from '@/components/patterns/types';

/**
 * The dashboard archetype. Its whole job is to guarantee that the page opens with the state of
 * the system before any count (topic 8d), so `state` is not optional here even though the same
 * slot is optional on a list: a dashboard that leads with numbers has stopped being a dashboard.
 */
export interface DashboardPageProps extends PageSlots {
  /** The system's state, rendered above every metric. */
  readonly state: ReactNode;
}

export function DashboardPage({
  breadcrumbs,
  title,
  description,
  actions,
  state,
  children,
}: DashboardPageProps): React.JSX.Element {
  return (
    <PageSurface breadcrumbs={breadcrumbs} title={title} description={description} actions={actions}>
      <div className="space-y-4">
        {state}
        {children}
      </div>
    </PageSurface>
  );
}
