# CLAUDE.md - CMS Docker Admin Panel

> **System Architecture Guide for AI-Assisted Development**
>
> **Project**: CMS Docker (Competitive Management System)
> **Stack**: Next.js 16, Bun, Tailwind CSS v4, React 19, Prisma 6, Python (CMS core)
> **Purpose**: Admin UI for managing competitive programming contests on top of CMS

---

## TABLE OF CONTENTS

1. [Non-Negotiable Laws](#non-negotiable-laws)
2. [Architecture Overview](#architecture-overview)
3. [Naming Conventions](#naming-conventions)
4. [Locale & Routing Pattern](#locale--routing-pattern)
5. [Translation Pattern](#translation-pattern)
6. [API Pattern](#api-pattern)
7. [Server Actions Pattern](#server-actions-pattern)
8. [Component Pattern](#component-pattern)
9. [Authentication & Permissions](#authentication--permissions)
10. [State Management Pattern](#state-management-pattern)
11. [Styling & Design System](#styling--design-system)
12. [Memory Leak Prevention & useEffect Rules](#memory-leak-prevention--useeffect-rules)
13. [Single Responsibility Principle](#single-responsibility-principle)
14. [Comment Policy](#comment-policy)
15. [Security Policies](#security-policies)
16. [Docker & Infrastructure](#docker--infrastructure)
17. [Database & Prisma](#database--prisma)
18. [Python CMS Layer](#python-cms-layer)
19. [Environment Variables](#environment-variables)
20. [Directory Structure](#directory-structure)
21. [Common Tasks](#common-tasks)
22. [Troubleshooting](#troubleshooting)

---

## NON-NEGOTIABLE LAWS

1. **SERVER-FIRST**: Prefer Server Components and Server Actions over client-side state. Only use `'use client'` when interactivity is required.

2. **PERMISSION ENFORCEMENT IS SERVER-SIDE**: Every API route uses `verifyApiPermission()`. Every Server Action uses `ensurePermission()`. Client-side permission checks are UX hints only, never security boundaries.

3. **NO HARDCODED LOCALE**: All links, redirects, and navigation MUST use dynamic `locale`. Never write `/en/...` literally in code. Use the `locale` prop, `usePathname()`, or `params.locale`.

4. **SINGLE RESPONSIBILITY**: Every function does exactly 1 thing. If you cannot name it without "and", split it. Max ~30 lines per function.

5. **FULL-STACK CONSISTENCY**: Every data-structure change MUST be updated in:
   - Prisma Schema
   - API Routes (if applicable)
   - Server Actions (if applicable)
   - TypeScript Types
   - Frontend Components
   Constraints (required/optional) MUST match 1:1 across all layers.

6. **SYSTEM-WIDE IMPACT**: When changing a shared utility, hook, type, or lib function, search and update ALL files that use that symbol. Do not leave old patterns behind.

7. **IMMUTABLE SUBMISSIONS**: Never allow editing submission data. Submissions are append-only for data integrity.

8. **NO SECRETS IN CLIENT CODE**: Never expose database credentials, API keys, or internal tokens to the browser. Only `NEXT_PUBLIC_` prefixed vars reach the client.

9. **DOCKER SOCKET = ROOT**: Any code touching Docker (container control, service restart) MUST require `permission_all` (superadmin only).

10. **PASSWORD STORAGE FORMAT**: Passwords use `bcrypt:<hash>` or `plaintext:<value>` prefix. Never store raw hashes without prefix. All new passwords MUST use bcrypt.

11. **REVALIDATE AFTER MUTATION**: Every Server Action that writes data MUST call `revalidatePath()` to keep the UI consistent.

12. **AFFECTED PART ANALYSIS**: Before finishing a task, search and fix ALL impacted files (not just the obvious ones).

---

## ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────────┐
│                    Admin Panel                       │
│  (Next.js 16 / React 19 / Prisma 6 / Bun)          │
│                                                      │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────┐  │
│  │ Server Comps │  │ Server Actions│  │ API Routes│  │
│  │ (pages)      │  │ (mutations)   │  │ (REST)    │  │
│  └──────┬───────┘  └───────┬───────┘  └─────┬────┘  │
│         │                  │                 │       │
│         └──────────┬───────┘─────────────────┘       │
│                    │                                  │
│              ┌─────▼─────┐    ┌──────────────────┐   │
│              │  Prisma    │    │  Docker Socket    │   │
│              │  (ORM)     │    │  (container ctl)  │   │
│              └─────┬──────┘    └────────┬─────────┘   │
└────────────────────┼───────────────────┼─────────────┘
                     │                   │
              ┌──────▼──────┐    ┌───────▼────────┐
              │ PostgreSQL  │    │ Docker Engine   │
              │ (CMS DB)    │    │ (all services)  │
              └─────────────┘    └────────────────┘

Docker Stacks:
  Core:    database, log-service, resource-service, scoring, evaluation, proxy, checker
  Admin:   admin-panel-next, admin-web-server (Python), ranking-web-server
  Contest: contest-web-server-{id} (per contest)
  Worker:  worker-{N} (sandboxed evaluation)
  Monitor: cms-monitor (backups, health)
```

---

## NAMING CONVENTIONS

### Variable Names

| Concept | Variable Name | NEVER Use |
|---------|--------------|-----------|
| Translation dictionary | `dict` | `t`, `content`, `translations` |
| Current locale | `locale` (from params or pathname) | `lang`, `language` |
| Prisma client | `prisma` | `db`, `client` |
| API response check | `result.success` | `result.ok`, `result.status` |
| Loading state | `loading` | `isLoading`, `fetching` |
| Form data object | `formData` | `data`, `form`, `values` |
| Permission type | `permission` | `perm`, `role`, `access` |
| Toast provider | `addToast` | `toast`, `notify` |

### File Naming

| Type | Pattern | Example |
|------|---------|---------|
| Component | `PascalCase.tsx` | `ContestModal.tsx` |
| Server Action | `kebab-case.ts` | `contests.ts` |
| API Route | `route.ts` | `app/api/contests/route.ts` |
| Library | `camelCase.ts` | `apiClient.ts` |
| Types | `kebab-case.ts` in `types/` | `types/index.ts` |
| Utility | `kebab-case.ts` | `api-utils.ts` |

### Function Naming

| Type | Pattern | Example |
|------|---------|---------|
| Server Action | `verbNoun` | `getContests()`, `createUser()`, `switchContest()` |
| API permission | `verifyApiPermission` | `verifyApiPermission('contests')` |
| Server permission | `ensurePermission` | `ensurePermission('tasks')` |
| Client API call | `apiClient.verb` | `apiClient.post('/api/users', data)` |
| Event handler | `handleVerb` | `handleSubmit()`, `handleDelete()` |
| Format helper | `formatNoun` | `formatDateForInput()` |
| Parse helper | `parseNoun` | `parseInterval()` |

### Import Order

```typescript
// 1. React/Next.js
import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';

// 2. Third-party
import { Loader2, Settings } from 'lucide-react';

// 3. Internal lib (actions, utils, types)
import { getContests } from '@/app/actions/contests';
import { apiClient } from '@/lib/apiClient';
import { prisma } from '@/lib/prisma';

// 4. Internal components
import { Card } from '@/components/core/Card';
import { Button } from '@/components/core/Button';
import { ContestModal } from './ContestModal';
```

---

## LOCALE & ROUTING PATTERN

### URL Structure

All routes are prefixed with a locale segment: `/{locale}/...`

```
/en/contests       /th/contests
/en/tasks/123      /th/tasks/123
/en/auth/login     /th/auth/login
```

Supported locales: `en` (default), `th`

### Route Groups

```
app/[locale]/
├── auth/                      # Public auth routes
│   ├── login/page.tsx
│   └── signout/page.tsx
└── (authenticated)/           # Protected routes (layout checks session)
    ├── page.tsx               # Dashboard
    ├── contests/page.tsx
    ├── tasks/page.tsx
    ├── users/page.tsx
    └── settings/page.tsx
```

### Getting Locale

**Server Components (pages)** - from `params`:
```typescript
export default async function Page({ params: { locale } }: { params: { locale: string } }) {
  const dict = await getDictionary(locale);
}
```

**Client Components** - from `usePathname()`:
```typescript
const pathname = usePathname();
const locale = pathname.split('/')[1] || 'en';
```

**Components receiving locale as prop** (e.g., Sidebar):
```typescript
export const Sidebar: React.FC<{ locale: string }> = ({ locale }) => {
  // Use locale directly
  <Link href={`/${locale}/contests`}>
};
```

**Server Actions (redirects)** - use root paths, let middleware handle locale:
```typescript
redirect('/');              // NOT redirect('/en')
redirect('/auth/login');    // NOT redirect('/en/auth/login')
```

### Navigation Rules

```typescript
// Server Components — use locale from params
<Link href={`/${locale}/tasks`}>Tasks</Link>

// Client Components — extract from pathname
const pathname = usePathname();
const locale = pathname.split('/')[1] || 'en';
<Link href={`/${locale}/docs#users`}>Help</Link>

// Programmatic navigation (client)
const router = useRouter();
const locale = window.location.pathname.split('/')[1] || 'en';
router.push(`/${locale}/search?q=${encodeURIComponent(query)}`);

// NEVER hardcode locale
// ❌ <Link href="/en/tasks">
// ❌ redirect("/en/auth/login")
// ✅ <Link href={`/${locale}/tasks`}>
// ✅ redirect("/auth/login")
```

---

## TRANSLATION PATTERN

### Dictionary System (Server-Side)

Translations live in JSON files loaded via `getDictionary()`.

```typescript
// src/i18n.ts
import 'server-only';

const dictionaries = {
  en: () => import('./dictionaries/en.json').then(m => m.default),
  th: () => import('./dictionaries/th.json').then(m => m.default),
};

export const getDictionary = async (locale: string) => {
  if (dictionaries[locale as keyof typeof dictionaries]) {
    return dictionaries[locale as keyof typeof dictionaries]();
  }
  return dictionaries['en']();
};
```

### Usage in Server Components (Pages)

```typescript
export default async function ContestsPage({ params: { locale } }) {
  const dict = await getDictionary(locale);
  return <h1>{dict.contests.title}</h1>;
}
```

### Client Components

Client components receive translated text via props from Server Components, or use static strings when appropriate for admin-only UI.

### Adding New Translations

1. Add key to `src/dictionaries/en.json`
2. Add matching key to `src/dictionaries/th.json`
3. Use via `dict.section.key` in Server Components

---

## API PATTERN

### Route Structure

```
/api/[resource]/route.ts        # GET (list), POST (create)
/api/[resource]/[id]/route.ts   # GET (read), PUT (update), DELETE
```

### API Route Template

```typescript
// app/api/contests/route.ts
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiSuccess, apiError, sanitize } from '@/lib/api-utils';

export async function GET(req: NextRequest) {
  const { authorized, response } = await verifyApiPermission('contests');
  if (!authorized) return response;

  try {
    const contests = await prisma.contests.findMany({ orderBy: { id: 'desc' } });
    return apiSuccess({ contests });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: NextRequest) {
  const { authorized, response } = await verifyApiPermission('contests');
  if (!authorized) return response;

  try {
    const data = await req.json();
    const contest = await prisma.contests.create({ data: { ... } });
    revalidatePath('/[locale]/contests', 'page');
    return apiSuccess({ contest });
  } catch (error) {
    return apiError(error);
  }
}
```

### API Utilities (`lib/api-utils.ts`)

```typescript
verifyApiPermission(permission)  // Check session + permission, return { authorized, response/session }
verifyApiAuth()                  // Check session only (no permission check)
apiSuccess(data?)                // → { success: true, ...data }
apiError(error)                  // → { success: false, error: message }
sanitize(value)                  // Clean undefined/null/'$undefined'/empty strings → null
```

### Client-Side API Calls (`lib/apiClient.ts`)

```typescript
import { apiClient } from '@/lib/apiClient';

// Usage in client components
const result = await apiClient.post('/api/contests', payload);
if (result.success) {
  addToast({ type: 'success', title: 'Created', message: '...' });
  onSuccess();
} else {
  addToast({ type: 'error', title: 'Error', message: result.error });
}
```

### Response Format

```typescript
// Success
{ success: true, contests: [...] }
{ success: true, user: {...} }

// Error
{ success: false, error: "Missing contests permission" }
```

---

## SERVER ACTIONS PATTERN

### Rules

1. Always declare with `'use server'` at file top
2. Always call `ensurePermission()` as first line for protected actions
3. Always call `revalidatePath()` after mutations
4. Return plain JSON-serializable objects
5. Never throw to the client — catch and return `{ success: false, error }`

### Template

```typescript
// app/actions/contests.ts
'use server';

import { prisma } from '@/lib/prisma';
import { ensurePermission } from '@/lib/permissions';
import { revalidatePath } from 'next/cache';

export async function getContests({ page = 1, search = '' }) {
  const skip = (page - 1) * 20;
  const where = search ? { name: { contains: search, mode: 'insensitive' } } : {};

  const [contests, total] = await Promise.all([
    prisma.contests.findMany({ where, skip, take: 20, orderBy: { id: 'desc' } }),
    prisma.contests.count({ where }),
  ]);

  return { contests, totalPages: Math.ceil(total / 20), total };
}

export async function deleteContest(id: number) {
  await ensurePermission('contests');
  try {
    await prisma.contests.delete({ where: { id } });
    revalidatePath('/[locale]/contests');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
```

---

## COMPONENT PATTERN

### Layer Separation

```
components/
├── core/        # Reusable UI primitives (Button, Card, Input, Modal, Table, Toast)
├── layout/      # App chrome (Sidebar, Header, HeaderSearch)
├── providers/   # Context providers (ToastProvider)
└── [domain]/    # Domain components (ContestList, ContestModal, UserModal, etc.)
```

### Core Components — Dumb, Reusable

Core components accept props and emit events. No business logic. No API calls.

```typescript
// components/core/Button.tsx
interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  // ...
}
```

### Domain Components — Feature-Specific

Domain components handle feature UI, call `apiClient` or Server Actions, and manage local state.

```typescript
// components/contests/ContestList.tsx
'use client';

export function ContestList({ initialContests, totalPages }) {
  const [contests] = useState(initialContests);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const pathname = usePathname();
  const locale = pathname.split('/')[1] || 'en';
  // ...
}
```

### Page Components — Server Components (Default)

Pages are async Server Components that fetch data and render domain components.

```typescript
// app/[locale]/(authenticated)/contests/page.tsx
export default async function ContestsPage({ params: { locale } }) {
  const dict = await getDictionary(locale);
  const data = await getContests({ page: 1 });

  return (
    <div>
      <h1>{dict.contests.title}</h1>
      <ContestList initialContests={data.contests} totalPages={data.totalPages} />
    </div>
  );
}
```

---

## AUTHENTICATION & PERMISSIONS

### Authentication Flow

1. User submits credentials → `login()` Server Action
2. Action queries `admins` table via Prisma
3. Password verified: `plaintext:` → `timingSafeEqual`, `bcrypt:` → `bcrypt.compare`
4. JWT created with `jose` (HS256, 2h expiry) containing `{ userId, username, permissions }`
5. JWT stored in HTTP-only cookie (`session`), 7-day expiry
6. Session read via `getSession()` → `decrypt()` → JWT payload

### Permission Types

```typescript
type Permission = 'all' | 'tasks' | 'users' | 'contests' | 'messaging';
```

- `permission_all` (superadmin) — bypasses all checks, required for Docker/infra operations
- `permission_tasks` — manage tasks, datasets, testcases
- `permission_users` — manage users, teams, participations
- `permission_contests` — manage contests, switch active contest
- `permission_messaging` — manage questions/announcements

### Where Permissions Are Checked

| Layer | Function | Purpose |
|-------|----------|---------|
| API Routes | `verifyApiPermission('contests')` | Returns 401/403 response |
| Server Actions | `ensurePermission('tasks')` | Throws error if unauthorized |
| Pages | `checkPermission('users')` | Redirects to login if unauthorized |
| Sidebar (client) | `permissions?.permission_tasks` | Hides nav links (UX only) |

### Rules

- Server-side checks are the security boundary. Client-side checks are UX convenience.
- Always check permissions before any data mutation.
- `permission_all` is required for: container control, service restart, env editing, admin management.

---

## STATE MANAGEMENT PATTERN

### When to Use What

| Data Type | Tool | Location |
|-----------|------|----------|
| Server data (DB queries) | Server Components + Prisma | Pages (async) |
| Mutations | Server Actions or API Routes | `app/actions/`, `app/api/` |
| Client interactions | `apiClient` + `useState` | Domain components |
| Form input | `useState` per field or form object | Modal components |
| Notifications | `ToastProvider` context | `useToast()` hook |
| Simple UI state | `useState` | Component-local |

### No Global State Library

This project uses Next.js Server Components as the primary data layer. There is no Redux, Zustand, or SWR. Data flows:

1. **Server Component** fetches from Prisma → passes as props to Client Component
2. **Client Component** calls `apiClient` for mutations → calls `router.refresh()` or `window.location.reload()` to refetch

### Toast Pattern

```typescript
const { addToast } = useToast();

addToast({
  type: 'success' | 'error' | 'warning' | 'info',
  title: 'Contest Created',
  message: 'Successfully created contest "IOI-2025"',
  duration: 5000,       // ms, or Infinity for persistent
});
```

---

## STYLING & DESIGN SYSTEM

### Design Language: Glassmorphism

The admin panel uses a dark glassmorphic design. Key patterns:

```css
/* Glass card */
bg-white/10 backdrop-blur-xl border border-white/10 rounded-2xl

/* Glass input */
bg-black/40 border border-white/5 rounded-xl text-white

/* Accent colors */
indigo-500/20 text-indigo-400     /* Primary accent */
emerald-500/20 text-emerald-400   /* Success */
red-500/20 text-red-400           /* Danger */
amber-500/20 text-amber-400       /* Warning */
cyan-500/20 text-cyan-400         /* Info */

/* Shadows */
shadow-lg shadow-indigo-500/20
shadow-lg shadow-indigo-900/20
```

### Tailwind CSS v4

- Config via CSS `@import 'tailwindcss'` (not `tailwind.config.ts`)
- PostCSS with `@tailwindcss/postcss`
- Use `cn()` from `clsx` + `tailwind-merge` for conditional classes

### Rules

```typescript
// ✅ Use Tailwind utility classes
className="bg-white/10 backdrop-blur-xl border border-white/10 rounded-2xl p-6"

// ✅ Use cn() for conditionals
className={cn("px-4 py-2 rounded-xl", isActive && "bg-indigo-500/20 text-indigo-400")}

// ❌ Never use template literals for className
className={`px-4 py-2 ${isActive ? 'bg-indigo-500' : ''}`}

// ❌ Never use inline style objects for things Tailwind handles
style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
```

---

## MEMORY LEAK PREVENTION & useEffect RULES

### Rule 1: Every Timer Must Be Cleaned Up

```typescript
// ✅ CORRECT
useEffect(() => {
  const interval = setInterval(pollData, 30000);
  return () => clearInterval(interval);
}, []);

// ❌ WRONG — timer leaks on unmount
useEffect(() => {
  setInterval(pollData, 30000);
}, []);
```

### Rule 2: Use Refs for Values Referenced in Effects (Avoid Dependency Loops)

```typescript
// ✅ CORRECT — ref doesn't trigger re-render or re-subscribe
const lastCheckRef = useRef(Date.now());

useEffect(() => {
  const check = async () => {
    if (newTime > lastCheckRef.current) {
      lastCheckRef.current = Date.now();
    }
  };
  const id = setInterval(check, 30000);
  return () => clearInterval(id);
}, []); // stable deps

// ❌ WRONG — state in deps causes infinite re-subscribe
const [lastCheck, setLastCheck] = useState(Date.now());
useEffect(() => { ... }, [lastCheck]); // re-runs every time
```

### Rule 3: Never Use useEffect for Derived State

```typescript
// ❌ WRONG
const [fullName, setFullName] = useState('');
useEffect(() => { setFullName(`${first} ${last}`); }, [first, last]);

// ✅ CORRECT — derive during render
const fullName = `${first} ${last}`;
```

### Rule 4: Never Use useEffect for Event-Driven Logic

```typescript
// ❌ WRONG — useEffect as proxy for event
useEffect(() => { if (submitted) sendToAPI(data); }, [submitted]);

// ✅ CORRECT — handle in the event handler
const handleSubmit = async () => { await sendToAPI(data); };
```

### Rule 5: Abort Fetch on Unmount

```typescript
useEffect(() => {
  const controller = new AbortController();
  fetch('/api/data', { signal: controller.signal }).then(setData);
  return () => controller.abort();
}, []);
```

### Memory Leak Checklist

- [ ] Every `setInterval` / `setTimeout` has `clearInterval` / `clearTimeout` in cleanup
- [ ] Every `addEventListener` has `removeEventListener` in cleanup
- [ ] Polling effects use `useRef` for mutable state, not `useState` in deps
- [ ] No `setState` after unmount (use abort controllers)
- [ ] No `useEffect` for derived state or event handling

---

## SINGLE RESPONSIBILITY PRINCIPLE

### Rules

1. **1 function = 1 thing.** If it does 2+ operations, split.
2. **Name describes the single thing.** If you need "and" in the name, split.
3. **Max ~30 lines per function.** Extract sub-functions for readability.
4. **Components render 1 concept.** A `ContestList` renders the list, not list + modal + toast.

### Where to Put Reusable Logic

| Logic Type | Location |
|------------|----------|
| API permission checks | `lib/api-utils.ts` |
| Session/auth | `lib/auth.ts` |
| Permission logic | `lib/permissions.ts` |
| Prisma queries | `app/actions/*.ts` |
| Client HTTP | `lib/apiClient.ts` |
| Interval parsing | Inline helper in component (or extract if used in 2+ places) |

---

## COMMENT POLICY

### Rules

1. **NO explanatory comments** — code should be self-documenting via naming
2. **Section markers OK** — `{/* GENERAL TAB */}`, `{/* Footer */}`
3. **NO TODO comments in committed code** — track in issues
4. **NO commented-out code** — delete it, git has history
5. **NO JSDoc on obvious internal functions**

### Allowed

```typescript
{/* Stats Grid */}
{/* Access Control Tab */}
// Helper to parse Postgres intervals
```

### Not Allowed

```typescript
// ❌ This function gets the list of contests from the database
// ❌ TODO: fix this later
// ❌ // const oldCode = something;
// ❌ // router.push(`/[locale]/tasks?search=${searchQuery}`);
```

---

## SECURITY POLICIES

### Password Handling

```typescript
// Storage format
"plaintext:admin"        // Only for seed/dev — constant-time comparison
"bcrypt:$2a$10$..."     // Production standard

// New passwords MUST use bcrypt
const salt = await bcrypt.genSalt(10);
const hash = await bcrypt.hash(password, salt);
const stored = `bcrypt:${hash}`;

// Verification
if (stored.startsWith('plaintext:')) {
  // timingSafeEqual comparison
} else {
  // bcrypt.compare (strip 'bcrypt:' prefix if present)
}
```

### Session Security

- JWT signed with `AUTH_SECRET` (HS256)
- HTTP-only cookie (no JS access)
- `secure: true` in production
- `sameSite: lax`
- 7-day cookie expiry, 2-hour JWT expiry
- Random secret generated if `AUTH_SECRET` not set (sessions won't persist across restarts)

### Input Validation

- `sanitize()` in `api-utils.ts` for cleaning API inputs
- Name format validation (regex) in modals before submission
- Prisma handles SQL injection prevention via parameterized queries

### Docker Socket Security

The admin panel mounts `/var/run/docker.sock`. All Docker operations (`getContainers`, `controlContainer`, `restartServices`) require `permission_all`.

### Security Checklist

- [ ] All API routes call `verifyApiPermission()` before processing
- [ ] All Server Actions call `ensurePermission()` before mutations
- [ ] New passwords use `bcrypt:` prefix
- [ ] No secrets in `NEXT_PUBLIC_` env vars
- [ ] Docker operations require `permission_all`
- [ ] User input validated before database writes
- [ ] Redirects use root paths (not hardcoded locale)

---

## DOCKER & INFRASTRUCTURE

### Multi-Stack Architecture

```
docker-compose.core.yml              # DB, RPC services, evaluation
docker-compose.admin.yml             # Admin panel (Next.js + Python)
docker-compose.contests.generated.yml # Per-contest web servers (generated)
docker-compose.worker.yml            # Sandboxed workers
docker-compose.monitor.yml           # Backups, health monitoring
```

### Makefile Targets

```bash
make env           # Generate .env, cms.toml, admin-panel/.env
make core          # Deploy core stack (source build)
make core-img      # Deploy core stack (pre-built images)
make admin         # Deploy admin panel
make contest       # Deploy contest interfaces
make worker        # Deploy workers
make admin-create  # Create superadmin account interactively
make prisma-sync   # Sync Prisma schema to DB
make db-clean      # Reset everything (destructive)
```

**IMPORTANT: Production Deployment**

For production/final server deployments, **always use the `-img` variants**:
- `make core-img` instead of `make core`
- Pre-built images are faster and more reliable for production
- Source builds (`make core`) are primarily for development

Deployment workflow:
```bash
# 1. Pull latest changes
git pull origin main

# 2. Regenerate environment files
make env

# 3. Deploy with pre-built images (production)
make core-img      # Use -img variant for production
make admin
make contest
make worker

# 4. Sync database if schema changed
make prisma-sync
```

### Admin Panel Docker Integration

The admin panel can:
- **List/control containers** via Docker socket mount
- **Edit .env files** on host via `/repo-root` mount
- **Restart services** via `docker compose` commands
- **Switch active contest** by editing `.env.contest` and rebuilding

---

## DATABASE & PRISMA

### Schema Location

`admin-panel/prisma/schema.prisma`

### Key Models

| Model | Purpose |
|-------|---------|
| `admins` | Admin accounts with granular permissions |
| `contests` | Contest configuration (times, tokens, limits) |
| `tasks` | Problem definitions with submission format |
| `datasets` | Test data with time/memory limits |
| `testcases` | Individual test cases (input/output as fsobjects) |
| `users` | Contestant accounts |
| `participations` | User ↔ Contest enrollment |
| `submissions` | Code submissions with results |
| `fsobjects` | File storage via PostgreSQL Large Objects |

### Interval Fields

PostgreSQL `interval` type is returned by Prisma as objects or strings. Use `parseInterval()` helper:

```typescript
const parseInterval = (val: any): number => {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    if (/^\d+$/.test(val)) return parseInt(val);
    const parts = val.split(':').map(Number);
    if (parts.length === 3 && parts.every(n => !isNaN(n))) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return 0;
  }
  if (typeof val === 'object') {
    let total = 0;
    if (val.days !== undefined) total += val.days * 24 * 3600;
    if (val.hours !== undefined) total += val.hours * 3600;
    if (val.minutes !== undefined) total += val.minutes * 60;
    if (val.seconds !== undefined) total += val.seconds;
    return total;
  }
  return 0;
};
```

### Prisma Commands

```bash
cd admin-panel
bun x prisma@6 db push      # Push schema to DB
bun x prisma@6 generate      # Regenerate client
bun x prisma@6 studio        # Visual DB browser
```

---

## PYTHON CMS LAYER

### Overview

The Python CMS core (`/src/cms/`) handles:
- **Contest/task management** via Tornado web servers
- **Submission evaluation** via sandboxed workers
- **Scoring** via scoring service
- **Resource management** (file storage)

### Key Entry Points

```bash
cmsLogService          # Central logging RPC
cmsScoringService      # Score calculation
cmsEvaluationService   # Submission queue management
cmsWorker              # Sandboxed evaluation
cmsContestWebServer    # Contestant-facing web UI
cmsAdminWebServer      # Legacy Python admin (being replaced by Next.js)
cmsRankingWebServer    # Live ranking display
cmsAddAdmin            # CLI: create admin account
cmsImportContest       # CLI: import contest from directory
```

### Python Style

- PEP 8 compliance
- PEP 484 type annotations where possible
- SQLAlchemy 1.3 ORM for database access
- Tornado 4.5 for async web serving
- gevent for cooperative multitasking

### When Python Code Changes

If you modify the CMS Python source:
1. Rebuild the affected Docker image
2. Test with `make core` or `make contest`
3. Ensure database migrations are handled

---

## ENVIRONMENT VARIABLES

### Source of Truth: `.env.core`

```bash
POSTGRES_USER=cmsuser
POSTGRES_PASSWORD=YOUR_DB_PASSWORD
POSTGRES_DB=cmsdb
POSTGRES_PORT_EXTERNAL=5432
```

### Admin Panel: `.env.admin`

```bash
ADMIN_NEXT_PORT_EXTERNAL=8891
DEPLOYMENT_TYPE=img|src
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
DISCORD_ROLE_ID=123456789
```

### Generated: `admin-panel/.env`

```bash
DATABASE_URL="postgresql://cmsuser:password@localhost:5432/cmsdb"
AUTH_SECRET=your-secret-here   # Optional, random if missing
```

### Generation Flow

```
.env.core + .env.admin + .env.contest + .env.worker + .env.infra
                    ↓ make env
              .env (combined) + admin-panel/.env + config/cms.toml
```

---

## DIRECTORY STRUCTURE

```
cms-docker/
├── admin-panel/                    # Next.js admin interface
│   ├── prisma/schema.prisma       # Database schema
│   ├── src/
│   │   ├── app/
│   │   │   ├── actions/           # Server Actions
│   │   │   │   ├── auth.ts
│   │   │   │   ├── contests.ts
│   │   │   │   ├── tasks.ts
│   │   │   │   ├── users.ts
│   │   │   │   ├── services.ts    # Docker/infra operations
│   │   │   │   └── env.ts         # .env file management
│   │   │   ├── api/               # REST API routes
│   │   │   │   ├── contests/route.ts
│   │   │   │   ├── tasks/route.ts
│   │   │   │   ├── users/route.ts
│   │   │   │   └── [resource]/[id]/route.ts
│   │   │   └── [locale]/
│   │   │       ├── auth/          # Login/signout
│   │   │       └── (authenticated)/
│   │   │           ├── page.tsx           # Dashboard
│   │   │           ├── contests/page.tsx
│   │   │           ├── tasks/page.tsx
│   │   │           ├── users/page.tsx
│   │   │           ├── teams/page.tsx
│   │   │           ├── submissions/page.tsx
│   │   │           ├── containers/page.tsx
│   │   │           ├── deployments/page.tsx
│   │   │           ├── settings/page.tsx
│   │   │           ├── admins/page.tsx
│   │   │           ├── docs/page.tsx
│   │   │           └── search/page.tsx
│   │   ├── components/
│   │   │   ├── core/              # Button, Card, Input, Modal, Table, Toast
│   │   │   ├── layout/           # Sidebar, Header, HeaderSearch
│   │   │   ├── providers/        # ToastProvider
│   │   │   ├── contests/         # ContestList, ContestModal
│   │   │   ├── tasks/            # TaskModal, TaskDetailView, DatasetModal
│   │   │   ├── users/            # UserList, UserModal
│   │   │   ├── teams/            # TeamList, TeamModal
│   │   │   ├── submissions/      # SubmissionList, SubmissionModal
│   │   │   ├── admins/           # AdminList
│   │   │   └── settings/         # EnvConfigView
│   │   ├── dictionaries/         # en.json, th.json
│   │   ├── i18n.ts               # Dictionary loader
│   │   ├── lib/
│   │   │   ├── auth.ts           # JWT session management
│   │   │   ├── permissions.ts    # Permission checking
│   │   │   ├── api-utils.ts      # API route helpers
│   │   │   ├── apiClient.ts      # Client-side HTTP
│   │   │   ├── prisma.ts         # Prisma client singleton
│   │   │   ├── constants.ts      # Programming languages, etc.
│   │   │   └── utils.ts          # cn() and general utils
│   │   └── types/                # TypeScript type definitions
│   ├── Dockerfile
│   ├── next.config.ts
│   ├── package.json
│   └── tsconfig.json
├── src/                           # Python CMS source
│   └── cms/                      # Core CMS modules
├── scripts/                       # Shell/Python automation
│   ├── setup.sh
│   ├── configure-env.sh
│   ├── cms-db-init.sh
│   ├── generate-contest-compose.sh
│   └── fix_db_schema.sql
├── config/                        # CMS config templates
├── docker/                        # Docker build configs
├── docker-compose.*.yml           # Multi-stack compose files
├── Makefile                       # Build orchestration
└── CLAUDE.md                      # This file
```

---

## COMMON TASKS

### Add New Page

1. Create `src/app/[locale]/(authenticated)/mypage/page.tsx` (Server Component)
2. Add permission check if needed: `await checkPermission('tasks');`
3. Fetch data with Prisma or Server Actions
4. Create client component in `src/components/myfeature/`
5. Add navigation link in `Sidebar.tsx` with `/${locale}/mypage`
6. Add translations in `en.json` and `th.json` if needed

### Add New API Endpoint

1. Create `src/app/api/myresource/route.ts`
2. Add `verifyApiPermission()` check
3. Implement GET/POST/PUT/DELETE handlers
4. Use `apiSuccess()` and `apiError()` for responses
5. Call `revalidatePath()` after mutations

### Add New Server Action

1. Add to existing `src/app/actions/` file or create new one
2. Add `'use server'` at top
3. Call `ensurePermission()` first
4. Use Prisma for database operations
5. Call `revalidatePath()` after mutations
6. Return `{ success: true/false, ... }`

### Add New Component

1. Create in `src/components/[domain]/MyComponent.tsx`
2. Add `'use client'` if it needs interactivity
3. Extract locale from `usePathname()` if links are needed
4. Use Core components (Button, Card, Table) for UI primitives
5. Use `useToast()` for notifications

### Modify Database Schema

1. Edit `admin-panel/prisma/schema.prisma`
2. Run `make prisma-sync` (or `bun x prisma@6 db push`)
3. Update all layers: Server Actions, API Routes, Types, Components

---

## TROUBLESHOOTING

| Problem | Solution |
|---------|----------|
| Build fails | `bun run build` in admin-panel, check TypeScript errors |
| Session lost on restart | Set `AUTH_SECRET` in environment (random secret doesn't persist) |
| Prisma error | Run `make prisma-sync`, check DATABASE_URL |
| Locale links broken | Check for hardcoded `/en/` — use `/${locale}/` |
| Permission denied | Check `ensurePermission()` / `verifyApiPermission()` calls |
| Docker control fails | Ensure Docker socket is mounted and user has `permission_all` |
| Interval fields show 0 | Use `parseInterval()` helper to parse Postgres interval objects |
| Toast not showing | Ensure component is wrapped in `ToastProvider` |
| Notification polling loop | Use `useRef` for mutable state in polling effects, not `useState` in deps |
| `.env` not applied | Run `make env` to regenerate combined .env files |
| Contest not switching | Check `.env.contest` format: `CONTESTS_DEPLOY_CONFIG=1:8888` |

---

**END OF CLAUDE.md**

> **AI Assistants**: This is your source of truth. Follow these patterns exactly.
