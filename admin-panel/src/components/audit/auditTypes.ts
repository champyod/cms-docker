import type { AuditLogRow } from '@/app/actions/audit';
import type { ListSortInput } from '@/lib/list-sorting';
import type { AuditDict } from './audit-dict';

export type { AuditDict };

export interface AuditFilterValues {
  entity?: string;
  verb?: string;
  actorId?: string;
  result?: string;
  ip?: string;
  showViews?: boolean;
  search?: string;
  fromDate?: string;
  toDate?: string;
}

/**
 * The rows the page hands its table.
 *
 * WHY no count and no page number: those describe the request, and the list layout prints them in
 * the footer it owns. A table carrying them would be a second place they could disagree.
 */
export interface AuditTableProps {
  entries: AuditLogRow[];
  dict: AuditDict;
  sort?: ListSortInput;
  /** True when the address asked for the live cursor; the table then reloads on a new row. */
  autoRefresh?: boolean;
}
