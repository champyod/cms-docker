# Threat model

This model covers the system as it exists on the `feat/requirements-catalog` checkout. Each
finding maps to the requirement in `REQUIREMENTS.md` that mitigates it. Findings marked as
residual are not fully covered by a current requirement and are carried into `OPEN-QUESTIONS.md`.

## Assets

| Asset | Where it lives | Why it matters |
|---|---|---|
| Contestant credentials and sessions | users table, contest web server session cookie | Account takeover lets anyone submit as a participant. |
| Admin sessions and permissions | admin tables, HTTP-only session cookie | Admin access controls contests, users, and containers. |
| Submissions and their files | submissions, submission_results, fsobjects, large objects | Contest integrity depends on source and results being intact. |
| The audit log | `audit_log` (append-only, hash-chained) | It is the record of who did what; it is worthless if mutable. |
| The RPC shared secret | `[rpc]` section of the generated config | It is the only barrier to invoking any service method. |
| The database role model | roles and RLS policies | It is what makes the application connection bound by policy. |
| Grading host resources | worker sandbox, cgroups | Untrusted code runs here; escape is host compromise. |
| Container control | Docker socket | Root-equivalent over every service container. |
| Upstream fixes | the `upstream` remote | Supply-chain input for the vendored core. |

## Actors

| Actor | Trust | Capability |
|---|---|---|
| Anonymous internet | untrusted | Can reach any exposed port; can probe routes and flood. |
| Contestant | authenticated, low privilege | Can log in, view tasks, submit, run user tests, ask questions. |
| Contest judge or manager | authenticated, scoped | Can manage assigned tasks, datasets, and testcases. |
| Administrator | authenticated, scoped by registry | Can manage contests, users, and most entities. |
| Superadmin | authenticated, `all:all` | Can control containers and infrastructure. |
| Operator | trusted local | Runs the launcher, Makefile, and TUI. |
| Internal service | trusted by shared secret | Can invoke any registered RPC method. |
| Untrusted submission code | fully untrusted | Executes inside a sandbox during grading. |
| Backup process | trusted, privileged | Reads every row via BYPASSRLS. |
| Upstream maintainer | external, trusted-but-unverified | Supplies the vendored Python tree. |

## Trust boundaries

1. Internet to the contest web server (behind the reverse proxy).
2. Internet to the admin panel (session-authenticated).
3. Admin panel to the database, as the application role.
4. Admin panel to the Docker socket.
5. Service to service over the RPC transport.
6. Grading host to sandboxed untrusted code.
7. Application to large objects and file storage.
8. Operator to the launcher and infrastructure tooling.
9. The fork to upstream.

## Attack surface by service

| Service | Exposed surface | Notable risk |
|---|---|---|
| Contest web server | 27 HTTP routes plus a dynamic root (`src/cms/server/contest/handlers/__init__.py:65-107`, `src/cms/server/contest/server.py:93`) | Highest exposure; participant-reachable; submission and user-test entry points. |
| Ranking web server | Data CRUD and public routes (`src/cmsranking/RankingWebServer.py:83-88`, `:506-511`) | Public reads plus PUT/DELETE on ranking data. |
| Admin web server | 75 routes (`src/cms/server/admin/handlers/__init__.py:111-224`) | Broad administrative actions. |
| Admin panel | 28 API handlers plus 29 action modules | Direct database access and Docker control. |
| Evaluation service | RPC methods `new_submission`, `new_user_test`, `queue_status` (`src/cms/service/EvaluationService.py:881,901,1085`) | Queue saturation; fairness manipulation. |
| Worker | RPC `execute_job_group` (`src/cms/service/Worker.py:103`) | Runs untrusted contestant code. |
| Checker | Callback `check` (`src/cms/service/Checker.py:48`) | Judges output; no RPC surface. |
| Resource, log, proxy, scoring services | Their RPC methods (`ResourceService.py:403-447`, `LogService.py:75-120`, `ProxyService.py:449-549`, `ScoringService.py:162-175`) | Cross-service calls inherit the transport's authentication level. |
| RPC transport | All of the above | Single shared secret; no per-caller identity. |

## STRIDE findings

