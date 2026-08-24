import bcrypt from 'bcryptjs';

/**
 * Storage mode for credential columns.
 * - `bcrypt`    → `bcrypt:<hash>` (production standard, not revealable)
 * - `plaintext` → `plaintext:<raw>` (revealable in edit forms)
 */
export type PasswordKind = 'bcrypt' | 'plaintext';

/** Default storage mode when a caller omits or sends an invalid `passwordKind`. */
export const DEFAULT_PASSWORD_KIND: PasswordKind = 'bcrypt';

const BCRYPT_PREFIX = 'bcrypt:';
const PLAINTEXT_PREFIX = 'plaintext:';
const BCRYPT_SALT_ROUNDS = 10;

/**
 * Runtime guard for untrusted `passwordKind` input (API bodies, action payloads).
 * Narrows `unknown` to `PasswordKind`; callers fall back to {@link DEFAULT_PASSWORD_KIND}.
 */
export function isPasswordKind(value: unknown): value is PasswordKind {
  return value === 'bcrypt' || value === 'plaintext';
}

/**
 * Formats a raw password into its prefixed storage representation.
 * - `plaintext` → `plaintext:<raw>`
 * - `bcrypt`    → `bcrypt:<hash>` via bcryptjs genSalt/hash at 10 rounds
 *
 * The legacy CMS validator (`cmscommon.crypto.validate_password`) requires the
 * prefix — never persist a raw unprefixed value.
 */
export async function formatStoredPassword(kind: PasswordKind, raw: string): Promise<string> {
  if (kind === 'plaintext') {
    return `${PLAINTEXT_PREFIX}${raw}`;
  }
  const salt = await bcrypt.genSalt(BCRYPT_SALT_ROUNDS);
  const hash = await bcrypt.hash(raw, salt);
  return `${BCRYPT_PREFIX}${hash}`;
}

/**
 * Splits a stored credential into its kind and payload.
 * - `'plaintext:x'` → `{ kind: 'plaintext', value: 'x' }`
 * - `'bcrypt:h'`    → `{ kind: 'bcrypt', value: 'h' }` (hash without prefix)
 * - Legacy no-colon values and null/undefined/empty → `{ kind: 'plaintext', ... }`
 *   (legacy raw values were stored unprefixed; empty means "no password set")
 */
export function parseStoredPassword(stored: string | null | undefined): { kind: PasswordKind; value: string } {
  if (!stored) {
    return { kind: 'plaintext', value: '' };
  }
  if (stored.startsWith(PLAINTEXT_PREFIX)) {
    return { kind: 'plaintext', value: stored.slice(PLAINTEXT_PREFIX.length) };
  }
  if (stored.startsWith(BCRYPT_PREFIX)) {
    return { kind: 'bcrypt', value: stored.slice(BCRYPT_PREFIX.length) };
  }
  return { kind: 'plaintext', value: stored };
}
