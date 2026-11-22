import type { ReactNode } from 'react';

import { Card } from '@/components/core/Card';
import { Text } from '@/components/core/Typography';

export interface StatCardProps {
  /** What the number is, in the reader's words. */
  readonly label: string;
  readonly value: number | string;
  /** One line that says what the number is measured against, when it needs one. */
  readonly reference?: ReactNode;
}

/**
 * One metric: a label, the number, and what the number is measured against.
 *
 * The three parts live here rather than being retyped per page for the same reason a token does:
 * a count whose label sits on the wrong line, or whose number is a different size, reads as a
 * different kind of fact on every page that draws it.
 */
export function StatCard({ label, value, reference }: StatCardProps): React.JSX.Element {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <Text variant="label">{label}</Text>
      <span className="text-[length:var(--text-page)] leading-tight font-semibold tabular-nums">{value}</span>
      {reference ? <Text variant="muted">{reference}</Text> : null}
    </Card>
  );
}
