export const SUPPORTED_LOCALES = ['en', 'th'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** `/{locale}` followed by a path boundary: a path or a URL both describe where a request is. */
const LOCALE_IN_PATH = new RegExp(`/(${SUPPORTED_LOCALES.join('|')})(/|$)`);

/**
 * The locale a path — or any URL-shaped string that contains one — is served under.
 *
 * WHY it lives here: the redirect wrapper read its locale out of the referer, the proxy prefixes
 * one onto a bare path, and the actorless surface needs the locale of a request it only knows by
 * path. Three copies of the same regex would drift; one does not.
 */
export function localeFromPath(value: string): Locale | undefined {
  const candidate = LOCALE_IN_PATH.exec(value)?.[1];
  return SUPPORTED_LOCALES.includes(candidate as Locale) ? (candidate as Locale) : undefined;
}
