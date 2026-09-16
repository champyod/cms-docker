# Inventory

Every interface and data path that the replacement backend must reproduce, with the current
behaviour and a source citation. Paths are relative to the `feat/requirements-catalog` checkout.
This is the traceable baseline: any design that cannot be traced to a row here is out of scope
until this inventory is extended.

## 1. Inter-service RPC services

Seven services register RPC methods with the `@rpc_method` decorator; the checker uses callbacks
instead. Method names, declaring file and line:

| Service | RPC methods (line) | Source |
|---|---|---|
| Evaluation service | `workers_status` (414), `new_submission` (881), `new_user_test` (901), post-finish locked handler (921), `disable_worker` (1044), `enable_worker` (1068), `queue_status` (1085) | `src/cms/service/EvaluationService.py` |
| Worker | `precache_files` (67), `execute_job_group` (103) | `src/cms/service/Worker.py` |
| Resource service | `get_resources` (403), `kill_service` (422), `toggle_autorestart` (447) | `src/cms/service/ResourceService.py` |
| Log service | `Log` (75), `last_messages` (120) | `src/cms/service/LogService.py` |
| Proxy service | `reinitialize` (449), `submission_scored` (461), `submission_tokened` (505), `dataset_updated` (549) | `src/cms/service/ProxyService.py` |
| Scoring service | `new_evaluation` (162), `invalidate_submission` (175) | `src/cms/service/ScoringService.py` |
| Checker | no RPC methods; `check` (48) and `echo_callback` (68) are callbacks | `src/cms/service/Checker.py` |

Supporting modules: `workerpool.py` (remote worker registry), `esoperations.py`,
`scoringoperations.py`, `flushingdict.py` — all in `src/cms/service/`.

## 2. Transport

| Property | Current behaviour | Source |
|---|---|---|
| Framing | CRLF-terminated JSON object per message | `src/cms/io/rpc.py` (framing helpers) |
| Message size cap | `MAX_MESSAGE_SIZE = 1024 * 1024` (1 MiB), enforced on read and write | `src/cms/io/rpc.py:117`, `:279`, `:315` |
| Authentication | shared secret in the request field `__secret`, verified server-side before dispatch | `src/cms/io/rpc.py:443-445`, client sets it at `:718-723` |
| Fail-closed | `_check_rpc_secret` returns false when the configured secret is unset | `src/cms/io/rpc.py:62-74` |
| Concurrency | gevent greenlets; one per connection and one per message | `src/cms/io/rpc.py:393`, `:647`, `:620` |
| Listener | `gevent.server.StreamServer`, one connection handler per accept | `src/cms/io/service.py` |
| Config section | `[rpc]` — `RpcConfig` | `src/cms/conf.py:151` |

## 3. Web servers

### 3.1 Admin web server (Python)

Route table in `src/cms/server/admin/handlers/__init__.py`; 75 routes, grouped here (line in the
route table):

