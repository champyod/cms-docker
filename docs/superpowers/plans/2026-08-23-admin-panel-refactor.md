# Admin Panel Full-Sweep Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring every file in `cms-docker/admin-panel/` into clean-code compliance (≤250 lines/file, ≤30 lines/function, zero `any`, zero duplication, CLAUDE.md naming/comment/pattern rules) without behavior change, fixing defects inline as separately-committed fixes.

**Architecture:** Foundation-first then vertical feature slices. Phase 0 splits the shared `constants.ts`, types the session layer, dedupes `permissions.ts`, and adds vitest coverage for pure logic. Then 12 feature slices refactor all layers (actions + API routes + components + pages) per domain, each verified and committed independently.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Prisma 6, Tailwind v4, vitest 4, jose JWT, bcryptjs.

**Spec:** `docs/superpowers/specs/2026-08-23-admin-panel-refactor-design.md`

## Global Constraints

Every task implicitly includes ALL of these. Copied verbatim from spec + project CLAUDE.md:

- Files ≤ 250 lines; functions ≤ 30 lines (project rule; stricter than global 40)
- ZERO `as any`, `@ts-ignore`, `@ts-expect-error`; explicit return types on all exported functions
- No empty `catch {}` — every catch logs, rethrows, or handles with a comment stating why ignoring is safe
- Comment policy: NO explanatory/TODO/commented-out/dev-journal comments; section markers (`{/* GENERAL TAB */}`) allowed; JSDoc only on exported functions with non-obvious contracts
- Naming: `dict` not `t` · `locale` not `lang` · `prisma` not `db` · `formData` not `data` · booleans `is*/has*/should*` · handlers `handleVerb` · actions `verbNoun`
- Import order: react/next → third-party → internal lib/actions → components
- Locale: NEVER hardcode `/en/...`; server components use `params.locale`, client use `usePathname().split('/')[1]`
- Server Actions: `'use server'` top, `ensurePermission()` first line when protected, `revalidatePath()` after every mutation, return plain objects, never throw to client
- API routes: `verifyApiPermission()` before processing, `apiSuccess()`/`apiError()` responses
- NO hardcoded locale strings, NO secrets in client code, Docker ops require `permission_all`
- Submissions are append-only — never add submission-editing capability
- Every timer/listener in useEffect has cleanup; refs not state in polling deps
- Commits: stage ONLY touched `admin-panel/**` paths via pathspec (`git commit -- <paths>`), `WIP(refactor): …` prefix for refactor commits, `fix(admin-panel): …` for defects, NO Co-Authored-By
- Never touch: `prisma/schema.prisma`, Python `src/cms/**`, docker-compose files, Makefile, unrelated dirty working-tree files
- No new dependencies

**Verification commands (run from `cms-docker/admin-panel/`):**
```bash
./node_modules/.bin/tsc --noEmit        # must exit 0
./node_modules/.bin/vitest run          # must be all green
```

---

### Task 1: Split constants.ts into domain modules

**Files:**
- Create: `src/lib/constants/languages.ts` (language data moved VERBATIM)
- Create: `src/lib/constants/index.ts` (barrel re-export)
- Modify: `src/lib/constants.ts` → becomes barrel or is deleted if all imports go through `@/lib/constants`

**Interfaces:**
- Consumes: nothing
- Produces: `src/lib/constants/index.ts` re-exporting every symbol currently exported by `constants.ts` under identical names/types — zero import-site changes required elsewhere

- [ ] **Step 1:** Read `src/lib/constants.ts` fully. List every export symbol and classify: language data / task-related / UI-related / other.
- [ ] **Step 2:** Create `src/lib/constants/languages.ts` containing ONLY the language array data, moved byte-for-byte.
- [ ] **Step 3:** Create remaining domain modules (`taskConstants.ts`, `uiConstants.ts`, or as classification dictates) each ≤250 lines.
- [ ] **Step 4:** Replace `src/lib/constants.ts` content with `export * from './constants/index';` (keeps every existing `from '@/lib/constants'` import working).
- [ ] **Step 5:** Verify: `./node_modules/.bin/tsc --noEmit` exits 0 AND `./node_modules/.bin/vitest run` green.
- [ ] **Step 6:** Commit:
```bash
git -C .. add admin-panel/src/lib/constants.ts admin-panel/src/lib/constants/
git -C .. commit -m "WIP(refactor): split constants into domain modules" -- admin-panel/src/lib/constants.ts admin-panel/src/lib/constants/
```

### Task 2: Type the session layer + dedupe permissions

**Files:**
- Modify: `src/lib/auth.ts`
- Modify: `src/lib/api-utils.ts`
- Modify: `src/lib/permissions.ts`

