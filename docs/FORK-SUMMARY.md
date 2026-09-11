# cms-docker vs upstream CMS — fork summary

What this fork is. What it changed vs upstream. What got built on top.

## What this repo is

`cms-docker` = containerized deployment of Contest Management System. Upstream = [cms-dev/cms](https://github.com/cms-dev/cms) (Python/Tornado). Fork adds: docker stacks, Makefile orchestration, `./cms` TUI launcher, Next.js admin panel, worker fleet, monitoring/WAF/Vault overlays, docs.

Remotes: `origin` = champyod/cms-docker. `upstream` = cms-dev/cms (configured, never fetched — `.git/FETCH_HEAD` empty).

## Upstream relationship

- Python source lives `src/`. **Plain copied files, NOT a submodule.** No `.gitmodules`, no `src/.git`, no `.git/modules/`. Nothing under `src/` has its own history.
- Was a submodule once, later flattened (old branches `features/submodules`, `features/split`, `features/pull-cms` survive).
- Best-supported base ≈ cms-dev/cms `b98e44b5` (2026-03-02), post-v1.5.1 tree. `src/cms/__init__.py` says `1.6.dev0`. Last sync commits: `f43c081e` "upstream cms" (2026-03-13), `3daffaa7` "update src of cms" (2026-01-29).
- **Trap:** no pin recorded. `git` in this checkout cannot answer "diff vs upstream". Submodule commands in README/docs are stale and will fail — `README.md:29,153`, `scripts/__update-server.sh:54`, `docs/TUTORIAL.md:19`, `docs/TROUBLESHOOTING.md:190-193`, `.dockerignore:19`.

## Python CMS patches (only 3 areas touched)

Byte-identical to upstream: `src/cmscommon/**`, `src/debian/**`, `src/setup.py`, `src/pyproject.toml`, `src/docs/**`, `src/.github/**`, licenses, and bulk of `cms/` (web servers, grading, languages, tasktypes, IO).

Patched:
1. **Eval queue fairness** — `cms/db/__init__.py` schema `version 47 → 48`; `cms/db/contest.py` new `queue_fairness_penalty_seconds` column; `cms/service/EvaluationService.py` new `_compute_submission_fairness_delay()`, enqueue shifted by `n × penalty`.
2. **Admin permissions** — `cms/server/admin/**` + admin template/model. Commit `ed409b53` "enhance user and team management permissions".
3. **Ranking logo/branding** — `cmsranking/Config.py` new `logo_path`; `RankingWebServer.py` `ImageHandler` + `/logo` rule + hot-swap.

Plus: `src/install.py` constraints stripped from pip install; `cmsranking/static/lib/raphael.js` vendored.

Note: `cmscommon/crypto.py` **untouched** — `bcrypt:`/`plaintext:` prefix logic is upstream, not fork work.

## Built new (not upstream at all)

Root: `Dockerfile`, `Makefile`, `cms` launcher, `config.toml.example`, 12 `docker-compose*.yml`, `CLAUDE.md`, `CHANGELOG.md`.
Dirs: `admin-panel/` (Next.js 16 + React 19 + Prisma 6 + Bun), `scripts/` (41 files + `__lib/`, `__tui/`), `config/` (nginx, fail2ban, grafana, modsecurity, prometheus, tailscale, vault), `docs/`, `docker/`, `tools/` (Rust `cms-tui` source), `.tools/cms-tui/` (vendored binary), `examples/`, `backups/`, `debian/`.

No `cms-docker` string anywhere inside `src/` — Python tree has zero Docker coupling. Containers wired via generated `cms.toml`/env.

## History, era by era

**A. Upstream (2010-09 → 2025-11), ~4,640 commits.** Vanilla CMS. Top contributors: stefano-maggiolo 1505, giomasce 943, lw 827.

**B. Fork + first dockerization (2025-12-10 → 12-25), ~30 commits.** Restructure (`src/` split, tests stripped). Multi-stack compose `core/admin/contest/worker` + Makefile targets. Remote worker over Tailscale. isolate amd64+arm64, cgroup setup. Multi-arch CI. Ranking static-file fix + APT mirror args → **v1.1.2 tag**. Tailscale Funnel HTTPS.

**C. Pre-built images (2026-01).** GHCR images, `*-img` targets, `DEPLOYMENT_TYPE` img/src split.

**D. Feature build-out + hardening (2026-02 → 2026-08), ~255 commits.** Async contest deploy (sentinel files). Single-active-contest model (`is_active`, `ACTIVE_CONTEST_ID`). Live worker telemetry. Dual-mode passwords (`bcrypt:`/`plaintext:`) + click-to-reveal. Bulk user CSV credentials. Permission sweep across actions/routes. Security wave: hash-free Prisma selects, parameterized participation IPs, RPC-first recalculation, superadmin lockout guard, env-file whitelist, 2h JWT + DB-verified session, killed unauth worker-status endpoint, login throttling, one-time credential CSV. Admin UI redesign on shadcn tokens. Infra overlays (nginx, redis, captcha, waf, optional HSM).

**E. Orchestration + TUI + refactor (2026-08-23 → 08-30).** Admin-panel full sweep (typed slices, dead-code purge, files <250 lines, characterization tests, `make audit`). Scripts moved to `scripts/__*`; user-facing scripts absorbed into `./cms`. Unified `./cms` entrypoint. Vendored Rust `cms-tui` (dashboard/fleet/wizard). Docs rewrite. CI → `lint.yml` + `build-and-push.yml`. Merged to `main` (PR #3).

**F. config.toml single source + fleet attach + docs (2026-09-02 → 09-05), ~40 commits.** `config sync`/update-wizard retargeted to `config.toml`. `.env.*` examples deleted. `.env.tailscale` generated. Worker fleet attach (`./cms worker attach 4-7 host port`), sync preserves registry rows. Deploy fixes (idle timeout, wall limit, activation from config.toml, mismatch banner). Compose cleanup (removed uncalled `*.img.yml`, consolidated worker tag, dropped admin stubs). Domain `setup` flag forwarding. Full docs pass.

## Scale today

- 12 `docker-compose*.yml` at root (+2 in `tools/`). Profiles: `core`, `admin`, `contest`, `worker`, `monitor`.
- Makefile: 44 named targets.
- admin-panel: 22 `page.tsx`, 28 API `route.ts`, 26 server-action files, 27 Prisma models, 12 vitest suites.
- `docs/`: TUTORIAL, QUICKREF, ACCESS-CONFIGURATION, DEPENDENCIES, SERVICE_GUIDE, TROUBLESHOOTING, WORKER-SETUP, PORTAINER-GUIDE, optional-features, waf-tuning, csp-implementation, dnssec-caa-guide, 2 release-notes, `decisions/ranking-logo-storage.md`, `superpowers/specs|plans/2026-08-23-admin-panel-refactor*`.
- CI: 2 workflows + dependabot.
- Latest release tag: v1.1.2.

## Permission rebuild (branch `feat/requirements-catalog`)

Old model: 5 booleans on `admins` (`permission_all/tasks/users/contests/messaging`), session token carried them, coarse checks, ~20 templates read the booleans.

New model: **groups + per-person override**.

Schema added: `permissions`, `groups`, `group_permissions`, `admin_groups`, `admin_permission_overrides`, `audit_log`. The 5 boolean columns were **dropped** after the backfill.

Rules locked:
- Fine-grained keys `<module>:<verb>`. Registry = single source of truth. 200 keys, 35 modules.
- Groups hold permission sets. Users join groups. Override = allow/deny, **deny wins**.
- **No bypass.** `all:all` is a normal checked, logged permission. Neither admin skips checks.
- **No hardcoded read-only.** Every entity gets full verbs. Only real system invariants stay server-side.
- Pre-made groups (Superadmin, Contest Manager, Problem Setter, Judge, Viewer, Data Correction, Storage Admin, Messaging) are ordinary + deletable.
- **Audit everything.** Append-only `audit_log`, hash-chained, read-only. All mutations + sensitive reads. Destructive ops demand a reason. Truth source for "who deleted what".
- Legacy Python admin enforces the same model from the same tables. No bypass either side.
- **Forward-only DB.** Additive migrations only.
- Config single source: one `config.toml` in, one generated `.env` out, via `make env` / `./cms config sync`. No manual edit, no split, no `.env.example`.

Landed:
- Prisma schema + 6 tables; additive + backfill + drop migrations; idempotent seed wired into `prisma-sync`.
- `permission-registry.ts` (200 keys), `permission-engine.ts` (pure resolver), `audit.ts` (hash-chained writer), `field-permissions.ts` (per-field map).
- Lib layer: `permissions.ts`, `auth.ts`, `api-utils.ts`, `prisma-selects.ts` — session no longer carries permissions; resolved per request (60s cache).
- All ~172 coarse call sites rewritten across 26 action files + 28 API routes + 18 pages.
- Per-field gating for 13 entities: admins, contests, tasks, users, teams, submissions, datasets, testcases, participations, announcements, questions, statements, monitor_targets — each with UI gating + server-side field stripping.
- UI: groups management page, audit log viewer, admin modal rebuilt on group multi-select + override editor; client components use `permissionKeys: readonly string[]`.
- Python: SQLAlchemy models for the new tables, group-based `require_permission`, all handlers re-decorated, all ~20 templates migrated to `admin.has_permission()`, boolean columns removed.
- Config consolidated to a single `.env`; readers repointed; admin settings UI retargeted.

Verified: Next.js `tsc` 0 errors, 429/429 tests green. Python files compile; zero references to the old booleans remain anywhere.

## Row-level security (2026-08-20)

RLS enabled with `FORCE` on all 33 app tables (`admins`, `announcements`, `attachments`, `contests`, `datasets`, `evaluations`, `executables`, `files`, `fsobjects`, `managers`, `messages`, `participations`, `questions`, `statements`, `submission_results`, `submissions`, `tasks`, `teams`, `testcases`, `tokens`, `user_test_*`, `monitor_targets`, `users`, `permissions`, `groups`, `group_permissions`, `admin_groups`, `admin_permission_overrides`, `audit_log`) — `FORCE` binds `cmsuser` (owner) so even the owner must satisfy a policy. `audit_log` is append-only (SELECT+INSERT only, no UPDATE/DELETE for any role — hash chain tamper-evident at DB layer). `submissions` is non-deletable (SELECT/INSERT/UPDATE allowed — admin UI needs `comment`/`official` — but no DELETE for any role). `cms_service`/`cms_admin`/`cmsuser` have permissive `USING (true) WITH CHECK (true)` (not `BYPASSRLS`, auditable) except for those two guarantees; `cms_monitor`/`cms_readonly` are SELECT-only. Exemptions: `pg_largeobject` payloads cannot carry RLS (PostgreSQL limitation — only `fsobjects` rows are gated, file bytes via `lo_*`/digest stay app-guarded) and contestant row ownership is not enforceable (contestant path shares the app connection, no DB principal). Policies are re-applied after every `prisma db push` by `scripts/__apply_sql.sh` (filename-ordered, `ON_ERROR_STOP=1`), so they survive schema sync.

## Known stale / risky

- Vendored `src/` + no recorded pin → cannot diff vs upstream from this checkout. Re-sync needs a manual upstream fetch + tree comparison.
- Submodule instructions in README/docs are wrong — tree is flat.
- `src/cmstaskenv/` retained though upstream `main` dropped it.
