import type { SubmissionListItem } from '@/types';

/**
 * Resolves the submission a modal should render from the list that is on screen right now.
 *
 * WHY this exists instead of storing the clicked row: recalculateSubmission refreshes the
 * list, so a copy taken when the row was clicked keeps showing the pre-recalculation
 * outcome for as long as the modal stays open. Holding the id instead keeps the modal open
 * across the refresh and re-reads the row, so it shows the current results.
 */
export function selectSubmission<T extends { id: SubmissionListItem['id'] }>(
  submissions: readonly T[],
  id: SubmissionListItem['id'] | null,
): T | null {
  if (id === null) return null;
  return submissions.find((submission) => submission.id === id) ?? null;
}

