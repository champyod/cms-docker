import type { ReactNode } from 'react';

import { Card } from '@/components/core/Card';
import { PageSurface } from '@/components/core/PageSurface';
import type { PageSlots } from '@/components/patterns/page-types';

export interface BoardSection {
  /** Stable key, used to report which section changed. */
  readonly key: string;
  readonly title: string;
  /** What this section answers, in one line — a board of five untitled lists is a wall. */
  readonly description?: string;
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
        {freshness && <p className="text-muted-foreground">{freshness}</p>}
        {sections.map((section) => (
          <Card key={section.key} className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[length:var(--text-card)] font-semibold">{section.title}</h2>
                {section.description && <p className="text-muted-foreground">{section.description}</p>}
              </div>
              {section.actions}
            </div>
            {section.state}
            {section.empty ?? section.rows}
          </Card>
        ))}
      </div>
    </PageSurface>
  );
}
