/**
 * The nullable limit family: the six columns whose "no limit" state is stored as NULL.
 *
 * Why one module: contests and tasks name these fields identically, the panel control and the
 * payload both read a blank box or a 0 as "no limit", and the server-side batch lane imports this
 * same rule — a second copy would drift and start storing the 0 that the database CHECK
 * (`max_submission_number > 0`) refuses.
 */
export const LIMIT_FIELDS = [
  'max_submission_number',
  'max_user_test_number',
  'token_max_number',
  'token_gen_max',
  'min_submission_interval',
  'min_user_test_interval',
] as const;

export type LimitFieldName = (typeof LIMIT_FIELDS)[number];

/**
 * The one place a typed limit becomes a stored one.
 *
 * Why blank and 0 are the same answer: they are both how an operator says "no limit" — an empty
 * box or a 0 in it — so both come out as null, which is the only value the columns can hold for
 * "none". A negative or fractional entry is not a limit at all, so it is refused the same way
 * rather than reaching a CHECK constraint or a client that cannot use it.
 */
export function normalizeLimitValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (!Number.isInteger(parsed)) return null;
  if (parsed <= 0) return null;
  return parsed;
}

/**
 * The same rule for a limit the classic stores as a float rather than an integer.
 *
 * Why a second entry point and not a looser normalizeLimitValue: the six columns above are
 * integer-only and a `> 0` CHECK would refuse a fraction that got through, so loosening the family
 * rule would move the rejection from the box to the database. The dataset time limit is a Float and
 * a sub-second limit is a real one, so here a positive fraction is kept, while blank, 0, a negative
 * and a non-number still mean "no limit" — the same reading of a blank box an operator types into.
 */
export function normalizePositiveValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed <= 0) return null;
  return parsed;
}

/**
 * The reading for a stored number whose 0 is a real value and whose blank is a state of its own.
 *
 * Why a third entry point and not a looser member of the family above: the contest throttle delay's
 * 0 means "no throttle delay of my own" and is kept as a 0, so it must not go through
 * normalizeLimitValue (which would turn it into the NULL its NOT NULL column cannot hold). The task
 * override's own blank means "inherit the contest's", which is also NULL, but its 0 means "no delay
 * for this task" — a state normalizeLimitValue would collapse into the inherit. Neither of the two
 * rules above can tell those apart, so this returns a whole non-negative number (0 kept) for a real
 * entry and null only for a blank, a negative or a fraction, leaving the caller to read its null:
 * "inherit" for the task override, "write the column's own 0" for the contest delay.
 */
export function normalizeNonNegativeInt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (!Number.isInteger(parsed)) return null;
  if (parsed < 0) return null;
  return parsed;
}
