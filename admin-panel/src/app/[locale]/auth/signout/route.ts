import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from '@/lib/locales';

function isLocale(value: string): value is Locale {
  return SUPPORTED_LOCALES.some((locale) => locale === value);
}

function resolveLocale(candidate: string): Locale {
  return isLocale(candidate) ? candidate : DEFAULT_LOCALE;
}

// Why: session cookie mutation is only permitted in a Route Handler — doing it while
// rendering a Server Component throws and leaves the session intact.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ locale: string }> },
): Promise<NextResponse> {
  const { locale: candidate } = await params;
  const locale = resolveLocale(candidate);

  (await cookies()).delete('session');

  return NextResponse.redirect(new URL(`/${locale}/auth/login`, request.url));
}