**Interfaces:**
- Produces: `export interface SessionPayload { userId: string; username: string; expiresAt: string | Date; permissions: AdminPermissions }` and `export interface AdminPermissions { permission_all: boolean; permission_tasks: boolean; permission_users: boolean; permission_contests: boolean; permission_messaging: boolean }` from `lib/auth.ts`. `decrypt(): Promise<SessionPayload | null>` semantics preserved (callers already null-check).

- [ ] **Step 1:** Read all three files fully. Check git history for the JWT 2h-vs-cookie-7d mismatch intent (`git log -p --follow -- src/lib/auth.ts | head -100`). If intent unclear, LOG it in the task report — do NOT change expiry values.
- [ ] **Step 2:** In `auth.ts`: define `AdminPermissions` + `SessionPayload` interfaces; retype `encrypt(payload: SessionPayload)`, `decrypt(input: string): Promise<SessionPayload>`, `refreshSession(payload: SessionPayload)`. Remove all `any`.
- [ ] **Step 3:** In `api-utils.ts`: remove `(value as any)` in `sanitize` — narrow with a type guard (`typeof value === 'string' && value === '$undefined'`).
- [ ] **Step 4:** In `permissions.ts`: extract single `const EMPTY_PERMISSIONS = { ...all false ×10 } as const` object; use it in both early-return branches of `getPermissions()`.
- [ ] **Step 5:** Verify typecheck + tests green.
- [ ] **Step 6:** Commit:
```bash
git -C .. commit -m "WIP(refactor): typed session payload, dedupe empty permissions" -- admin-panel/src/lib/auth.ts admin-panel/src/lib/api-utils.ts admin-panel/src/lib/permissions.ts
```

### Task 3: Tests for pure-logic libs (write FIRST, TDD-style safety net)

**Files:**
- Test: `tests/contest-validation.test.ts`
- Test: `tests/file-encoding.test.ts`
- Test: `tests/filenameParser.test.ts`

**Interfaces:**
- Consumes: current exports of `src/lib/contest-validation.ts`, `src/lib/file-encoding.ts`, `src/utils/filenameParser.ts` — tests pin CURRENT behavior (characterization), they are written against today's signatures so later refactors cannot silently change them.

- [ ] **Step 1:** Read the three source files fully. Enumerate every exported function and its edge cases (empty input, malformed input, boundary values).
- [ ] **Step 2:** Write characterization tests covering every export: happy path + error path + boundaries. Deterministic only — no timers, no randomness. If a module imports server-only deps that break node-env vitest, test the extractable pure parts and note the limitation in the report.
- [ ] **Step 3:** Run `./node_modules/.bin/vitest run` — all new tests PASS against current code (they characterize existing behavior). Any failure = discovered defect: log it, do not fix in this task.
- [ ] **Step 4:** Commit:
```bash
git -C .. commit -m "test(admin-panel): characterize pure-logic libs" -- admin-panel/tests/
```

---

### Slice protocol (applies to EVERY Task 4–15)

For each slice, execute in order:

1. **Read** every listed file fully.
2. **Defect scan**: dead code, wrong error handling, missing cleanup, rule violations needing behavior change. Each confirmed defect → minimal fix → separate `fix(admin-panel): <desc>` commit BEFORE refactor commit. Ambiguous/risky → log in report only.
3. **Refactor** to compliance: split files >250 lines by responsibility (one concern per new file, colocated in same directory); extract functions >30 lines; purge non-compliant comments; enforce naming/import-order/locale rules; kill any `any`.
4. **Verify**: `tsc --noEmit` exit 0 + `vitest run` green. Fix before proceeding; two consecutive failures → STOP and report state honestly.
5. **Commit**: `WIP(refactor): <slice name> sweep` with pathspec listing exactly the touched files.

### Task 4: Slice auth/session
**Files:** `src/app/actions/auth.ts`, `src/app/[locale]/auth/login/page.tsx`, `src/app/[locale]/auth/signout/page.tsx`, `src/lib/redirect.ts`, `src/proxy.ts`
**Interfaces:** Produces unchanged public signatures for `login`, `signout`, `getSession` consumers across later slices.

### Task 5: Slice admins
**Files:** `src/app/actions/admins.ts`, `src/components/admins/AdminList.tsx`, `src/components/admins/AdminModal.tsx`, `src/app/[locale]/(authenticated)/admins/page.tsx`

### Task 6: Slice users
**Files:** `src/app/actions/users.ts`, `src/app/actions/participations.ts`, `src/app/api/users/**` (route.ts ×4 incl. batch/bulk/credentials), `src/components/users/**` (×4), `src/app/[locale]/(authenticated)/users/page.tsx`
**Note:** `api/users/batch/route.ts` (404 lines) and `bulk/route.ts` (266) exceed limits — split handler logic into colocated helpers.

