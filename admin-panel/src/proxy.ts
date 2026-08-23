import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "@/lib/locales";

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Skip assets
  if (
    pathname.includes("_next") ||
    pathname.includes("api") ||
    pathname.includes("static") ||
    pathname.includes(".") // Files like favicon.ico
  ) {
    return NextResponse.next();
  }

  const pathnameIsMissingLocale = SUPPORTED_LOCALES.every(
    (locale) => !pathname.startsWith(`/${locale}`) && pathname !== `/${locale}`
  );

  if (pathnameIsMissingLocale) {
    return NextResponse.redirect(
      new URL(`/${DEFAULT_LOCALE}${pathname === "/" ? "" : pathname}`, request.url)
    );
  }
}

export const config = {
  matcher: [
    // Skip all internal paths (_next)
    "/((?!_next|api|favicon.ico).*)",
  ],
};
