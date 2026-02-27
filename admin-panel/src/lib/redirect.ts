'use server';

import { headers } from 'next/headers';
import { redirect as nextRedirect } from 'next/navigation';

const SUPPORTED_LOCALES = ['en', 'th'] as const;
type Locale = (typeof SUPPORTED_LOCALES)[number];
const DEFAULT_LOCALE: Locale = 'en';

/**
 * Locale-aware redirect helper.
 * Extracts the current locale from the incoming request's referer header,
 * then prepends it to the path before redirecting.
 *
 * Use this everywhere instead of Next.js's raw `redirect()` to ensure locale
 * is always preserved in the URL.
 *
 * @param path - Path to redirect to, e.g. "/dashboard" or "/auth/login"
 */
export async function redirect(path: string): Promise<never> {
  const headersList = await headers();

  // Try to detect current locale from the referer URL
  const referer = headersList.get('referer') ?? '';
  const match = referer.match(/\/(en|th)(\/|$)/);
  const locale: Locale = (match?.[1] as Locale) ?? DEFAULT_LOCALE;

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  nextRedirect(`/${locale}${normalizedPath}`);
}