| Group | Routes | Source |
|---|---|---|
| Global | `/` (111), `/login` (112), `/logout` (113), `/resourceslist` (114), `/resources` (115–117), `/notifications` (118), `/file/:digest/:name` (119), `/render_markdown` (120) | `…handlers/__init__.py:111-120` |
| Contests | `/contests` (124), `/contests/add` (126), `/contests/:id/remove` (125), `/contest/:id` (127), `/contest/:id/overview` (128), `/contest/:id/resourceslist` (129) | `:124-129` |
| Contest users | `/contest/:id/users` (133), `/contest/:id/users/add` (134), `/contest/:id/user/:id/remove` (135), `/contest/:id/user/:id/edit` (136), `/contest/:id/user/:id/message` (137) | `:133-137` |
| Contest tasks/results | `/contest/:id/tasks` (141), `/contest/:id/tasks/add` (142), `/contest/:id/submissions` (146), `/contest/:id/user_tests` (147) | `:141-147` |
| Announcements | `/contest/:id/announcements` (151), `/contest/:id/announcements/add` (152), `/contest/:id/announcement/:id` (153) | `:151-153` |
| Questions | `/contest/:id/questions` (157), `/contest/:id/question/:id/reply` (158), `/contest/:id/question/:id/ignore` (159), `/contest/:id/question/:id/claim` (160) | `:157-160` |
| Ranking | `/contest/:id/ranking` (164), `/contest/:id/ranking/:type` (165) | `:164-165` |
| Tasks | `/tasks` (169), `/tasks/add` (171), `/tasks/:id/remove` (170), `/task/:id` (172), `/task/:id/add_dataset` (173), `/task/:id/statements/add` (174), `/task/:id/statement/:id` (175), `/task/:id/attachments/add` (176), `/task/:id/attachment/:id` (177) | `:169-177` |
| Datasets | `/dataset/:id` (181), `/clone` (182), `/rename` (183), `/delete` (184), `/activate` (185), `/autojudge` (186), `/managers/add` (187), `/manager/:id/delete` (188), `/testcases/add` (189), `/add_multiple` (190), `/testcase/:id/delete` (191), `/testcases/download` (192) | `:181-192` |
| Users and teams | `/users` (196), `/users/add` (200), `/users/:id/remove` (197), `/teams` (198), `/teams/add` (201), `/teams/:id/remove` (199), `/user/:id` (202), `/team/:id` (203), `/user/:id/add_participation` (204), `/user/:id/edit_participation` (205) | `:196-205` |
| Admins | `/admins` (209), `/admins/add` (210), `/admin/:id` (211) | `:209-211` |
| Submissions | `/submission/:id(/:n)` (215), `/comment` (216), `/official` (217), `/submission_file/:id` (218), `/submission_diff/:id/:n` (219) | `:215-219` |
| User tests | `/user_test/:id(/:n)` (223), `/user_test_file/:id` (224) | `:223-224` |

### 3.2 Contest web server (Python, participant-facing)

Route table in `src/cms/server/contest/handlers/__init__.py` plus a dynamic root:

| Group | Routes | Source |
|---|---|---|
| Root | `/` (dynamic, registered per contest) | `src/cms/server/contest/server.py:93` |
| Session | `/login` (65), `/logout` (66), `/register` (67), `/start` (68), `/notifications` (69), `/documentation` (70) | `…handlers/__init__.py:65-70` |
| Task views | `/tasks/:name/description` (74), `/tasks/:name/statements/:id(/:path)` (75), `/tasks/:name/attachments/:path` (76) | `:74-76` |
| Submissions | `/tasks/:name/submit` (80), `/submissions` (81), `/submissions/:id` (82), `/submissions/:id/details` (83), `/submissions/:id/files/:path` (85), `/submissions/:id/token` (87) | `:80-87` |
| User tests | `/testing` (91), `/tasks/:name/test` (92), `/tests/:id` (93), `/tests/:id/details` (94), `/tests/:id/(input\|output)` (95), `/tests/:id/files/:path` (96) | `:91-96` |
| Communication | `/communication` (100), `/question` (101) | `:100-101` |
| JSON API | `/api/login` (104), `/api/task_list` (105), `/api/:name/submit` (106), `/api/:name/submission_list` (107) | `:104-107` |

### 3.3 Ranking web server (Python)

| Group | Routes | Source |
|---|---|---|
| Data CRUD | `/` GET/PUT/DELETE and `/:key` GET/PUT/DELETE (83–88), `/:user_id` sublist (293), `/:name` logo get (399) | `src/cmsranking/RankingWebServer.py:83-88`, `:293`, `:399` |
| Public | `/` (506), `/history` (507), `/scores` (508), `/events` (509), `/logo` (510), `/config` (511) | `:506-511` |

## 4. Admin panel HTTP API routes

28 route handlers under `admin-panel/src/app/api/`. Methods per handler:

