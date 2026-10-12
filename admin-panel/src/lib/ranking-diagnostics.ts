/**
 * Reads the ranking service's own account of what it applied.
 *
 * WHY this exists: the ranking fold is deliberately forgiving — an unreadable override
 * or a subchange that resolves to no known submission is dropped and counted rather than
 * refusing the whole board. Until `GET /diagnostics` existed those counters were computed
 * and thrown away, so a dropped override looked exactly like a board that had none. This
 * is the panel's consumer for them.
 *
 * WHY the container name and not a URL from config: the panel reaches its sibling
 * services by compose container name on the internal network — `evaluation-rpc.ts`
 * already calls `cms-evaluation-service` the same way. The compose service is named
 * `cms-ranking-web-server` (docker-compose.yml), and the service binds 0.0.0.0:8890.
 * The route is exempt from the console's login gate for exactly this caller, which
 * holds no scoreboard session.
 */
const RANKING_HOST = 'cms-ranking-web-server';
const RANKING_PORT = 8890;
const DIAGNOSTICS_URL = `http://${RANKING_HOST}:${RANKING_PORT}/diagnostics`;
const DIAGNOSTICS_TIMEOUT_MS = 5_000;

export type RankingDiagnostics =
  | {
      readonly reachable: true;
      readonly skippedOverrides: number;
      readonly skippedSubchanges: number;
    }
  /**
   * Unreachable is a distinct outcome from "nothing was dropped", and the panel must not
   * collapse them: the route refuses rather than reporting zeros, and turning that
   * refusal back into zeros here would undo the contract the route was built to keep.
   */
  | { readonly reachable: false; readonly reason: string };

interface DiagnosticsBody {
  ready?: unknown;
  skipped_overrides?: unknown;
  skipped_subchanges?: unknown;
}

/** A non-negative integer, or null for anything that is not one. */
function readCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  return value;
}

/**
 * Never throws. A monitoring read that can take down the page it decorates is worse
 * than no monitoring read, so every failure mode becomes an explicit unreachable result.
 */
export async function getRankingDiagnostics(): Promise<RankingDiagnostics> {
  let response: Response;
  try {
    response = await fetch(DIAGNOSTICS_URL, {
      signal: AbortSignal.timeout(DIAGNOSTICS_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (error) {
    return { reachable: false, reason: (error as Error).message };
  }

  if (!response.ok) {
    // 503 is the service's own refusal (no database, unreadable store). It is reported
    // as unreachable rather than as zero dropped rows, because that is what it means.
    return { reachable: false, reason: `HTTP ${response.status}` };
  }

  let body: DiagnosticsBody;
  try {
    body = (await response.json()) as DiagnosticsBody;
  } catch {
    return { reachable: false, reason: 'the response was not JSON' };
  }

  const skippedOverrides = readCount(body.skipped_overrides);
  const skippedSubchanges = readCount(body.skipped_subchanges);
  if (skippedOverrides === null || skippedSubchanges === null) {
    return { reachable: false, reason: 'the response was not the expected shape' };
  }

  return { reachable: true, skippedOverrides, skippedSubchanges };
}