### Task 7: Slice teams
**Files:** `src/app/actions/teams.ts`, `src/app/api/teams/**` (×2), `src/components/teams/**` (×3), `src/app/[locale]/(authenticated)/teams/page.tsx`, `teams/[id]/page.tsx`

### Task 8: Slice contests ⛔ MILESTONE after: full `next build`
**Files:** `src/app/actions/contests.ts` (397), `announcements.ts`, `questions.ts`, `search.ts`, `src/components/contests/**` (×8 — ContestModal.tsx is 938 lines: split into form sections/field-groups colocated in `components/contests/`), `src/app/[locale]/(authenticated)/contests/page.tsx`, `contests/[id]/page.tsx`, `search/page.tsx`, `search/SearchClient.tsx`
**Interfaces:** ContestModal split MUST keep its external props interface identical — parent pages consume it unchanged.

### Task 9: Slice tasks ⛔ MILESTONE after: full `next build`
**Files:** `src/app/actions/tasks.ts` (254), `datasets.ts`, `statements.ts`, `testcases.ts`, `src/app/api/tasks/**`, `api/datasets/**`, `api/statements/**`, `api/testcases/**`, `api/managers/**`, `api/attachments/**`, `src/components/tasks/**` (×7 — TaskModal 521, TestcaseUploadModal 521, TaskDetailView 505, DatasetModal 402 all split), `tasks/page.tsx`, `tasks/[id]/page.tsx`

### Task 10: Slice submissions
**Files:** `src/app/actions/submissions.ts`, `src/app/api/submissions/[id]/route.ts`, `src/components/submissions/**` (×2), `submissions/page.tsx`
**Note:** APPEND-ONLY law — verify no edit path exists; flag if one does.

### Task 11: Slice ranking
**Files:** `src/app/actions/ranking.ts`, `src/lib/ranking-session.ts`, `src/app/api/ranking/**` (×2), `src/components/ranking/RankingClient.tsx`, `ranking/page.tsx`

### Task 12: Slice ops cluster
**Files:** `src/app/actions/services.ts` (525 — split), `docker.ts`, `docker-ops.ts`, `containerConfig.ts`, `stats.ts` (269), `env.ts`, `workerConfig.ts`, `workers.ts`, `src/components/containers/**` (×3), `deployments/DeploymentsClient.tsx` (438), `resources/**` (×4), `containers/page.tsx`, `deployments/page.tsx`, `resources/page.tsx`, `maintenance/page.tsx`, `maintenance/MaintenanceClient.tsx`
**Note:** ALL Docker-touching code requires `permission_all` — verify each action enforces it; missing enforcement = security defect → fix commit immediately.

### Task 13: Slice settings
**Files:** `src/components/settings/EnvConfigView.tsx` (437), `WorkerNodesConfig.tsx` (278), `settings/page.tsx`

### Task 14: Slice core UI + layout + i18n + docs
**Files:** `src/components/core/**` (×14), `layout/Header.tsx`, `layout/Sidebar.tsx`, `providers/ToastProvider.tsx`, `PermissionDenied.tsx`, `hooks/**` (×4), `lib/utils.ts`, `lib/apiClient.ts`, `docs/page.tsx` (350 — likely static content: extract section components), root `layout.tsx` files, `not-found.tsx` ×2, `types/index.ts`, `i18n.ts`

### Task 15: Final gate
- [ ] Full `lsp_diagnostics` sweep over `admin-panel/src` — zero errors
- [ ] `./node_modules/.bin/tsc --noEmit` exit 0
- [ ] `./node_modules/.bin/vitest run` all green (original 4 + all new)
- [ ] Full `next build` success
- [ ] Line-count audit: `wc -l` over src — zero files >250
- [ ] Grep audit: zero `as any|@ts-ignore|@ts-expect-error|TODO|FIXME` in src
- [ ] Final cleanup commit (no WIP prefix): `refactor(admin-panel): complete full-sweep compliance`
- [ ] Produce closing report: slices done, defects fixed (commit list), defects logged-not-fixed, UNVERIFIED items

---

## Self-Review (done at write time)

1. **Spec coverage:** §5 Phase 0 → Tasks 1–3 ✓ · §6 slices 1–12 → Tasks 4–14 ✓ · §8 gates → embedded per-task + Task 15 ✓ · §2 decisions → Global Constraints ✓
2. **Placeholder scan:** slice bodies reference the deterministic Slice Protocol instead of repeating it — protocol contains concrete rules, not TBDs ✓
3. **Type consistency:** `SessionPayload`/`AdminPermissions` defined once in Task 2, consumed implicitly everywhere via unchanged import sites ✓
