import type { AuditLogRow } from '@/app/actions/audit';

export interface AuditDict {
  title: string;
  subtitle: string;
  columns: {
    timestamp: string;
    actor: string;
    verb: string;
    entity: string;
    entityId: string;
    result: string;
    reason: string;
  };
  filters: {
    entity: string;
    verb: string;
    actorId: string;
    fromDate: string;
    toDate: string;
    apply: string;
    clear: string;
    allEntities: string;
  };
  noEntries: string;
  pageInfo: string;
  expandedDetails: string;
  beforeValues: string;
  afterValues: string;
  ip: string;
  sessionId: string;
  entryHash: string;
  prevHash: string;
}

export interface AuditFilterValues {
  entity?: string;
  verb?: string;
  actorId?: string;
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
}
