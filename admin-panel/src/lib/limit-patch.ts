import { LIMIT_FIELDS, normalizeLimitValue, type LimitFieldName } from '@/lib/limits';

/**
 * The move a limit write carries: a field's name to the value it sets — a positive whole number
 * (a limit) or an explicit null (no limit, i.e. a clear). A field the patch does not name is left
 * exactly as it is on the target.
 *
 * Why one alias for both kinds: contests and tasks name the six limit fields identically, so one
 * route-side gate can serve both batch endpoints, and a second copy would drift from the column
 * list the SQL writes.
 */
export type LimitPatch = Partial<Record<LimitFieldName, number | null>>;

/**
 * The gate between a raw JSON patch and a limit write.
 *
 * Why it exists: a batch body is arbitrary, and without a whitelist it could name any column or
 * carry the literal 0 the database CHECK (`max_submission_number > 0`) refuses. This keeps an
 * explicit null (the operator's clear), drops undefined (leave alone), and sends everything else
 * through the shared limit rule, so a 0, a blank or a negative can never reach a CHECK.
 *
 * It answers null when the body names no limit field at all, so a caller refuses an empty or
 * unrelated patch instead of writing nothing and reporting success.
 */
export function pickLimitPatch(raw: unknown): LimitPatch | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const patch: LimitPatch = {};

  for (const field of LIMIT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(source, field)) continue;
    const value = source[field];
    if (value === undefined) continue;
    patch[field] = value === null ? null : normalizeLimitValue(value);
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * A patch that names every limit field with an explicit null — the seed an editor that must show
 * all six uses, so the operator sees the fields to set. Paired with `initiallyTouched: false` it
 * sends nothing until a field is actually set or cleared.
 */
export function unsetLimitPatch(): LimitPatch {
  return Object.fromEntries(LIMIT_FIELDS.map((field) => [field, null])) as LimitPatch;
}
