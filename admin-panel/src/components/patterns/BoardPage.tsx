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
  /**
   * How many rows the section holds, when that is a fact worth reading before them. A count belongs
   * in its own slot: written into the title it joins the heading's accessible name and stops being
   * a number the eye can compare with the one beside it.
   */
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
  /**
   * The sections, in reading order. A board may legitimately have none - when the thing it is about
   * does not exist yet - but then `state` has to say so; the archetype gate enforces that pairing.
   */
  readonly sections: readonly BoardSection[];
  /** False when a module shell above already renders the page header. */
  readonly ownsHeader?: boolean;
}

/**
 * The board layout: several independent record kinds on one page, each with its own rows and its
 * own meaning of empty.
 *
 * It exists because four pages are genuinely boards - security blocks carries captchas, bans,
 * exemptions, logins and lockouts, none of which is the same record - and forcing them into a list
 * meant inventing one row set, one filter and one total that the page could not honestly fill.
 * A board is not a licence for a page to draw its own layout: the frame, the heading level, the
 * spacing and the empty treatment stay here.
 */
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
        {freshness && <p className="text-[length:var(--text-label)] text-muted-foreground">{freshness}</p>}
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
