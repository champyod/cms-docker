import type { ReactNode } from 'react';

import { Card } from '@/components/core/Card';
import { DefinitionEntry } from '@/components/core/DefinitionEntry';
import { PageSurface } from '@/components/core/PageSurface';
import type { PageSlots } from '@/components/patterns/types';

export interface DetailFact {
  readonly term: string;
  readonly value: string;
}

export interface DetailPageProps extends Omit<PageSlots, 'children'> {
  /** What the record is, as term/value pairs — the strip under the title, not a paragraph. */
  readonly facts: readonly DetailFact[];
  /** The state of this record, when it has one worth reading first. */
  readonly state?: ReactNode;
  /** Sections belonging to the record: participants, tasks, history. */
  readonly children?: ReactNode;
  /** Where the record came from and when it last changed. */
  readonly freshness?: ReactNode;
  /** False when a module shell above already renders the page identity. */
  readonly identity?: boolean;
}

/**
 * The detail layout: identity first as a fact strip, then sections, then history.
 *
 * A fact strip rather than prose, because a reader scanning for one value should not have to read
 * a sentence to find it - and because a pair laid out as pairs stays comparable when two records
 * are open side by side.
 */
export function DetailPage({
  breadcrumbs,
  title,
  description,
  actions,
  facts,
  state,
  children,
  freshness,
  identity = true,
}: DetailPageProps): React.JSX.Element {
  return (
    <PageSurface breadcrumbs={breadcrumbs} title={title} description={description} actions={actions} identity={identity}>
      <div className="space-y-4">
        {state}
        <Card className="p-4">
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {facts.map((fact) => (
              <DefinitionEntry key={fact.term} term={fact.term} value={fact.value} />
            ))}
          </dl>
          {freshness && <div className="mt-3 text-muted-foreground">{freshness}</div>}
        </Card>
        {children}
      </div>
    </PageSurface>
  );
}
