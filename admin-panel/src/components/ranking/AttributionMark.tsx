'use client';

import { Badge } from '@/components/core/Badge';
import { attributionText, isUnattributed, type AttributedRow } from '@/lib/ranking-attribution';

const MUTED = 'text-muted-foreground';

export interface AttributionMarkProps {
  readonly row: AttributedRow;
  /** This surface's words for a row nobody signed; the mark's shape is not the surface's call. */
  readonly unattributedLabel: string;
}

/**
 * The author of a ranking row, or the mark that says nobody signed it.
 *
 * WHY one component for every surface: the decision belongs to `ranking-attribution`, but the
 * decision is worthless if each caller renders it differently — a surface that printed nothing for
 * an unattributed row would look exactly like one that had an author to print. So the mark is
 * shape here, wording from the caller's dictionary, and the predicate from the shared module: no
 * surface decides for itself what "no author" looks like on screen.
 */
export function AttributionMark({
  row,
  unattributedLabel,
}: AttributionMarkProps): React.JSX.Element {
  if (isUnattributed(row)) {
    return <Badge variant="amber">{unattributedLabel}</Badge>;
  }
  return <span className={`font-mono text-xs ${MUTED}`}>{attributionText(row)}</span>;
}
