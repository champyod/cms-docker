'use client';

import { usePathname } from 'next/navigation';

import { Badge } from '@/components/core/Badge';
import { RecordListPager } from '@/components/list/RecordListPager';
import type { Dictionary } from '@/lib/dictionary';
import {
  patchingSearchParams,
  type PatchingCards,
  type PatchingPageInfo,
} from '@/lib/security/patching';

type PatchingCopy = Dictionary['security']['patching'];

export interface PatchingFooterProps {
  /** One page of the feed plus the numbers that describe the whole of it. */
  readonly page: PatchingPageInfo;
  /** The whole feed's inventory, from the aggregate — never counted off the rows shown. */
  readonly cards: PatchingCards;
  /** The newest report among the rows on this page, ISO; null when the page holds no row. */
  readonly newest: string | null;
  readonly copy: PatchingCopy;
}

function filled(template: string, values: Record<string, number>): string {
  return Object.entries(values).reduce(
    (line, [key, value]) => line.replace(`{${String(key)}}`, String(value)),
    template,
  );
}

/** The same day label the row columns use: one string on the server render and the hydration. */
function day(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * The arithmetic of the feed, under the rows it describes.
 *
 * WHY the four totals sit here and not above the rows: a list's first question is which rows are
 * there, and these four numbers are the whole feed's inventory rather than a fact about any row on
 * screen. Reading them after the rows keeps them from pushing the rows down, and the range line
 * beside them says how much of that inventory this page is showing.
 */
export function PatchingFooter({ page, cards, newest, copy }: PatchingFooterProps): React.JSX.Element {
  const pathname = usePathname();

  function hrefForPage(next: number): string {
    const params = new URLSearchParams(patchingSearchParams({ ...page.query, page: next }));
    const search = params.toString();
    return search === '' ? pathname : `${pathname}?${search}`;
  }

  const total = page.total;
  const from = Math.min(total, (page.query.page - 1) * page.pageSize) + 1;
  const to = Math.min(total, page.query.page * page.pageSize);

  return (
    <div className="space-y-2">
      <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
        {(
          [
            ['staleImages', cards.staleImages],
            ['unresolvedCves', cards.unresolvedCves],
            ['expiredWaivers', cards.expiredWaivers],
            ['hostOsUpdates', cards.hostOsUpdates],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="flex items-baseline gap-2">
            <dt className="text-muted-foreground">{copy.cards[key]}</dt>
            {key === 'expiredWaivers' && value > 0 ? (
              // A lapsed decision is state, so it reads through the badge every other state uses
              // rather than through a colour this strip invents.
              <dd>
                <Badge variant="red">{String(value)}</Badge>
              </dd>
            ) : (
              <dd className="font-mono text-foreground">{String(value)}</dd>
            )}
          </div>
        ))}
      </dl>
      <p className="text-center text-sm text-muted-foreground">
        {filled(copy.pager.range, { from, to, total })}
      </p>
      {newest !== null && (
        <p className="text-center text-xs text-muted-foreground">
          {copy.columns.lastSeen}: {day(newest)}
        </p>
      )}
      <RecordListPager
        currentPage={page.query.page}
        totalPages={page.pageCount}
        totalRows={total}
        rowLabel={copy.pager.row}
        hrefForPage={hrefForPage}
      />
    </div>
  );
}
