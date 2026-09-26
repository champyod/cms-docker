import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "@/lib/locales";
import { slideSessionCookie } from "@/lib/auth";

const BYPASSED_PATH_FRAGMENTS = ["_next", "api", "static", "."];

// Why: these routes own the session cookie themselves, so sliding here would race their
// own Set-Cookie and could hand a disabled admin a fresh token on the signout response
const SESSION_OWNED_PATH_FRAGMENT = "/auth/";

function isBypassedPath(pathname: string): boolean {
  return BYPASSED_PATH_FRAGMENTS.some((fragment) => pathname.includes(fragment));
}

function resolveLocaleRedirect(request: NextRequest): NextResponse | undefined {
  const { pathname, search } = request.nextUrl;
  const hasLocale = SUPPORTED_LOCALES.some(
    (locale) => pathname.startsWith(`/${locale}`) || pathname === `/${locale}`
  );
  if (hasLocale) return undefined;
  const localePath = `/${DEFAULT_LOCALE}${pathname === "/" ? "" : pathname}${search}`;
  return NextResponse.redirect(new URL(localePath, request.url));
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (isBypassedPath(pathname)) {
    return NextResponse.next();
  }

  const localeRedirect = resolveLocaleRedirect(request);
  if (localeRedirect) {
    return localeRedirect;
  }

  const response = NextResponse.next();
  if (!pathname.includes(SESSION_OWNED_PATH_FRAGMENT)) {
    await slideSessionCookie(request, response);
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next|api|favicon.ico).*)",
  ],
};
