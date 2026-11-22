import type { ReactNode } from 'react';

import { Card } from '@/components/core/Card';
import { InlineAlert } from '@/components/core/InlineAlert';
import { PageSurface } from '@/components/core/PageSurface';
import { Skeleton } from '@/components/core/Skeleton';
import type { PageSlots } from '@/components/patterns/types';

export interface ListPageState {
  /** One of the four things a list can be: telling the operator something needs a decision. */
  tone: 'info' | 'warning' | 'destructive';
  title: string;
  detail?: ReactNode;
  action?: ReactNode;
}

export interface ListPageProps extends PageSlots {
  /** Above the toolbar, before any row: the page's state is the first thing read (topic 8d). */
  readonly state?: ListPageState;
  /** The rows. The page supplies a table; the archetype owns where it sits and what frames it. */
  readonly children: ReactNode;
  readonly toolbar?: ReactNode;
  readonly footer?: ReactNode;
  /** Shown instead of the rows when there is nothing: never an empty table with headers. */
  readonly empty?: ReactNode;
  /** Skeleton of the real shape (topic 10b), not a spinner over a blank card. */
  readonly loading?: boolean;
}

/**
 * The list archetype: state, then controls, then rows, then paging. Every list page in the panel
 * reads in that order, so an operator moving between Contests, Tasks and Users does not re-learn
 * where things are. Loading renders a skeleton of rows, not a spinner, so the layout does not
 * jump when the data lands.
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
}: ListPageProps): React.JSX.Element {
  return (
    <PageSurface breadcrumbs={breadcrumbs} title={title} description={description} actions={actions}>
      <div className="space-y-3">
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

/** Six rows of the density default: the same height the real rows will have. */
function RowSkeleton(): React.JSX.Element {
  return (
    <div className="divide-y divide-border" aria-busy="true" aria-live="polite">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex h-8 items-center gap-3 px-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}
