import type { ReactNode } from 'react';

import { PageSurface } from '@/components/core/PageSurface';
import { StatCard, type StatCardProps } from '@/components/core/StatCard';
import type { PageSlots } from '@/components/patterns/page-types';

/**
 * The dashboard layout. Its job is to keep the system's state above every count, so `state` is
 * required here even though it is optional on a list: a dashboard that leads with numbers has
 * stopped being a dashboard.
 */
export interface DashboardPageProps extends PageSlots {
  /** The system's state, above every metric. */
  readonly state: ReactNode;
  /**
   * The headline numbers. Structured rather than free markup: a page that draws its own grid picks
   * its own column count and card padding, and then two dashboards disagree about what a metric is.
   */
  readonly totals?: readonly StatCardProps[];
  /** False when a module shell above already renders the page header. */
  readonly ownsHeader?: boolean;
}

export function DashboardPage({
  breadcrumbs,
  title,
  description,
  actions,
  state,
  totals,
  children,
  ownsHeader = true,
}: DashboardPageProps): React.JSX.Element {
  return (
    <PageSurface breadcrumbs={breadcrumbs} title={title} description={description} actions={actions} ownsHeader={ownsHeader}>
      <div className="space-y-4">
        {state}
        {totals && totals.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {totals.map((total) => (
              <StatCard key={total.label} {...total} />
            ))}
          </div>
        )}
        {children}
      </div>
    </PageSurface>
  );
}
