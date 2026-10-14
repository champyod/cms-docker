import { prisma } from '@/lib/prisma';

export interface EvaluationEndpoint {
  host: string;
  port: number;
}

/** The compose service name and RPC port a deployment without a registry uses. */
export const DEFAULT_EVALUATION_ENDPOINT: EvaluationEndpoint = {
  host: 'cms-evaluation-service',
  port: 25000,
};

export class EvaluationTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvaluationTargetError';
  }
}

interface EvaluationRow {
  host: string;
  rpc_port: number | null;
  contest_id: number | null;
}

/**
 * The evaluation service that should handle a contest.
 *
 * WHY the registry first and the constant last: a deployment may run an evaluation service
 * per contest, so the address is data rather than a fact about the compose file. The
 * constant survives as the answer for an empty registry, which is every deployment that
 * predates the table — so the single-contest path is byte-identical to before.
 *
 * WHY a registry with no usable row throws instead of falling back: falling back would send
 * a submission to a service the registry never named, and a requeue that silently lands on
 * the wrong contest is worse than one that reports it could not be routed.
 */
export async function resolveEvaluationEndpoint(contestId: number | null): Promise<EvaluationEndpoint> {
  const rows = await prisma.services.findMany({
    where: { role: 'EvaluationService', enabled: true },
    orderBy: { shard: 'asc' },
    select: { host: true, rpc_port: true, contest_id: true },
  });
  if (rows.length === 0) return DEFAULT_EVALUATION_ENDPOINT;

  const chosen = pickEvaluationRow(rows, contestId);
  if (chosen === null) {
    throw new EvaluationTargetError(`no enabled evaluation service serves contest ${contestId}`);
  }
  if (chosen.rpc_port === null) {
    throw new EvaluationTargetError(`evaluation service ${chosen.host} has no rpc_port`);
  }
  return { host: chosen.host, port: chosen.rpc_port };
}

/** A row bound to the contest outranks the shared row; a shared row serves any contest. */
function pickEvaluationRow(rows: readonly EvaluationRow[], contestId: number | null): EvaluationRow | null {
  if (contestId !== null) {
    const bound = rows.find((row) => row.contest_id === contestId);
    if (bound !== undefined) return bound;
  }
  return rows.find((row) => row.contest_id === null) ?? null;
}