| Resource | Methods | Source |
|---|---|---|
| contests | POST (`route.ts:8`), PUT (`[id]/route.ts:8`), DELETE (`[id]/route.ts:131`) | `api/contests` |
| tasks | POST (`route.ts:60`), PUT (`[id]/route.ts:80`), DELETE (`[id]/route.ts:107`), GET diagnostics (`[id]/diagnostics/route.ts:6`) | `api/tasks` |
| users | GET (`route.ts:12`), POST (`route.ts:49`), PUT/DELETE (`[id]/route.ts:17,67`), POST bulk (`bulk/route.ts:133`), POST batch (`batch/route.ts:17`), GET credentials (`credentials/[token]/route.ts:11`) | `api/users` |
| teams | POST (`route.ts:7`), PUT/DELETE (`[id]/route.ts:7,43`) | `api/teams` |
| datasets | POST (`route.ts:7`), PUT/DELETE (`[id]/route.ts:7,50`), GET/POST managers (`[id]/managers/route.ts:7,26`), POST clone (`[id]/clone/route.ts:8`) | `api/datasets` |
| testcases | POST (`route.ts:8`), PUT/DELETE (`[id]/route.ts:7,44`) | `api/testcases` |
| statements | POST (`route.ts:8`), DELETE (`[id]/route.ts:7`) | `api/statements` |
| attachments | POST (`route.ts:8`), DELETE (`[id]/route.ts:7`) | `api/attachments` |
| managers | DELETE (`[id]/route.ts:6`) | `api/managers` |
| submissions | PUT (`[id]/route.ts:32`) | `api/submissions` |
| ranking | GET logo (`logo/route.ts:100`), POST (`:144`), DELETE (`:184`); GET/POST/DELETE auth (`auth/route.ts:6,22,68`); GET snapshot (`snapshot/route.ts:30`) | `api/ranking` |
| deploy | GET status (`status/[operationId]/route.ts:7`) | `api/deploy` |

## 5. Admin panel server actions

29 files under `admin-panel/src/app/actions/`: `adminPermissions`, `admins`, `announcements`,
`appearance`, `audit`, `auth`, `containerConfig`, `contests`, `datasets`, `docker-ops`, `docker`,
`env`, `groups`, `monitor`, `participation-sql`, `participations`, `questions`, `ranking`, `search`,
`services`, `statements`, `stats`, `submissions`, `tasks`, `teams`, `testcases`, `users`,
`workerConfig`, `workers`. Several reach the database directly (see section 7) and several control
containers through the Docker socket.

## 6. CLI entry points

Declared in `src/setup.py`:

| Kind | Commands | Source |
|---|---|---|
| Service scripts | `cmsLogService`, `cmsScoringService`, `cmsEvaluationService`, `cmsWorker`, `cmsResourceService`, `cmsChecker`, `cmsContestWebServer`, `cmsAdminWebServer`, `cmsProxyService`, `cmsRankingWebServer` | `src/setup.py:121-130` |
| Database tools | `cmsInitDB`, `cmsDropDB` | `src/setup.py:131-132` |
| Data management | `cmsAddAdmin`, `cmsAddParticipation`, `cmsAddStatement`, `cmsAddSubmission`, `cmsAddTeam`, `cmsAddTestcases`, `cmsAddUser`, `cmsCleanFiles`, `cmsDumpExporter`, `cmsDumpImporter`, `cmsDumpUpdater`, `cmsExportSubmissions`, `cmsImportContest`, `cmsImportDataset`, `cmsImportTask`, `cmsImportTeam`, `cmsImportUser`, `cmsRemoveContest`, `cmsRemoveParticipation`, `cmsRemoveSubmissions`, `cmsRemoveTask`, `cmsRemoveUser`, `cmsSpoolExporter` | `src/setup.py:137-160` |
| Utilities | `cmsRWSHelper`, `cmsMake`, `cmsPrometheusExporter`, `cmsTelegramBot`, `cmsRunFunctionalTests` | `src/setup.py:136,154,161-163` |

Implementations live in `src/cmscontrib/` (one module per command).

## 7. Database access paths

Two applications reach the same database as the same role. There is no service layer between them.

