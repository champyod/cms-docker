const INSECURE_VALUES = new Set(['0', 'false', 'no', 'off']);

/** Secure is the default; only an explicit false-like value enables local HTTP sessions. */
export function isSecureCookie(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === undefined || normalized === '' || !INSECURE_VALUES.has(normalized);
}
