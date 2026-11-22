import type { ReactNode } from 'react';

import { Card } from '@/components/core/Card';
import { DefinitionEntry } from '@/components/core/DefinitionEntry';
import { PageSurface } from '@/components/core/PageSurface';
import { formatCountOrText } from '@/lib/format-number';
import type { PageSlots } from '@/components/patterns/page-types';

export interface DetailFact {
  readonly term: string;
  /**
   * A count is passed as a number and formatted here, so grouping happens once. A page that writes
   * `String(count)` chooses its own formatting, which is how 23 of them came to print 1204.
   */
  readonly value: string | number;
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
  /** The reader's language, so a numeric fact is grouped the way that language groups it. */
  readonly locale?: string;
  /** False when a module shell above already renders the page header. */
  readonly ownsHeader?: boolean;
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
  locale,
  ownsHeader = true,
}: DetailPageProps): React.JSX.Element {
  return (
    <PageSurface breadcrumbs={breadcrumbs} title={title} description={description} actions={actions} ownsHeader={ownsHeader}>
      <div className="space-y-4">
        {state}
        <Card className="p-4">
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {facts.map((fact) => (
              <DefinitionEntry key={fact.term} term={fact.term} value={formatCountOrText(fact.value, locale)} />
            ))}
          </dl>
          {freshness && <div className="mt-3 text-muted-foreground">{freshness}</div>}
        </Card>
        {children}
      </div>
    </PageSurface>
  );
}
