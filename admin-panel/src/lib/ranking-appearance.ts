/**
 * The wording side of the scoreboard settings: which contest the board names, and the
 * explicit override for its header.
 *
 * WHY these live outside the action module: the action file is `'use server'`, so it may only
 * export async functions, and the mapping from a stored row to the operator's words is pure
 * data shaping worth testing on its own.
 */
import type { Prisma } from '@prisma/client';

/** The parts of the appearance a wording override is built from. */
export interface WordingFields {
  /** The contest the board serves, as the form holds it: a string, empty when none is named. */
  readonly contestId: string;
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

/** A wording entry, or null when the override map holds nothing for that key. */
function wordingEntry(overrides: unknown, contestId: string): Record<string, unknown> | null {
  if (typeof overrides !== 'object' || overrides === null) return null;
  const entry = (overrides as Record<string, unknown>)[contestId];
  return typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : null;
}

/**
 * The operator's words for the named contest.
 *
 * WHY the read is keyed by the named contest: the row names one contest, and reading a flat
 * copy back would show the words written for a contest the board no longer serves — which is
 * how the header came to announce day 1 on a day-2 board.
 */
export function readWording(overrides: unknown, contestId: string): Wording {
  const entry = contestId === '' ? null : wordingEntry(overrides, contestId);
  const read = (field: string): string => {
    const value = entry?.[field];
    return typeof value === 'string' ? value : '';
  };
  return { title: read('title'), subtitle: read('subtitle') };
}

/** The contest id the row names, or null when it names none. */
export function parseContestId(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('the contest must be one from the list');
  }
  return parsed;
}

/** The wording keyed by the contest it is for, or null when the operator wrote none. */
export function wordingOverrides(fields: WordingFields): Prisma.InputJsonValue | null {
  const contestId = parseContestId(fields.contestId);
  const title = fields.title.trim();
  const subtitle = fields.subtitle.trim();
  if (contestId === null || (title === '' && subtitle === '')) return null;
  return { [String(contestId)]: { title, subtitle } };
}

/**
 * WHY words without a contest are refused rather than dropped: an override is keyed by the
 * contest it describes, so text with no contest named has nowhere to be stored, and storing
 * it flat again is the copy this replaced.
 */
export function assertWordingHasContest(fields: WordingFields, contestId: number | null): void {
  const wrote = fields.title.trim() !== '' || fields.subtitle.trim() !== '';
  if (wrote && contestId === null) {
    throw new Error('name the contest the wording is for');
  }
}
