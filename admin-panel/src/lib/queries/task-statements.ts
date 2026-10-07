import { prisma } from '@/lib/prisma';

export type TaskStatementSummary = {
  id: number; language: string; digest: string; filename: string;
  size: number | null; uploadedAt: string | null;
};

type RawStatement = { id: number; language: string; digest: string };
type FsobjectSizeRow = { digest: string; size: number };
type StatementAuditRow = { timestamp: Date; after_values: unknown };

// Why the limit: the audit trail is append-only and unbounded, so an upload date
// is only read from the most recent window of statement creations.
const STATEMENT_AUDIT_LIMIT = 100;

// Why one query: statement blobs live outside Prisma models and their sizes are
// per statement, so a query per statement is N+1 round trips for a detail page.
// fsobjects.digest is the primary key, so any digest matches at most one row.
async function fetchStatementSizes(statements: readonly RawStatement[]): Promise<Map<string, number>> {
  const digests = [...new Set(statements.map((statement) => statement.digest))];
  if (digests.length === 0) return new Map();
  try {
    const rows = await prisma.$queryRaw<FsobjectSizeRow[]>`SELECT digest, octet_length(lo_get(loid))::int AS size FROM fsobjects WHERE digest = ANY(${digests}::varchar[])`;
    return new Map(rows.map((row) => [row.digest, Number(row.size)]));
  } catch {
    // Why degrade, not throw: a missing or unreadable large object leaves the size
    // unknown instead of failing the whole overview read.
    return new Map();
  }
}

// Why first-wins: audits are read newest-first, so the first row per language is
// that language's latest upload.
function indexLatestStatementUploads(audits: readonly StatementAuditRow[], taskId: number): Map<string, string> {
  const uploads = new Map<string, string>();
  const wantedId = String(taskId);
  for (const audit of audits) {
    const after = audit.after_values as Record<string, unknown> | null;
    if (!after) continue;
    if (String(after.taskId ?? after.task_id ?? '') !== wantedId) continue;
    const language = String(after.language ?? '');
    if (!uploads.has(language)) uploads.set(language, audit.timestamp.toISOString());
  }
  return uploads;
}

// Why: upload dates come from audit history, which is best-effort context —
// an audit lookup failure degrades to unknown dates, never a failed read.
async function fetchStatementUploadDates(taskId: number): Promise<Map<string, string>> {
  try {
    const audits = await prisma.audit_log.findMany({ where: { verb: 'statement:create', entity: 'statement' }, orderBy: { timestamp: 'desc' }, take: STATEMENT_AUDIT_LIMIT });
    return indexLatestStatementUploads(audits, taskId);
  } catch {
    return new Map();
  }
}

// Why enrichment lives here so the overview read keeps digest/file
// metadata without depending on the task mutation service.
export async function enrichStatements(taskId: number, statements: readonly RawStatement[]): Promise<TaskStatementSummary[]> {
  if (statements.length === 0) return [];
  const [sizes, dates] = await Promise.all([fetchStatementSizes(statements), fetchStatementUploadDates(taskId)]);
  return statements.map((statement) => ({
    id: statement.id, language: statement.language, digest: statement.digest, filename: `${statement.language}.pdf`,
    size: sizes.get(statement.digest) ?? null, uploadedAt: dates.get(statement.language) ?? null,
  }));
}
