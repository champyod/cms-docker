'use client';

import Link from 'next/link';

import { Card } from '@/components/core/Card';
import type { Dictionary } from '@/lib/dictionary';

type PatchingCopy = Dictionary['security']['patching'];

/** Fills `{count}` in the sentence; the number is the same SQL count the filter selects. */
function counted(template: string, count: number): string {
  return template.replace('{count}', String(count));
}

interface PatchingFlipBannerProps {
  /** Rows a live waiver hides although their stored verdict is 'reachable' now. */
  readonly count: number;
  /** The same page under the flip filter, so the sentence leads to the rows it is about. */
  readonly href: string;
  readonly copy: PatchingCopy;
}

/**
 * The page's statement of the defect: a waiver written for a host state that has since ended.
 *
 * WHY a banner and not a fifth card: the four cards are inventories of the feed, and a reader scans
 * them as quantities of the same kind of thing. This is a decision that no longer fits, so it
 * carries a sentence and the link to the rows rather than a number in a grid.
 */
export function PatchingFlipBanner({ count, href, copy }: PatchingFlipBannerProps): React.JSX.Element | null {
  if (count === 0) return null;
  return (
    <Card>
      <p className="text-sm text-destructive">
        {counted(copy.filters.flipNotice, count)}{' '}
        <Link className="underline" href={href}>
          {copy.filters.flipLink}
        </Link>
      </p>
    </Card>
  );
}
