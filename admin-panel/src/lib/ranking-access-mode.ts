export const ACCESS_MODE_PUBLIC = 'public';
export const ACCESS_MODE_PROTECTED = 'protected';

export const ACCESS_MODES = [ACCESS_MODE_PUBLIC, ACCESS_MODE_PROTECTED] as const;

export type AccessMode = (typeof ACCESS_MODES)[number];

/** Unknown values are rejected at the write boundary; the reader treats them as protected. */
export function isAccessMode(value: unknown): value is AccessMode {
  return value === ACCESS_MODE_PUBLIC || value === ACCESS_MODE_PROTECTED;
}
