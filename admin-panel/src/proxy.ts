import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withBasePath } from "@/lib/base-path";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "@/lib/locales";
import { slideSessionCookie } from "@/lib/auth";

const BYPASSED_PATH_FRAGMENTS = ["_next", "api", "static", "."];

// Why: these routes own the session cookie themselves, so sliding here would race their
// own Set-Cookie and could hand a disabled admin a fresh token on the signout response
const SESSION_OWNED_PATH_FRAGMENT = "/auth/";

// Why: `/login` is the URL a person types, and it has no route — the page lives at
// `[locale]/auth/login`. This file is what adds the locale prefix, so it is also the one
// place that can correct the target before the redirect leaves the server. Without this the
// browser is sent to `/{locale}/login`, which renders the not-found page.
const AUTH_ALIASES: Record<string, string | undefined> = {
  "/login": "/auth/login",
};

/** The path with any locale prefix removed, so aliases are written once per route and not
 * once per locale. Returns `undefined` for a path nothing aliases. */
function aliasAuthPath(pathname: string): string | undefined {
  const localePrefix = SUPPORTED_LOCALES.map((locale) => `/${locale}`).find(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  const barePath = localePrefix ? pathname.slice(localePrefix.length) || "/" : pathname;
  const alias = AUTH_ALIASES[barePath];
  return alias === undefined ? undefined : `${localePrefix ?? ""}${alias}`;
}

function isBypassedPath(pathname: string): boolean {
  return BYPASSED_PATH_FRAGMENTS.some((fragment) => pathname.includes(fragment));
}

function resolveLocaleRedirect(request: NextRequest): NextResponse | undefined {
  const { pathname, search } = request.nextUrl;
  const hasLocale = SUPPORTED_LOCALES.some(
    (locale) => pathname.startsWith(`/${locale}`) || pathname === `/${locale}`
  );
  const aliasedPath = aliasAuthPath(pathname);
  const target = aliasedPath ?? pathname;
  const isAliased = target !== pathname;
  // An alias is the one case that must redirect even though the path already carries a
  // locale: `/en/login` is localised and still has no route.
  if (hasLocale && !isAliased) return undefined;
  // Why the prefix is applied here: middleware emits the Location header itself, and the
  // framework adds basePath to a redirect it renders, never to one this function returns.
  const localised = hasLocale ? target : `/${DEFAULT_LOCALE}${target === "/" ? "" : target}`;
  return NextResponse.redirect(new URL(`${withBasePath(localised)}${search}`, request.url));
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