| Path | Mechanism | Source |
|---|---|---|
| Python core | SQLAlchemy models over psycopg2 (greenlet-wrapped) | `src/cms/db/`, `src/cms/io/` |
| Admin panel | Prisma client singleton | `admin-panel/src/lib/prisma.ts` |
| Panel raw SQL (parameterised) | `$queryRaw` / `$executeRaw` in contests repo, fsobjects, statements, tasks, participations, managers, users | `admin-panel/src/lib/contests-repo.ts:118,179`; `admin-panel/src/lib/fsobjects.ts:16,21,26`; `admin-panel/src/app/actions/tasks.ts:108`; `admin-panel/src/app/actions/statements.ts:35,95,143`; `admin-panel/src/app/actions/participations.ts:147`; `admin-panel/src/app/api/contests/route.ts:53` |
| Panel raw SQL (string-built) | `$executeRawUnsafe` with dynamically built `SET` clause | `admin-panel/src/app/actions/tasks.ts:170`; `admin-panel/src/app/api/tasks/[id]/route.ts:76`; `admin-panel/src/app/actions/participation-sql.ts:86` |
| Large objects | `lo_from_bytea` + `fsobjects` digest rows; bytes are not covered by RLS | `admin-panel/src/lib/fsobjects.ts` |

Schema and security SQL live under `admin-panel/prisma/`. Row-level security, roles, and policy
files are enumerated in `THREAT-MODEL.md` and `ARCHITECTURE.md`.

## 8. Configuration surface

| Section | Class | Source |
|---|---|---|
| global | `GlobalConfig` | `src/cms/conf.py:68` |
| database | `DatabaseConfig` | `src/cms/conf.py:80` |
| worker | `WorkerConfig` | `src/cms/conf.py:87` |
| sandbox | `SandboxConfig` | `src/cms/conf.py:92` |
| web_server | `WebServerConfig` | `src/cms/conf.py:107` |
| contest_web_server | `CWSConfig` | `src/cms/conf.py:116` |
| admin_web_server | `AWSConfig` | `src/cms/conf.py:137` |
| proxy_service | `ProxyServiceConfig` | `src/cms/conf.py:145` |
| rpc | `RpcConfig` | `src/cms/conf.py:151` |
| prometheus | `PrometheusConfig` | `src/cms/conf.py:158` |
| telegram_bot | `TelegramBotConfig` | `src/cms/conf.py:164` |

Config file is selected by the `CMS_CONFIG` environment variable with a compiled-in default
(`src/cms/conf.py:217-218`).

## 9. Operational tooling

| Tool | Surface | Source |
|---|---|---|
| Makefile | `env`, `setup`, `core`, `admin`, `contest`, `worker`, `infra`, stop/clean per stack, `pull`, `prisma-sync`, `admin-create`, `lint`, `smoke-test`, `preflight`, `backup`, `audit` | `Makefile:55-405` |
| Launcher | `cms` bash dispatcher (subcommand `case` blocks) | `cms:100,154` |
| Rust CLI | `cms-tui` subcommand enum (`db`, `backup`, `secrets`, `worker`, `tailscale`, `funnel`, `domain`, `config`, `contest`, …) that shells out to `./cms` and the Makefile | `tools/cms-tui/src/cli/mod.rs:122`, `src/main.rs:10` |
| CI | `rust.yml` (fmt, clippy, build, test), `lint.yml`, `build-and-push.yml` | `.github/workflows/` |

## 10. Confirmed-plan inventory (cross-reference)

The user-confirmed single-backend plan carries its own audit, `docs/PHASE0-INVENTORY.md`. This
inventory must stay consistent with its numbers:

| Metric | Value | Source |
|---|---|---|
| Mutating Python handlers | 55 across 11 of 16 modules | `docs/PHASE0-INVENTORY.md` |
| `@require_permission` applications | 95 | `docs/PHASE0-INVENTORY.md` |
| Operations that write the database | 45, of which 16 are multi-write | `docs/PHASE0-INVENTORY.md` |
| Mutating operations with no panel API route | 16 | `docs/PHASE0-INVENTORY.md` |
| Panel server actions | 147 across 29 files, none calling an API route | `docs/PHASE0-INVENTORY.md` |
| Panel API routes | 28 | `docs/PHASE0-INVENTORY.md` |
| Field-permission divergences between the two UIs | 10 | `docs/PHASE0-INVENTORY.md` |

The audit also records operational defects outside this inventory's scope — two TUI files over the
line limit, a linked-but-broken `expose` command, and a shellcheck bug in the smoke test — which
stay as open items in that document and are not repeated here.
