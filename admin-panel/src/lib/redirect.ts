'use server';

import { headers } from 'next/headers';
import { redirect as nextRedirect } from 'next/navigation';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from '@/lib/locales';

/**
 * Wraps Next.js's raw `redirect()` to always preserve locale in the URL.
 *
 * @param path - Path to redirect to, e.g. "/dashboard" or "/auth/login"
 */
export async function redirect(path: string): Promise<never> {
  const headersList = await headers();

  let locale: Locale = DEFAULT_LOCALE;
  try {
    const referer = headersList.get('referer') ?? '';
    const match = referer.match(new RegExp(`/(${SUPPORTED_LOCALES.join('|')})(/|$)`));
    if (match?.[1] && SUPPORTED_LOCALES.includes(match[1] as Locale)) {
      locale = match[1] as Locale;
    }
  } catch {
    locale = DEFAULT_LOCALE;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  nextRedirect(`/${locale}${normalizedPath}`);
}
