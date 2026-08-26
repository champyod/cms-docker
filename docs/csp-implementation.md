# Content Security Policy (CSP) Implementation Guide

> **Status: DOCUMENTED ONLY — not deployed in Batch 1-4.**
> This guide covers the planned Phase 2 CSP rollout. No runtime changes
> are active until explicitly enabled in a future batch.

---

## 1. Overview

Content Security Policy restricts which resources the browser may load,
mitigating XSS, data-injection, and clickjacking attacks. CMS Admin Panel
runs Next.js 16 with React 19 Server Components, so the CSP strategy must
account for server-rendered HTML and hydration scripts.

## 2. Approach: Nonce-Based CSP

Nonce-based CSP is preferred over hash-based for Next.js because:

- Next.js injects inline scripts for hydration, routing, and error overlays.
  Hashes change on every build, making hash-based CSP impractical.
- A per-request cryptographic nonce (`'nonce-{random}'`) allows only
  scripts styled with that nonce to execute.

### How It Works

1. Middleware generates a random nonce per HTTP request.
2. The nonce is attached to `<script>` tags rendered by Next.js.
3. The `Content-Security-Policy` response header includes
   `'nonce-{nonce}'` in `script-src`.
4. Browsers reject any inline script lacking the matching nonce.

## 3. Next.js 16 Middleware Integration

### Step 1: Create a CSP middleware

```typescript
// middleware.ts (project root)
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { randomBytes } from 'crypto';

export function middleware(request: NextRequest) {
  const nonce = randomBytes(16).toString('base64');
  const cspHeader = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');

  const response = NextResponse.next();
  response.headers.set('Content-Security-Policy', cspHeader);
  // Pass nonce to the rendering layer via request header
  request.headers.set('x-nonce', nonce);
  return response;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
```

### Step 2: Expose nonce to components

```typescript
// lib/csp.ts
import { headers } from 'next/headers';

export async function getNonce(): Promise<string> {
  const headersList = await headers();
  return headersList.get('x-nonce') ?? '';
}
```

### Step 3: Apply nonce in layout

```typescript
// app/[locale]/layout.tsx
import { getNonce } from '@/lib/csp';

export default async function RootLayout({ children }) {
  const nonce = await getNonce();
  return (
    <html lang="en">
      <head>
        {/* Next.js injects nonce on <script> tags automatically when
            the CSP header is set via middleware */}
      </head>
      <body>{children}</body>
    </html>
  );
}
```

## 4. Static CSP via next.config.ts (Alternative)

For environments where middleware overhead is unacceptable, CSP can be
set as a static header in `next.config.ts`:

```typescript
// next.config.ts
import type { NextConfig } from 'next';

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
];

const nextConfig: NextConfig = {
  headers: async () => [
    {
      source: '/(.*)',
      headers: securityHeaders,
    },
  ],
};

export default nextConfig;
```

> **Note:** Static CSP cannot use nonces (no per-request randomness).
> Only use this approach for `'self'`-only policies or when nonce-based
> CSP is not feasible.

## 5. Recommended CSP Directives

| Directive | Value | Purpose |
|-----------|-------|---------|
| `default-src` | `'self'` | Fallback: only same-origin resources |
| `script-src` | `'self' 'nonce-{nonce}' 'strict-dynamic'` | Scripts via nonce; `strict-dynamic` allows trusted scripts to load others |
| `style-src` | `'self' 'unsafe-inline'` | Stylesheets; `unsafe-inline` needed for Tailwind CSS |
| `img-src` | `'self' data: blob:` | Images from same origin, data URIs, blob URLs |
| `font-src` | `'self'` | Fonts from same origin only |
| `connect-src` | `'self'` | XHR/fetch/WebSocket to same origin |
| `frame-ancestors` | `'none'` | Prevent embedding in iframes (clickjacking) |
| `base-uri` | `'self'` | Restrict `<base>` tag |
| `form-action` | `'self'` | Form submissions to same origin only |

## 6. Testing in Staging

### Enable report-only first

Deploy CSP in `Content-Security-Policy-Report-Only` mode to catch violations
without breaking functionality:

```typescript
response.headers.set('Content-Security-Policy-Report-Only', cspHeader);
```

### Add a report endpoint

```typescript
// app/api/csp-report/route.ts
import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  const report = await req.json();
  console.error('[CSP Violation]', report);
  return new Response(null, { status: 204 });
}
```

Add to CSP header:
```
report-uri /api/csp-report; report-to csp-endpoint
```

### Testing checklist

1. Deploy with `Report-Only` header
2. Browse all admin panel pages (dashboard, contests, tasks, settings)
3. Check browser console for CSP violation reports
4. Verify admin panel login flow works (JWT cookie, session)
5. Verify Docker socket operations (containers page)
6. Verify file uploads (task datasets)
7. Once no violations for 48h, switch to enforcing `Content-Security-Policy`

## 7. Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Blank page after deploy | Inline script blocked by CSP | Add nonce or switch to `strict-dynamic` |
| Tailwind styles missing | `style-src` too restrictive | Allow `'unsafe-inline'` for Tailwind |
| Fonts not loading | `font-src` missing external CDN | Add CDN domain or self-host fonts |
| WebSocket blocked | `connect-src` missing WS origin | Add `wss:` to `connect-src` |
| OAuth redirect fails | `form-action` too restrictive | Add OAuth domain or loosen to `'self' https:'` |

## 8. HSTS Ramp Schedule

HTTP Strict Transport Security (HSTS) should be ramped gradually to avoid
breaking access for users who have never visited over HTTPS.

| Phase | `HSTS_MAX_AGE` | Duration | Notes |
|-------|----------------|----------|-------|
| **Staging** | 300 (5 min) | 1 week | Short max-age lets admins test HTTPS without long commitment |
| **Early production** | 86400 (1 day) | 2 weeks | Validates HTTPS works for all endpoints |
| **Standard production** | 2592000 (30 days) | 1 month | Catches most regular visitors |
| **Full production** | 31536000 (1 year) | Permanent | Standard HSTS; submit to HSTS preload list after 30 days at 1 year |

### Preload list submission

After running `HSTS_MAX_AGE=31536000` for 30+ days with `includeSubDomains`,
submit to <https://hstspreload.org>. Note: preload is **irreversible** —
only submit when certain all subdomains support HTTPS.

## 9. Scope

This document covers CSP and HSTS for the CMS Admin Panel (Next.js) only.
Other services (Python admin web server, contest web server, ranking web
server) may need separate CSP policies — those will be documented when
their HTTPS frontends are configured.

---

*This guide is Phase 2 documentation. CSP is not enforced until explicitly
enabled in a future deployment batch.*
