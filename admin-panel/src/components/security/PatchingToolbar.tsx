'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';

import { Button } from '@/components/core/Button';
import { SelectField } from '@/components/core/FormField';
import { BulkWaiveDialog } from '@/components/security/BulkWaiveDialog';
import { useAppRouter } from '@/hooks/useAppRouter';
import type { Dictionary } from '@/lib/dictionary';
import { REACHABILITY_VALUES, type Reachability } from '@/lib/security/kernel-reachability';
import {
  defaultDirection,
  PATCHING_SEVERITIES,
  PATCHING_SORTS,
  PATCHING_SOURCES,
  patchingSearchParams,
  type PatchingPageInfo,
  type PatchingQuery,
  type PatchingReachabilityFilter,
  type PatchingSeverity,
  type PatchingSort,
} from '@/lib/security/patching';

type PatchingCopy = Dictionary['security']['patching'];

export interface PatchingToolbarProps {
  /** The resolved query the controls show, and the SQL count they report against it. */
  readonly page: PatchingPageInfo;
  readonly copy: PatchingCopy;
  /** Whether the reader holds patching:waive; the read key alone must not offer a write. */
  readonly canWaive: boolean;
}

function counted(template: string, count: number): string {
  return template.replace('{count}', String(count));
}

/**
 * The feed's controls: the filters, the count they narrow to, and the one bulk write.
 *
 * WHY the filters are a component of their own rather than part of the table: the layout decides
 * where controls sit relative to rows, and a page that drew its own filter card could not be
 * given a different frame without editing the table. The bulk waiver rides here for the opposite
 * reason - it acts on the whole feed, so a page spot beside the count is the honest place for it,
 * not a row inside a page of rows.
 */
export function PatchingToolbar({ page, copy, canWaive }: PatchingToolbarProps): React.JSX.Element {
  const [bulkOpen, setBulkOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const router = useAppRouter();
  const pathname = usePathname();
  const query = page.query;

  /**
   * The URL for a view of this table.
   *
   * WHY the page number lives in the URL and not in state: the rows are sliced by the database, so
   * a page is something the server resolves. A link is therefore the honest control — it survives
   * a reload, can be shared, and needs no client cache to stay in step with the SQL.
   */
  function hrefFor(next: Partial<PatchingQuery>): string {
    const params = new URLSearchParams(patchingSearchParams({ ...query, ...next }));
    const search = params.toString();
    return search === '' ? pathname : `${pathname}?${search}`;
  }

  /**
   * A filter change always returns to the first page.
   *
   * WHY: page 7 of the old filter is not page 7 of the new one — keeping the number would land the
   * reader on a page that may not exist for the rows they just asked for.
   */
  function applyFilter(next: Partial<PatchingQuery>): void {
    router.push(hrefFor({ ...next, page: 1 }));
  }

  return (
    <>
      <SelectField
        id="patching-source"
        label={copy.filters.source}
        value={query.source}
        className="sm:w-56"
        onChange={(event) => applyFilter({ source: event.target.value as PatchingQuery['source'] })}
      >
        <option value="all">{copy.filters.allSources}</option>
        {PATCHING_SOURCES.map((source) => (
          <option key={source} value={source}>
            {copy.sources[source]}
          </option>
        ))}
      </SelectField>
      <SelectField
        id="patching-severity"
        label={copy.filters.severity}
        value={query.severity}
        className="sm:w-48"
        onChange={(event) =>
          applyFilter({ severity: event.target.value as PatchingQuery['severity'] })
        }
      >
        <option value="all">{copy.filters.allSeverities}</option>
        {PATCHING_SEVERITIES.map((severity: PatchingSeverity) => (
          <option key={severity} value={severity}>
            {severity}
          </option>
        ))}
      </SelectField>
      <SelectField
        id="patching-reachability"
        label={copy.filters.reachability}
        value={query.reachability}
        className="sm:w-48"
        onChange={(event) =>
          applyFilter({
            reachability: event.target.value as PatchingReachabilityFilter,
          })
        }
      >
        <option value="all">{copy.filters.allReachability}</option>
        {REACHABILITY_VALUES.map((value: Reachability) => (
          <option key={value} value={value}>
            {copy.reachability[value]}
          </option>
        ))}
      </SelectField>
      <SelectField
        id="patching-flip"
        label={copy.filters.flip}
        value={query.flip}
        className="sm:w-56"
        onChange={(event) =>
          applyFilter({ flip: event.target.value === 'waived' ? 'waived' : 'all' })
        }
      >
        <option value="all">{copy.filters.flipAll}</option>
        <option value="waived">{copy.filters.flipWaived}</option>
      </SelectField>
      <SelectField
        id="patching-sort"
        label={copy.filters.sort}
        value={query.sort}
        className="sm:w-48"
        onChange={(event) => {
          // A new sort field brings its own default direction; keeping the previous field's is
          // how "sort by subject" rendered Z→A because the date column sorted descending.
          const sort = event.target.value as PatchingSort;
          applyFilter({ sort, direction: defaultDirection(sort) });
        }}
      >
        {PATCHING_SORTS.map((sort: PatchingSort) => (
          <option key={sort} value={sort}>
            {copy.filters.sorts[sort]}
          </option>
        ))}
      </SelectField>
      <SelectField
        id="patching-direction"
        label={copy.filters.direction}
        value={query.direction}
        className="sm:w-40"
        onChange={(event) =>
          applyFilter({ direction: event.target.value === 'asc' ? 'asc' : 'desc' })
        }
      >
        <option value="desc">{copy.filters.descending}</option>
        <option value="asc">{copy.filters.ascending}</option>
      </SelectField>
      <p className="ml-auto font-mono text-sm text-muted-foreground">
        {counted(copy.filters.match, page.total)}
      </p>
      {canWaive && (
        <Button variant="secondary" onClick={() => setBulkOpen(true)}>
          {copy.bulkWaive.button}
        </Button>
      )}
      {feedback !== null && (
        <p className="w-full text-sm text-muted-foreground" role="status">
          {feedback}
        </p>
      )}
      <BulkWaiveDialog
        open={bulkOpen}
        copy={copy}
        onClose={() => setBulkOpen(false)}
        onRecorded={setFeedback}
      />
    </>
  );
}