| ID | Category | Threat | Boundary | Mitigation |
|---|---|---|---|---|
| TM-01 | Spoofing | An attacker on the internal network invokes a service method without a secret because the transport is unauthenticated on older branches; the fail-closed check exists only on the current one. | 5 | REQ-S01 |
| TM-02 | Spoofing | A stolen or guessed shared secret is replayed; there is no per-caller identity or rotation cadence. | 5 | REQ-S01, REQ-S12 |
| TM-03 | Spoofing | Admin session cookie forgery is prevented only if the signing secret is strong and configured. | 2 | REQ-S10, REQ-S12 |
| TM-04 | Tampering | A privileged path mutates or deletes audit rows, destroying the record. | 3 | REQ-S05 |
| TM-05 | Tampering | A submission delete bypasses the permission, reason, and audit requirement. | 3 | REQ-S06 |
| TM-06 | Tampering | The application role is re-escalated to bypass RLS, silently removing the policy guarantee. | 3 | REQ-S07 |
| TM-07 | Tampering | The backup role loses BYPASSRLS or membership, so dumps break or large objects become unreadable. | 3 | REQ-S08 |
| TM-08 | Tampering | String-built SQL in panel update paths allows query manipulation. | 3 | REQ-S13, REQ-S16 |
| TM-09 | Repudiation | A destructive operation is performed without a required reason or audit entry. | 3 | REQ-S05, REQ-S06, REQ-S09 |
| TM-10 | Information disclosure | The RPC secret leaks through a log or error message. | 5 | REQ-S02 |
| TM-11 | Information disclosure | A secret is shipped in a client bundle or URL. | 2 | REQ-S12 |
| TM-12 | Information disclosure | Large-object bytes bypass row-level security, since PostgreSQL cannot gate them. | 7 | REQ-S15 |
| TM-13 | Denial of service | Oversized RPC messages exhaust memory on a service. | 5 | REQ-S03 |
| TM-14 | Denial of service | A submission flood starves the grading queue or blocks legitimate judging. | 1 | REQ-S14 |
| TM-15 | Denial of service | A missing RPC secret makes the whole cluster stop; the fail-closed design turns a config error into an outage. | 5 | REQ-S01, REQ-F07 |
| TM-16 | Elevation of privilege | Untrusted submission code escapes the sandbox and reaches the host. | 6 | REQ-S11 |
| TM-17 | Elevation of privilege | A non-superadmin reaches a Docker-socket path and controls containers. | 4 | REQ-S09 |
| TM-18 | Elevation of privilege | A client-declared permission is trusted by a server path. | 2 | REQ-S09 |
| TM-19 | Elevation of privilege | A corrupt or legacy stored permission value is treated as allow instead of deny. | 2 | REQ-S10 |
| TM-20 | Elevation of privilege | Unvalidated input reaches a container operation or a database write. | 1, 4 | REQ-S16, REQ-S09 |
| TM-21 | Tampering (supply chain) | The vendored core is replaced from upstream with no pin, so a malicious or broken upstream revision cannot be detected against a known baseline. | 9 | REQ-F08, REQ-F10 (see residual below) |
| TM-22 | Information disclosure | Behavioural drift in the contest surface exposes or mis-scores data during a live contest. | 1 | REQ-F01, REQ-F10, REQ-F11 |
| TM-23 | Elevation of privilege | `all:all` expands from two different universes, so a check can pass in one UI and fail in the other. | 2 | REQ-F13, REQ-F15 |
| TM-24 | Elevation of privilege | Two incompatible `all:all` predicates inside Python: one requires a single effective key, the other grants on mere presence. | 2 | REQ-F15 |
| TM-25 | Elevation of privilege | Four or more "is superadmin" predicates across both languages can disagree. | 2 | REQ-F13 |
| TM-26 | Tampering | Field-permission rules exist in three places and conflict; a self-edit path Python allows is silently dropped by the panel. | 2 | REQ-F16 |
| TM-27 | Repudiation | Every Python-side mutation is unaudited: the audit model exists but has no writer, so the hash chain excludes Python changes. | 3 | REQ-F17, REQ-S09 |
| TM-28 | Tampering | One operation is gated by three different permission keys across the two UIs. | 2 | REQ-F13, REQ-F16 |

Sources for TM-23 to TM-28 are the findings recorded in `docs/PHASE0-INVENTORY.md`.

## Residual risk and assumptions

| Item | State |
|---|---|
| Single shared secret, no per-caller identity. | Assumed acceptable for a trusted internal network; a replacement should be designed to carry an identity. Not yet a requirement. |
| Large-object bytes cannot carry row-level security. | Documented exemption; mitigated only by application-level guards (REQ-S15). |
| Contestant row ownership is not enforceable at the database layer because the contestant path shares the application connection. | Documented limitation; no database principal per contestant. Carried into `OPEN-QUESTIONS.md`. |
| Behavioural parity cannot be proven by static analysis alone. | Mitigated by REQ-F10 and REQ-F11, which require verification through the real path and operator sign-off. |
| No performance data exists. | No performance claim is made anywhere in this document set. |
