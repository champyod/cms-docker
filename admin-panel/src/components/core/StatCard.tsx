import type { ReactNode } from 'react';

import { Card } from '@/components/core/Card';
import { formatCountOrText } from '@/lib/format-number';

export interface StatCardProps {
  /** What the number is, in the reader's words. */
  readonly label: string;
  readonly value: number | string;
  /** One line that says what the number is measured against, when it needs one. */
  readonly reference?: ReactNode;
  /** The reader's language, so a count is grouped the way that language groups it. */
  readonly locale?: string;
}

/**
 * One metric: a term, its value, and what the value is measured against.
 *
 * The three parts are a definition pair rather than three lines of text, so a reader is told which
 * word the number belongs to instead of hearing a run of numbers.
 *
 * The value is a section-level size, not the page-title size: a metric as loud as the page's own
 * heading makes the reader weigh two things that do not carry the same importance.
 *
 * The label is not uppercased. English can shout with capitals; Thai cannot, so an uppercase label
 * would give one language an emphasis the other never receives.
 */
export function StatCard({ label, value, reference, locale }: StatCardProps): React.JSX.Element {
  return (
    <Card className="p-4">
      <dl className="flex flex-col gap-1">
        <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
        <dd className="text-lg leading-tight font-semibold tabular-nums">
          {formatCountOrText(value, locale)}
        </dd>
        {reference ? (
          <dd className="text-xs text-muted-foreground">{reference}</dd>
        ) : null}
      </dl>
    </Card>
  );
}
