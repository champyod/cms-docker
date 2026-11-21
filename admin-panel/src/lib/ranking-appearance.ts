/**
 * The wording side of the scoreboard settings: the explicit override for the header of the contest
 * the board shows.
 *
 * WHY these live outside the action module: the action file is `'use server'`, so it may only
 * export async functions, and the mapping from a stored row to the operator's words is pure
 * data shaping worth testing on its own.
 *
 * WHY the contest is an argument rather than a field of these shapes: the config names which
 * contest the board draws, and the words are keyed by that contest. A shape carrying its own
 * contest id was a second representation of the shown set, which is what this retirement removes.
 */
import type { Prisma } from '@prisma/client';

/** The parts of the appearance a wording override is built from. */
export interface WordingFields {
  readonly title: string;
  readonly subtitle: string;
}

/** One contest's override. A blank title or subtitle means the contest's own word is used. */
// A type alias rather than an interface: an alias carries an implicit index signature, which is
// what lets the map be handed to Prisma as a JSON column.
export type Wording = {
  readonly title: string;
  readonly subtitle: string;
};

/** A wording entry, or null when the override map holds nothing for that contest. */
function wordingEntry(overrides: unknown, contestId: number): Record<string, unknown> | null {
  if (typeof overrides !== 'object' || overrides === null) return null;
  const entry = (overrides as Record<string, unknown>)[String(contestId)];
  return typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : null;
}

/**
 * The operator's words for the contest the board shows.
 *
 * WHY the read is keyed by the shown contest rather than held flat: the config names which contest
 * the board draws, and reading a flat copy back would show the words written for a contest the
 * board no longer serves — which is how the header came to announce day 1 on a day-2 board.
 */
export function readWording(overrides: unknown, contestId: number | null): Wording {
  const entry = contestId === null ? null : wordingEntry(overrides, contestId);
  const read = (field: string): string => {
    const value = entry?.[field];
    return typeof value === 'string' ? value : '';
  };
  return { title: read('title'), subtitle: read('subtitle') };
}

/** The wording keyed by the shown contest, or null when there is no contest to word. */
export function wordingOverrides(
  fields: WordingFields,
  contestId: number | null,
): Prisma.InputJsonValue | null {
  const title = fields.title.trim();
  const subtitle = fields.subtitle.trim();
  if (contestId === null || (title === '' && subtitle === '')) return null;
  return { [String(contestId)]: { title, subtitle } };
}

/**
 * WHY words without a shown contest are refused rather than dropped: an override is keyed by the
 * contest it describes, and the board words a header only for the one contest its config shows, so
 * text with no such contest has nowhere to be stored — storing it flat again is the copy this
 * replaced.
 */
export function assertWordingHasContest(fields: WordingFields, contestId: number | null): void {
  const wrote = fields.title.trim() !== '' || fields.subtitle.trim() !== '';
  if (wrote && contestId === null) {
    throw new Error('show exactly one contest before wording the header');
  }
}
