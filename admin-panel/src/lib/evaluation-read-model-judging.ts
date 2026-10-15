import type { SubmissionJudgingPhase } from '@/lib/evaluation-read-model-types';

export interface JudgingOutcomeRow {
  readonly compilationOutcome: string | null;
  readonly evaluationOutcome: string | null;
  readonly score: number | null;
}

export function judgingPhaseOf(result: JudgingOutcomeRow): SubmissionJudgingPhase {
  if (result.compilationOutcome === null) return 'compiling';
  if (result.compilationOutcome === 'fail') return 'compilation-failed';
  if (result.evaluationOutcome === null) return 'evaluating';
  if (result.score === null) return 'scoring';
  return 'done';
}

// Why the empty case: a requeue clears every result row, so "no rows" reads as judging in progress.
export function judgingPhaseFor(results: readonly JudgingOutcomeRow[]): SubmissionJudgingPhase {
  for (const result of results) {
    const phase = judgingPhaseOf(result);
    if (phase !== 'done') return phase;
  }
  return results.length === 0 ? 'judging' : 'done';
}

export type JudgingPhaseLabelKey = 'judging' | 'compiling' | 'compilationFailed' | 'evaluating' | 'scoring' | 'done';

export function judgingPhaseLabelKey(phase: SubmissionJudgingPhase): JudgingPhaseLabelKey {
  switch (phase) {
    case 'judging':
      return 'judging';
    case 'compiling':
      return 'compiling';
    case 'compilation-failed':
      return 'compilationFailed';
    case 'evaluating':
      return 'evaluating';
    case 'scoring':
      return 'scoring';
    case 'done':
      return 'done';
  }
}

export function judgedTotalScore(results: readonly { readonly score: number | null }[]): number | null {
  if (results.length === 0) return null;
  let total = 0;
  for (const result of results) {
    if (result.score === null) return null;
    total += result.score;
  }
  return total;
}
