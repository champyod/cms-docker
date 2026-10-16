/**
 * The dataset limit pair, and the byte/MiB seam beneath it.
 *
 * Why a module of its own next to the shared family rule in `@/lib/limits`: the two `datasets`
 * columns this lane owns store seconds (a Float, so the classic accepts a fraction) and bytes (a
 * BigInteger whose CHECK demands a whole number of MiB), while every surface an operator touches
 * shows the pair as seconds and MiB. Three callers cross that seam — the datasets routes, the
 * dataset server actions, and the modal — so one copy of the factor is what keeps a stray 1000 and
 * a fractional MiB the CHECK would refuse out of the edit path.
 */
import { normalizePositiveValue } from '@/lib/limits';

export const BYTES_PER_MEBIBYTE = BigInt(1024 * 1024);
export const MAX_TIME_LIMIT_SECONDS = 60;
export const MAX_MEMORY_LIMIT_MB = 4096;

/** A parsed limit: `value === null` is "no limit", and a refusal carries its own message. */
export type ParsedLimit =
  | { readonly ok: true; readonly value: number | null }
  | { readonly ok: false; readonly message: string };

/**
 * Reads the operator's time limit into the number the column holds.
 *
 * Why blank, 0, negative and non-number become null rather than an error: they are the family's
 * "no limit" answers (see normalizePositiveValue), and the column's `time_limit > 0` CHECK can only
 * hold the null. Only a value the column could hold but that the panel caps is refused outright.
 */
export function parseTimeLimit(value: unknown): ParsedLimit {
  const normalized = normalizePositiveValue(value);
  if (normalized === null) return { ok: true, value: null };
  if (normalized > MAX_TIME_LIMIT_SECONDS) {
    return { ok: false, message: `Time limit must be at most ${MAX_TIME_LIMIT_SECONDS} seconds` };
  }
  return { ok: true, value: normalized };
}

/**
 * Reads the operator's memory limit (in MiB) into the whole number of MiB the column can hold.
 *
 * Why a fractional MiB is the one thing refused instead of cleared: the column stores bytes and its
 * CHECK is `MOD(memory_limit, 1048576) = 0`, so 16.5 MiB could be converted but not committed. A
 * 0, a blank and a negative are "no limit" and clear to null; a fraction is a number the operator
 * plainly meant as a limit, so it is answered with a message rather than dropped on the floor.
 */
export function parseMemoryLimitMb(value: unknown): ParsedLimit {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return { ok: true, value: null };
  if (parsed <= 0) return { ok: true, value: null };
  if (!Number.isInteger(parsed)) {
    return { ok: false, message: 'Memory limit must be a whole number of megabytes' };
  }
  if (parsed > MAX_MEMORY_LIMIT_MB) {
    return { ok: false, message: `Memory limit must be at most ${MAX_MEMORY_LIMIT_MB} megabytes` };
  }
  return { ok: true, value: parsed };
}

/** MiB as displayed → the bytes the column stores; null stays null. */
export function mebibytesToBytes(mebibytes: number | null | undefined): bigint | null {
  if (mebibytes === null || mebibytes === undefined) return null;
  if (!Number.isInteger(mebibytes) || mebibytes <= 0) return null;
  return BigInt(mebibytes) * BYTES_PER_MEBIBYTE;
}

/** The stored bytes → the MiB the form shows; null stays null. */
export function bytesToMebibytes(bytes: bigint | number | string | null | undefined): number | null {
  if (bytes === null || bytes === undefined || bytes === '') return null;
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value / Number(BYTES_PER_MEBIBYTE);
}
