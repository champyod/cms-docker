import { NextResponse, type NextRequest } from 'next/server';
import { redirect } from 'next/navigation';
import { deleteSession } from '@/lib/auth';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from '@/lib/locales';

function isLocale(value: string): value is Locale {
  return SUPPORTED_LOCALES.some((locale) => locale === value);
}

function resolveLocale(candidate: string): Locale {
  return isLocale(candidate) ? candidate : DEFAULT_LOCALE;
}

// Why: session cookie mutation is only permitted in a Route Handler — doing it while
// rendering a Server Component throws and leaves the session intact.
// Why a relative redirect: `request.url` is rebuilt from the server's own bind hostname
// rather than the Host header, so anchoring to it leaks the internal origin (e.g. 0.0.0.0:3000)
// into the browser. `redirect()` emits a host-free Location header instead.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ locale: string }> },
): Promise<NextResponse> {
  const { locale: candidate } = await params;
  const locale = resolveLocale(candidate);

  await deleteSession();

  redirect(`/${locale}/auth/login`);
}
