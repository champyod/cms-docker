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

/** No uppercased label: Thai has no case, so capitals give one language an emphasis the other never receives. */
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
