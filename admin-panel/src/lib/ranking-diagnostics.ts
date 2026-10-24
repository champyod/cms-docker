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

/**
 * The four task-hide counters the service reports: every task hide that named no task row,
 * and the three causes that partition it.
 */
export interface RankingHideCauses {
  readonly unknownTaskHides: number;
  readonly withheldTaskHides: number;
  readonly renamedTaskHides: number;
  readonly unmatchedTaskHides: number;
}

/**
 * The three causes of a dropped row, which partition `skippedSubchanges`. `hiddenTask` is a
 * hide the operator applied; `unknownTask` and `orphan` are the two worth chasing.
 */
export interface RankingSubchangeCauses {
  readonly hiddenTaskSubchanges: number;
  readonly unknownTaskSubchanges: number;
  readonly orphanSubchanges: number;
}

export type RankingDiagnostics =
  | {
      readonly reachable: true;
      readonly skippedOverrides: number;
      readonly skippedSubchanges: number;
      /**
       * Null when the service did not report the breakdown. A null is rendered as "not
       * reported", never as zeros: a counter the service cannot answer has not been measured,
       * and drawing it as zero is the substitution this module exists to prevent.
       */
      readonly hideCauses: RankingHideCauses | null;
      readonly subchangeCauses: RankingSubchangeCauses | null;
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
  unknown_task_hides?: unknown;
  withheld_task_hides?: unknown;
  renamed_task_hides?: unknown;
  unmatched_task_hides?: unknown;
  hidden_task_subchanges?: unknown;
  unknown_task_subchanges?: unknown;
  orphan_subchanges?: unknown;
}

/** A non-negative integer, or null for anything that is not one. */
function readCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  return value;
}

/**
 * One group of counters, or null unless every one of them is a count.
 *
 * WHY all-or-nothing: the causes of a group are a partition of a total, so a body carrying half
 * of one is not a breakdown — and filling the missing half with zeros would report a number the
 * service never measured. A group the service does not report reads as null (rendered "not
 * reported"), which is an older service's honest answer rather than a clean board.
 */
function readGroup<K extends keyof DiagnosticsBody>(
  body: DiagnosticsBody,
  keys: readonly K[],
): Record<K, number> | null {
  const counts = {} as Record<K, number>;
  for (const key of keys) {
    const count = readCount(body[key]);
    if (count === null) return null;
    counts[key] = count;
  }
  return counts;
}

const HIDE_CAUSE_KEYS = [
  'unknown_task_hides',
  'withheld_task_hides',
  'renamed_task_hides',
  'unmatched_task_hides',
] as const;

const SUBCHANGE_CAUSE_KEYS = [
  'hidden_task_subchanges',
  'unknown_task_subchanges',
  'orphan_subchanges',
] as const;

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

  // The two breakdowns are optional on purpose: they arrived after the two summary counters, and
  // the keys the panel already read have to keep working against a service that predates them.
  const hides = readGroup(body, HIDE_CAUSE_KEYS);
  const subchanges = readGroup(body, SUBCHANGE_CAUSE_KEYS);

  return {
    reachable: true,
    skippedOverrides,
    skippedSubchanges,
    hideCauses:
      hides === null
        ? null
        : {
            unknownTaskHides: hides.unknown_task_hides,
            withheldTaskHides: hides.withheld_task_hides,
            renamedTaskHides: hides.renamed_task_hides,
            unmatchedTaskHides: hides.unmatched_task_hides,
          },
    subchangeCauses:
      subchanges === null
        ? null
        : {
            hiddenTaskSubchanges: subchanges.hidden_task_subchanges,
            unknownTaskSubchanges: subchanges.unknown_task_subchanges,
            orphanSubchanges: subchanges.orphan_subchanges,
          },
  };
}
