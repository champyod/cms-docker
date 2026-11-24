import type { ReactNode } from 'react';

import { SectionCard } from '@/components/core/SectionCard';
import { PageSurface } from '@/components/core/PageSurface';
import type { PageSlots } from '@/components/patterns/page-types';

export interface BoardSection {
  /** Stable key, used to report which section changed. */
  readonly key: string;
  readonly title: string;
  /** What this section answers, in one line — a board of five untitled lists is a wall. */
  readonly description?: string;
  /** A count in its own slot: inside the title it joins the heading's accessible name. */
  readonly count?: number;
  /** The section's own state, when it has one worth reading before its rows. */
  readonly state?: ReactNode;
  /** What empty means for this section specifically: "no blocks" differs from "not loaded". */
  readonly empty?: ReactNode;
  readonly rows: ReactNode;
  readonly actions?: ReactNode;
}

export interface BoardPageProps extends Omit<PageSlots, 'children'> {
  /** The page's own state, above every section. */
  readonly state?: ReactNode;
  readonly freshness?: ReactNode;
  /** A board with no sections is legitimate only when state says why. */
  readonly sections: readonly BoardSection[];
  /** False when a module shell above already renders the page header. */
  readonly ownsHeader?: boolean;
}

export function BoardPage({
  breadcrumbs,
  title,
  description,
  actions,
  state,
  freshness,
  sections,
  ownsHeader = true,
}: BoardPageProps): React.JSX.Element {
  return (
    <PageSurface
      breadcrumbs={breadcrumbs}
      title={title}
      description={description}
      actions={actions}
      ownsHeader={ownsHeader}
    >
      <div className="space-y-4">
        {state}
        {freshness && <p className="text-xs text-muted-foreground">{freshness}</p>}
        {sections.map((section) => (
          <SectionCard
            key={section.key}
            title={section.title}
            description={section.description}
            count={section.count}
            actions={section.actions}
          >
            {section.state}
            {/* A section that names its empty state renders it instead of its rows: the page knows
                whether the section is empty, and passing `empty` is how it says so. */}
            {section.empty ?? section.rows}
          </SectionCard>
        ))}
      </div>
    </PageSurface>
  );
}
