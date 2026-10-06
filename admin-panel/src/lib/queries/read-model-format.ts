// Why: ISO strings serialize safely through server action boundaries (Prisma returns Dates).
export function toIsoDate(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Why: normalize interval objects to total-seconds strings; dialogs parse digits, HH:MM:SS, or objects.
export function toIntervalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    const part = value as { days?: unknown; hours?: unknown; minutes?: unknown; seconds?: unknown };
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    return String(num(part.days) * 86400 + num(part.hours) * 3600 + num(part.minutes) * 60 + num(part.seconds));
  }
  return String(value);
}

// Why: interval columns are Unsupported in the generated select types, so a
// typed raw query carries them while the explicit select stays relation-free.
export type IntervalColumns = { token_min_interval: unknown; token_gen_interval: unknown; min_submission_interval: unknown; min_user_test_interval: unknown };

export const NO_INTERVALS: IntervalColumns = { token_min_interval: null, token_gen_interval: null, min_submission_interval: null, min_user_test_interval: null };
