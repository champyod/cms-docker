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

/** The count and page number belong to the layout's footer; a table carrying them is a second place they could disagree. */
export interface AuditTableProps {
  entries: AuditLogRow[];
  dict: AuditDict;
  sort?: ListSortInput;
  /** True when the address asked for the live cursor; the table then reloads on a new row. */
  autoRefresh?: boolean;  /** common.notSet: a cell whose value the record does not hold. */
  readonly missing: string;
}
