import type { ReactNode } from 'react';

import { Card } from '@/components/core/Card';
import { InlineAlert } from '@/components/core/InlineAlert';
import { PageSurface } from '@/components/core/PageSurface';
import { ROW_HEIGHT_CLASS } from '@/components/core/ResponsiveTable';
import { Skeleton } from '@/components/core/Skeleton';
import type { PageSlots } from '@/components/patterns/page-types';

export interface ListPageState {
  /** One of the four things a list can be: telling the operator something needs a decision. */
  tone: 'info' | 'warning' | 'destructive';
  title: string;
  detail?: ReactNode;
  action?: ReactNode;
}

export interface ListPageProps extends PageSlots {
  /** Above the toolbar and before any row: what is wrong is read before what is listed. */
  readonly state?: ListPageState;
  /** The rows. The page supplies a table; the archetype owns where it sits and what frames it. */
  readonly children: ReactNode;
  readonly toolbar?: ReactNode;
  readonly footer?: ReactNode;
  /** Shown instead of the rows when there is nothing: never an empty table with headers. */
  readonly empty?: ReactNode;
  /** Skeleton of the real shape, not a spinner over a blank card. */
  readonly loading?: boolean;
  /** False when a module shell above already renders the page header. */
  readonly ownsHeader?: boolean;
}

/**
 * The list layout: state, then controls, then rows, then paging. Every list reads in that order,
 * so moving between Contests, Tasks and Users does not re-learn where things are. Loading shows a
 * skeleton of rows rather than a spinner, so the layout does not jump when the data lands.
 */
export function ListPage({
  breadcrumbs,
  title,
  description,
  actions,
  state,
  toolbar,
  children,
  footer,
  empty,
  loading = false,
  ownsHeader = true,
}: ListPageProps): React.JSX.Element {
  return (
    <PageSurface breadcrumbs={breadcrumbs} title={title} description={description} actions={actions} ownsHeader={ownsHeader}>
      <div className="space-y-4">
        {state && (
          <InlineAlert
            tone={state.tone}
            title={state.title}
            actions={state.action}
            announce="polite"
          >
            {state.detail}
          </InlineAlert>
        )}
        {toolbar && <div className="flex flex-wrap items-center gap-2">{toolbar}</div>}
        <Card className="p-0">
          {loading ? <RowSkeleton /> : empty ? <div className="p-4">{empty}</div> : children}
        </Card>
        {footer}
      </div>
    </PageSurface>
  );
}

/**
 * Rows at the height the real ones use, taken from the one constant, so the skeleton answers to the
 * density mode too. Six of them show the shape of a table; they do not promise the page's own row
 * count, and a list that pages twenty rows will still settle rather than jump from nothing.
 */
function RowSkeleton(): React.JSX.Element {
  return (
    <div className="divide-y divide-border" aria-busy="true" aria-live="polite">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className={`flex ${ROW_HEIGHT_CLASS} items-center gap-3 px-4`}>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}
