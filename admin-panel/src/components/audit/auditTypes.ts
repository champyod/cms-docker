import type { AuditLogRow } from '@/app/actions/audit';
import type { ListSortInput } from '@/lib/list-sorting';
import type { AuditDict } from './audit-dict';

export type { AuditDict };

export interface AuditFilterValues {
  entity?: string;
  verb?: string;
  actorId?: string;
  result?: string;
  search?: string;
  fromDate?: string;
  toDate?: string;
}

export interface AuditTableProps {
  entries: AuditLogRow[];
  total: number;
  totalPages: number;
  currentPage: number;
  filters: AuditFilterValues;
  dict: AuditDict;
  permissionKeys: string[];
  sort?: ListSortInput;
}
