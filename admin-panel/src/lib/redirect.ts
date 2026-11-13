'use server';

import { headers } from 'next/headers';
import { redirect as nextRedirect } from 'next/navigation';
import { DEFAULT_LOCALE, localeFromPath, type Locale } from '@/lib/locales';

/** Caller's locale from the Referer; the default when there is no request to ask (CLI, build). */
async function callerLocale(): Promise<Locale> {
  try {
    return localeFromPath((await headers()).get('referer') ?? '') ?? DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/**
 * Wraps Next.js's raw `redirect()` to always preserve locale in the URL.
 *
 * @param path - Path to redirect to, e.g. "/dashboard" or "/auth/login"
 */
export async function redirect(path: string): Promise<never> {
  const locale = await callerLocale();

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  nextRedirect(`/${locale}${normalizedPath}`);
}
