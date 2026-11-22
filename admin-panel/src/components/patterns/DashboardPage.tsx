import type { ReactNode } from 'react';

import { PageSurface } from '@/components/core/PageSurface';
import { StatGrid } from '@/components/core/StatGrid';
import type { StatCardProps } from '@/components/core/StatCard';
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
  /** Passed to the counts so they are grouped in the reader's language. */
  readonly locale?: string;
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
  locale,
  children,
  ownsHeader = true,
}: DashboardPageProps): React.JSX.Element {
  return (
    <PageSurface breadcrumbs={breadcrumbs} title={title} description={description} actions={actions} ownsHeader={ownsHeader}>
      <div className="space-y-4">
        {state}
        {totals && totals.length > 0 && <StatGrid totals={totals} locale={locale} />}
        {children}
      </div>
    </PageSurface>
  );
}
