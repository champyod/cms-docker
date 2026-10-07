/** Shared dictionary shape for the audit log UI. */
export interface AuditDict {
  title: string;
  subtitle: string;
  columns: {
    timestamp: string;
    actor: string;
    verb: string;
    entity: string;
    entityName: string;
    result: string;
    reason: string;
  };
  filters: {
    entity: string;
    verb: string;
    actorId: string;
    result: string;
    allResults: string;
    search: string;
    searchPlaceholder: string;
    fromDate: string;
    toDate: string;
    apply: string;
    clear: string;
    allEntities: string;
  };
  exportCsv: string;
  autoRefresh: string;
  noEntries: string;
  pageInfo: string;
  expandedDetails: string;
  detailLoadFailed: string;
  beforeValues: string;
  afterValues: string;
  ip: string;
  sessionId: string;
  entryHash: string;
  prevHash: string;
}
