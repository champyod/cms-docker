'use server';

import { headers } from 'next/headers';
import { redirect as nextRedirect } from 'next/navigation';
import { DEFAULT_LOCALE, localeFromPath } from '@/lib/locales';

/**
 * Wraps Next.js's raw `redirect()` to always preserve locale in the URL.
 *
 * @param path - Path to redirect to, e.g. "/dashboard" or "/auth/login"
 */
export async function redirect(path: string): Promise<never> {
  const headersList = await headers();

  const locale = localeFromPath(headersList.get('referer') ?? '') ?? DEFAULT_LOCALE;

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  nextRedirect(`/${locale}${normalizedPath}`);
}
