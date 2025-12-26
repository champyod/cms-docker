import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

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

  // Check if pathname starts with a locale
  const pathnameIsMissingLocale = ["/en", "/th"].every(
    (locale) => !pathname.startsWith(locale) && pathname !== locale
  );

  // Redirect if there is no locale
  if (pathnameIsMissingLocale) {
    const locale = "en"; // Default locale
    return NextResponse.redirect(
      new URL(`/${locale}${pathname === "/" ? "" : pathname}`, request.url)
    );
  }
}

export const config = {
  matcher: [
    // Skip all internal paths (_next)
    "/((?!_next|api|favicon.ico).*)",
  ],
};
