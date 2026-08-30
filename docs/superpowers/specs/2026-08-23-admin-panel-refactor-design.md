# Admin Panel Full-Sweep Refactor — Design

**Date:** 2026-08-23
**Scope:** `cms-docker/admin-panel/` (~24,700 LOC, 130+ TS/TSX files)
**Branch:** `major/admin-panel`
**Mode:** Behavior-preserving refactor with inline defect fixes (flagged, separate commits)

---

## 1. Goal

Bring the entire admin panel into compliance with the clean-code rule set (global AGENTS.md rules + project CLAUDE.md conventions) without changing behavior:

- Files ≤ 250 lines; functions ≤ 30 lines (project rule, stricter than global 40)
- No duplicated logic; single source of truth per concept
- No `any`, no type suppression, explicit return types
- Comment policy per CLAUDE.md: self-documenting code, section markers allowed, no TODO/commented-out code/dev-journal comments
- Naming tables, import order, locale routing, server-action/API patterns per CLAUDE.md

## 2. Decisions (user-approved)

| Question | Decision |
|---|---|
| Scope | **B — Full sweep**: all 130+ files audited and touched |
| Safety net | **C — Hybrid**: vitest tests for pure-logic modules; `tsc --noEmit` + `next build` + read-backs for UI/actions |
| Defects found during refactor | **B — Fix as you go**, each in its own `fix(admin-panel): …` commit before the containing refactor commit |
| Commits | **A — Section-by-section `WIP:` commits**, staging only `admin-panel/**` paths (+ this spec); unrelated dirty files untouched |

## 3. Baseline (verified 2026-08-23)

- `tsc --noEmit`: exit 0
- `vitest run`: 4/4 pass (`tests/prisma-selects.test.ts`)
- ~28 files exceed 250 lines; largest: `lib/constants.ts` (2454), `ContestModal.tsx` (938), `UserBulkEditDialog.tsx` (630), `ContestDetailView.tsx` (576), `actions/services.ts` (525)
- Auth gating already centralized (`ensurePermission` / `verifyApiPermission`) — action-layer duplication is lower than assumed
- Known violations at baseline:
  - `lib/auth.ts`: `encrypt(payload: any)`, `decrypt(): Promise<any>`, `refreshSession(payload: any)`
  - `lib/api-utils.ts:7`: `(value as any)` cast in `sanitize`
  - `lib/permissions.ts`: `getPermissions()` repeats an identical 10-field all-false object literal 3×
  - JWT encrypt sets a 2 h expiry while the cookie lives 7 days — verify intent before touching (defect candidate)

## 4. Level Map

| Level | Touched | Notes |
|---|---|---|
| L0 Feature | yes | All behaviors preserved; defects fixed per §2 |
| L1 Page/View | yes | 21 pages under `[locale]/(authenticated)/` + auth pages |
| L2 Frontend | yes | ~60 components, hooks, providers |
| L3 API | yes | 25 API routes + 23 server-action files |
| L4 Backend | yes | Prisma queries, Docker socket ops, env management |
| L5 Infra/Data | no code changes | Prisma schema untouched; `prisma-selects.ts` consumed as-is |

## 5. Phase 0 — Foundation (before any feature slice)

1. Split `lib/constants.ts` → `src/lib/constants/` domain modules (`languages.ts` data moved verbatim, plus task/UI/domain constants). Barrel re-export keeps existing import paths working.
2. Type the session layer: define `SessionPayload`; remove every `any` from `lib/auth.ts`.
3. Deduplicate `getPermissions()` false-object into a single named constant.
4. Write vitest unit tests FIRST for pure logic: `contest-validation.ts`, `file-encoding.ts`, `utils/filenameParser.ts`, permission switch table.
5. Extract shared helpers only when slice work proves ≥3 real repetitions (evidence-driven; no speculative abstraction).

## 6. Feature Slices (order = dependency + risk)

1. auth/session (`lib/auth.ts`, `lib/permissions.ts`, `lib/redirect.ts`, login/signout pages)
2. admins
3. users (+ `api/users/batch`, `api/users/bulk`, credentials route)
4. teams
5. contests (+ participations, communications, contest-validation consumers)
6. tasks (+ datasets, statements, testcases, attachments, managers, diagnostics)
7. submissions
8. ranking (+ ranking-session lib)
9. search
10. ops cluster: services, docker/docker-ops actions, containers, deployments, resources, stats
11. settings/env/workerConfig
12. core UI (`components/core/*`), layout, providers, i18n dictionaries, docs page, root files (`proxy.ts`, `types/`)

Per-slice protocol:

1. Read every file in the slice fully.
2. Fix defects found → own flagged commit first.
3. Refactor: split oversized files by responsibility, extract functions >30 lines, purge non-compliant comments, enforce naming/import order.
4. Verify: `tsc --noEmit` exit 0 + full vitest suite green.
5. Commit `WIP(refactor): <slice> …` staging only touched admin-panel paths.

## 7. Testing Strategy

- Vitest (node env, `tests/**/*.test.ts`, `@` alias configured): all pure-logic libs and extracted helpers; deterministic; no sleeps/randomness.
- UI components, pages, Prisma/Docker-bound actions: verified via `tsc --noEmit`, targeted read-backs, and `next build` at milestones.
- Existing 4 prisma-selects tests stay green throughout.

## 8. Verification Gates

- Every slice: typecheck + tests green before its commit.
- Milestones requiring full `next build`: after Phase 0, after contests slice, after tasks slice, final.
- Final gate: full-suite diagnostics sweep + build + test report in the closing summary.

## 9. Out of Scope

- Prisma schema / migrations
- Python CMS layer (`src/cms/**`)
- docker-compose files, Makefile, shell scripts
- Unrelated dirty working-tree changes (scripts namespace renames)
- New dependencies (none added)

## 10. Risks

| Risk | Mitigation |
|---|---|
| Near-zero test coverage on UI layer | Hybrid net: typecheck + build gates at milestones; pure logic under test |
| Barrel re-export of constants could mask unused imports | Lint/diagnostics check after split; clean barrels per module |
| Fix-as-you-go muddies diffs | Defect fixes land as separate commits before refactor commits |
| Session expiry mismatch (2 h vs 7 d) may be intentional | Investigate history/intent before changing; if ambiguous, log instead of fix |
