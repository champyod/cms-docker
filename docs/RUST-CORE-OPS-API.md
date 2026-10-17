# The ops API: slice 1 contract

The admin panel does not call the backend. It reads the CMS database through Prisma and it
**shells out**: `child_process` against the docker CLI, the Makefile, the repository's
`scripts/__*.sh`, and the monitor container's backup script. This document is the contract for
replacing that surface with an HTTP API on the Rust core, and the inventory that decides the order.

It is a **contract, not an implementation**. Nothing in this document is decided where the operator
has reserved the decision — see [§5](#5-the-database-schema-and-migration-layer--open), where the
database, schema and migration layer is explicitly **OPEN**. No code accompanies this document; see
[§7](#7-the-skeleton-withheld) for what was stood up and withdrawn.

| | |
|---|---|
| Base branch | `origin/feat/backend-rust` (`82165710`) |
| Inventory read from | `major/admin-panel` (`28ba3d07`), `admin-panel/src` |
| Existing document set | `docs/backend-migration/` — this document extends it, and cites its requirement IDs |

A note on the two bases, because it changes how you read §1. `origin/feat/backend-rust` carries the
Rust workspace (`backend/{cms-audit,cms-db,cms-proto,cms-svc,cms-worker}`) but an **older admin
panel**: on that branch seven modules import `child_process`
(`app/actions/{containerConfig,docker-ops,docker,services,workers}.ts`, `lib/{deploy-store,worker-stats}.ts`).
The backup, restore, TLS/WAF and scheduler modules do not exist there yet. The panel the API has to
replace is the one on `major/admin-panel`, which is where §1 was read; the inventory is a description
of behaviour to move, and it does not depend on which branch the Rust side is cut from. Reconciling
the two panel vintages is a decision for the operator and is not taken here.

## 1. The inventory

### How the count came out

The brief said 22 modules. Reading the tree: **21 modules import `child_process` directly**, and
**7 more construct or name CLI invocations without importing it** (the argv builders below). Four
further modules reach docker *through the two exported helpers of `restore-preview-run.ts`*
(`restore.ts`, `restore-apply-resolve.ts`, `restore-apply-steps.ts`,
`restore-apply-measure-privileges.ts`), which is where the 22nd module comes from depending on how you
count. The honest statement: **21 spawners, plus the builders whose output they spawn, plus 4
transitive callers** — and all of them are in the table below, because an argv builder that stays
behind is a second source of truth for what a container operation means.

Two modules are not shell-outs but belong in this inventory because they are the same defect — the
panel reaching out of its own boundary by hand:

* `lib/evaluation-rpc.ts` opens a TCP socket to the EvaluationService and speaks the raw CMS RPC
  protocol with `RPC_SECRET` from the panel's environment. It is the panel's other out-of-process call.
* `lib/apiClient.ts` is a browser-side fetch client for the panel's own Next routes. It is listed
  only to say what the ops API must **not** imitate: its envelope is `{success, error, data}`, which
  cannot express "the request was fine but the daemon failed".

Command text below is quoted from the code at the base above; `…` elides only argv assembled by the
named builder. Every `docker inspect`/`ps`/`stats` volume is read, so those are the endpoints that can
land first.

### A. Containers and lifecycle

| Module | What it spawns today | Replacing endpoint | Class |
|---|---|---|---|
| `lib/container-probes.ts:62` | `docker ps -a --format "{{json .}}"` | `GET /api/ops/v1/containers` | ops-only |
| `lib/container-probes.ts:88` | `docker inspect <id> --format='{{.RestartCount}}'` | `GET /api/ops/v1/containers/{id}` (`restartCount`) | ops-only |
| `lib/container-probes.ts:100` | `docker inspect <service> --format='{{.State.Status}}:{{.State.Health.Status}}'` | `GET /api/ops/v1/containers/{id}` (merged into the same body) | ops-only |
| `lib/container-probes.ts:121` | `docker stats --no-stream --format "{{.Name}}\t{{.NetIO}}" \| head -n <n>` | `GET /api/ops/v1/containers/usage?limit=<n>` | ops-only |
| `lib/protected-containers.ts:71` | `docker inspect <id> --format '{{.Name}}'` | internal to the service: the protected-name guard becomes server-side policy, not a probe | ops-only |
| `app/actions/docker.ts:33` | `docker logs --tail <n> <id>` | `GET /api/ops/v1/containers/{id}/logs?tail=<n>` | ops-only |
| `app/actions/docker.ts:61` | `docker <start\|stop\|restart\|pause\|unpause> <id>` | `POST /api/ops/v1/containers/{id}/actions` | ops-only |
| `app/actions/docker.ts:139` | `docker inspect <contest-web-server> --format '{{range .Config.Env}}{{println .}}{{end}}'` | `GET /api/ops/v1/deployments/active-contest` — returns the contest id only | ops-only |
| `app/actions/docker.ts:185` | `buildComposeCommand(...)` → `docker compose … <up\|down\|restart\|build> <services>` | `POST /api/ops/v1/stacks/{core\|admin\|contest}/actions` | **contest-critical** (`down`/`restart` on `contest`) |
| `lib/compose-location.ts:74` | `docker inspect <panel> --format '{{range .Mounts}}{{.Source}} {{.Destination}}{{println}}{{end}}'` | server-side only: the host path becomes the service's own configuration | ops-only |
| `lib/restart-planner.ts` | builds `docker compose <flags> -f … --profile … up -d --force-recreate <services>` | folded into the stack endpoint above | ops-only |
| `lib/compose-command.ts` | `bash scripts/__admin_worker_control.sh <action> [<shards>…]` | `POST /api/ops/v1/workers/actions` | ops-only |
| `lib/compose-location.ts:102` | `--project-directory <p> [--env-file <f>]` flags | server-side only | ops-only |

Reading the environment block of the contest web server is called out deliberately: that command
returns the container's whole environment, credentials included. The endpoint that replaces it
returns the one value the caller wanted (the active contest id) and nothing else, which is a
guarantee the shell-out cannot make.

### B. Deploys

| Module | What it spawns today | Replacing endpoint | Class |
|---|---|---|---|
| `lib/deploy-store.ts:51` | `spawn('sh', ['-c', buildDeployScript(cmd), 'cms-deploy', <done>, <error>], {detached:true})`, then `unref()` | `POST /api/ops/v1/deploys` (202 + operation id) | **contest-critical** |
| `lib/deploy-command.ts` | `docker compose <flags> -f <files> --profile core --profile contest up -d <--build\|--no-build> --force-recreate <3 services> && bash scripts/__contest_dns_refresh.sh`, wrapped in `(… pull <services> \|\| true) && …` in `img` mode | server-side: the deploy plan becomes the service's, not the caller's | **contest-critical** |
| `lib/deploy-operation-process.ts:127` | reads `/proc/<pid>/cmdline` (no spawn) | `GET /api/ops/v1/operations/{id}` | ops-only |
| `lib/deploy-config.ts:13` | `bash scripts/__config_sync.sh` | `POST /api/ops/v1/config/sync` | ops-only |
| `app/actions/services.ts:88` | `make env` | `POST /api/ops/v1/config/sync` (same operation) | ops-only |
| `app/actions/services.ts:110` | `plan.command` from `lib/restart-planner.ts` | `POST /api/ops/v1/stacks/{stack}/restart` | ops-only |
| `app/actions/services.ts:188` | the contest deploy command | `POST /api/ops/v1/deploys` | **contest-critical** |
| `app/actions/docker-ops.ts:22` | `make pull` (cwd repo root, 300 s) | `POST /api/ops/v1/images/pull` | ops-only |
| `app/actions/docker-ops.ts:56` | `buildRebuildCommand(stack, mode)` → `DEPLOYMENT_TYPE_OVERRIDE=<mode> make <core\|admin\|worker>` | `POST /api/ops/v1/images/rebuild` | ops-only |
| `lib/make-command.ts` | the `DEPLOYMENT_TYPE_OVERRIDE=… make …` string | server-side | ops-only |
| `app/actions/serviceWiring.ts:226` | `FRONT_RELOAD_COMMAND` | `POST /api/ops/v1/wiring/render` | ops-only |
| `app/actions/serviceWiring.ts:231` | `docker compose -f docker-compose.tailscale.yml up -d <services>` | `POST /api/ops/v1/stacks/tailscale/actions` | ops-only |
| `app/actions/serviceWiring.ts:240` | `restart.command` | as above | ops-only |
| `lib/service-wiring-cli.ts` | the renderer CLI (`renderFromPayload`, `renderRegistryArtifacts`, `parseCertificate`, `parseFrontVhosts`) | `POST /api/ops/v1/wiring/render` — the registry payload becomes the request body, off the command line | ops-only |

`serviceWiring.ts:231` is the one place the panel still drives a compose file *directly instead of
through the planner*; the endpoint should not preserve that asymmetry.

### C. Backups and restores

| Module | What it spawns today | Replacing endpoint | Class |
|---|---|---|---|
| `app/actions/backups.ts:65-69` | `docker exec -d <monitor> bash /usr/local/bin/cms-backup.sh --tables <csv> [--large-objects] [--root <r>] --who <who>` | `POST /api/ops/v1/backups` | ops-only |
| `lib/backup-export-stream.ts:42` | `docker exec <monitor> bash /usr/local/bin/cms-backup.sh --tables <csv> --stdout` | `GET /api/ops/v1/backups/export?tables=<csv>` (streamed) | ops-only |
| `app/actions/backupActions.ts:29` | the backup command, cwd repo root | `POST /api/ops/v1/backups` | ops-only |
| `src/scheduler/tick.ts:192` | builds `['exec','-d',<monitor>,'bash',…,'--tables',<csv>]` | as above, driven by the schedule the API owns | ops-only |
| `app/actions/restore-apply.ts:99` | `docker exec -d <monitor> bash /usr/local/bin/cms-backup.sh` | `POST /api/ops/v1/backups` | ops-only |
| `app/actions/restore-preview-run.ts:50` | `docker <args>` (generic runner; also `scratchQuery`) | `POST /api/ops/v1/restores/previews` and the query endpoints under it | ops-only |
| `app/actions/restore-apply-lock.ts:76` | `spawn('docker', ['exec','-i','-e','PGPASSWORD=…', <live>, 'psql','-v','ON_ERROR_STOP=1','-U',…,'-d',…,'-t','-A','-q'])` — an interactive session held open for the staging lock | `POST /api/ops/v1/restores/{id}/lock` | **contest-critical** (it writes the live database) |
| `app/actions/restore-apply-measure.ts:264` | `docker exec -e PGPASSWORD=… <live> psql -v ON_ERROR_STOP=1 -U … -d … -t -A -c <sql>` | `POST /api/ops/v1/restores/{id}/measure` | **contest-critical** |
| `app/actions/restore.ts:100` | `docker run --name <preview> --label … -e POSTGRES_* -d <scratch image>` | `POST /api/ops/v1/restores/previews` | ops-only |
| `app/actions/restore.ts:108` | `docker cp <dump> <preview>:<path>` | server-side | ops-only |
| `app/actions/restore.ts:111` | `docker exec -e PGPASSWORD=… <preview> pg_restore -U … -d … -Fc --no-owner --no-privileges --exit-on-error <path>` | server-side | ops-only |
| `app/actions/restore-apply-resolve.ts:80,144` | `docker exec <c> psql … -c <sql>` | `POST /api/ops/v1/restores/{id}/resolve` | **contest-critical** |

The restore path is where this slice must be most careful. `restore-apply-lock.ts` holds a `psql`
session open across several calls to keep a staging lock, and `restore-apply-measure.ts` passes a
**password on the argv of a `docker exec`** — visible in the host process table. Both are shapes the
API removes rather than reproduces: the lock becomes server-side transaction state, and the password
never leaves the service's environment.

### D. Worker fleet

| Module | What it spawns today | Replacing endpoint | Class |
|---|---|---|---|
| `lib/worker-stats.ts:144` | `bash scripts/__worker_status_json.sh` (cwd repo root) | `GET /api/ops/v1/workers` | **contest-critical** (it is the grading fleet's health) |
| `lib/worker-stats.ts:234` | `docker ps -a --filter "name=cms-worker" --format "{{.Names}}\t{{.Status}}"` | folded into the same body | ops-only |
| `lib/compose-command.ts:11` | `bash scripts/__admin_worker_control.sh <action> [<shards>…]` | `POST /api/ops/v1/workers/actions` | **contest-critical** (stopping a shard mid-contest) |

### E. Container configuration

| Module | What it spawns today | Replacing endpoint | Class |
|---|---|---|---|
| `app/actions/containerConfig.ts:173` | `docker update --restart=<policy> <id>` | `PUT /api/ops/v1/containers/{id}/restart-policy` | ops-only |
| `app/actions/containerConfig.ts:186` | `docker inspect <id> --format='{{.HostConfig.RestartPolicy.Name}}:{{.HostConfig.RestartPolicy.MaximumRetryCount}}'` | `GET /api/ops/v1/containers/{id}/restart-policy` | ops-only |

### F. TLS and WAF

| Module | What it spawns today | Replacing endpoint | Class |
|---|---|---|---|
| `app/actions/securityTls.ts:47` | `docker inspect <grader-nginx-proxy\|grader-certbot> --format '{{.State.Status}}'` | `GET /api/ops/v1/security/tls` | ops-only |
| `app/actions/securityTls.ts:111` | writes a JSON request into a queue directory (no spawn; a host agent consumes it) | `POST /api/ops/v1/security/tls/renewals` | **contest-critical** (a renewal that fails expires the front) |
| `app/actions/securityWaf.ts:80` | `tail -n <n> <audit log path>` | `GET /api/ops/v1/security/waf/events?tail=<n>` | ops-only |
| `app/actions/securityWaf.ts:89` | `docker inspect grader-waf --format '{{.State.Status}}'` | `GET /api/ops/v1/security/waf` | ops-only |
| `app/actions/securityWaf.ts:190` | `buildWafRecreateCommand(...)` → `(docker compose … -f docker-compose.domain.yml -f docker-compose.waf.yml --profile core --profile waf pull grader-waf \|\| true) && … up -d --no-build --force-recreate grader-waf` | `POST /api/ops/v1/security/waf/recreate` | **contest-critical** (it is the request front) |
| `app/actions/securityWaf.ts:214` | `buildWafRestartCommand()` → `docker restart grader-waf` | `POST /api/ops/v1/security/waf/restart` | **contest-critical** |
| `lib/security/waf-compose.ts` | both builders above | server-side | ops-only |

The TLS renewal is already a queue file rather than a spawn: the panel writes intent and a privileged
host agent acts. That is the shape the API keeps — the endpoint enqueues, and the agent's consumer
becomes the API's, not a directory the panel writes to.

### G. The scheduler

| Module | What it spawns today | Replacing endpoint | Class |
|---|---|---|---|
| `src/scheduler/runner.ts:74` | `docker <args>` where `args` is the backup argv built in `tick.ts` | `GET/POST /api/ops/v1/schedules`, `/api/ops/v1/schedules/{id}` | ops-only |
| `src/scheduler/tick.ts:299` | `launcher.launch(argv.args)` → the same `docker exec -d` | as above | ops-only |

The panel's `src/scheduler` is the **backup** scheduler (a second Node process beside Next, own
`tsconfig.build.json`, own entry `bootstrap.mjs`/`main.ts`). It is not the contest scheduler and not
the grading queue. It is the last thing in this inventory that should move, but it is also the one
that becomes *simpler* by moving: today it owns schedule rows, run rows and the spawn of the backup,
and the API that owns the backup can own its runs.

### What is not in this inventory

`app/actions/*.ts` modules that read or write the database through Prisma are a separate migration and
a separate contract. They appear here only where they also shell out. No file under
`admin-panel/src/app/api/**` (the panel's own HTTP surface) is in scope.

## 2. The caller, the token and the scope

### What exists today, and where the boundaries already are

Four boundaries are already in place and this model reuses them rather than inventing a fifth:

1. **The admin's identity** is an HS256 JWT signed with `AUTH_SECRET` in an HTTP-only cookie, 2 h
   expiry with a 7-day sliding window (`lib/auth.ts`, `jose`). Server-side only; the browser never
   sees the secret.
2. **The panel container holds the docker socket read-write.** Anything the panel process can be made
   to run, it can run as root on the host. This is the reason this work exists.
3. **The panel already holds a shared secret for an internal service**: `RPC_SECRET` in its
   environment, used by `lib/evaluation-rpc.ts` over TCP.
4. **A socket-proxy overlay exists** (`docker-compose.socket-proxy.yml`) but the admin compose still
   mounts the socket directly.

### The decision: a mounted service token, and the acting admin carried as a claim

The panel authenticates to the ops API with **a service token read from a mounted file**, presented
as `Authorization: Bearer <token>`, and the token carries the **scopes** the panel's role may use plus
the **acting admin's id**. Concretely: an HS256 JWT whose signing key lives in a secret file mounted
into the panel container and into the API container, with `iss: admin-panel`, `aud: cms-ops-api`,
`scopes: ["ops:containers:read", …]`, `act: {"adminId": 41}`, and a short expiry.

Why this and not the alternatives:

* **Not the session cookie forwarded through.** The cookie is the *admin's* credential and belongs to
  the browser session's trust boundary (boundary 2). Forwarding it would make the ops API a
  participant in the panel's session model — it would have to verify `AUTH_SECRET`, agree on cookie
  names, and inherit the panel's sliding-window semantics. It also couples the API's availability to
  the panel's login state.
* **Not the docker socket.** The socket is what is being removed. An API that still needs a
  read-write socket in the caller has moved the problem, not solved it. The API mounts the socket (one
  reader instead of two); the panel stops mounting it in the lane that switches the panel over.
* **Not a unix socket between panel and API.** The two are on a shared docker network, the rest of the
  deployment talks TCP, and a socket only works when both are on one host; the dev/test compose and
  the per-role composes would each need a volume. It solves no problem a token does not.
* **Not `RPC_SECRET` reused.** Its whole weakness is already recorded in the threat model's residuals:
  "single shared secret, no per-caller identity… a replacement should be designed to carry an
  identity". Reusing it would carry that residual forward. The new token carries identity
  (`act.adminId`) and a scope set, which is what that residual asks for.

What the token **forbids**, and these are the properties to hold it to:

* The panel cannot escalate: the scopes are what the deployment granted it, and the API checks the
  scope per route, not per request.
* Identity travels *with* the request, so the audit row is written by the API from `act` rather than
  trusted from a request body. No endpoint accepts an actor id as input.
* The key is one secret in two containers. A rotation is a restart of both; that cost is accepted
  because it buys a per-caller identity the alternative cannot express.
* The browser never holds this token. It is server-side only, exactly as `AUTH_SECRET` and `RPC_SECRET`
  already are (REQ-S12).

Failure is closed: no token, an unverifiable token, or a token missing the route's scope is a refusal.
A missing key file fails the process at startup rather than at the first request.

### Scope per hostname under one router

One router, one binary, one image. The reverse proxy routes `/api/ops/*` to the same service on every
hostname, and **what differs per hostname is the scope the token carries** — the panel on
`panel.<domain>` gets the full ops scope set; an operator-facing hostname (or the CLI's own
credentials) gets the narrower set it needs. The service therefore does not branch on the `Host`
header, and a hostname cannot widen a token: the scopes are in the signed token, and the router asks
"does this principal carry `ops:waf:control` for this route", never "which hostname did this arrive
on".

That property is what makes the per-hostname split a *policy* change rather than a code change. It is
also what makes it testable: one route table, one scope per route, one test per route asserting that a
token without the scope gets `403` and a token with it does not.

| Route family | Scope |
|---|---|
| `GET /api/ops/v1/containers*`, `/usage`, `/logs` | `ops:containers:read` |
| `POST /api/ops/v1/containers/{id}/actions`, `/stacks/*/actions`, `/stacks/*/restart` | `ops:containers:control` |
| `PUT /api/ops/v1/containers/{id}/restart-policy`, `POST /api/ops/v1/config/sync` | `ops:config:write` |
| `POST /api/ops/v1/deploys`, `/images/*`, `/wiring/render` | `ops:deploys:write` |
| `GET /api/ops/v1/backups*` | `ops:backups:read` |
| `POST /api/ops/v1/backups`, `/restores/previews` | `ops:backups:write` |
| `POST /api/ops/v1/restores/{id}/{lock,measure,resolve}` | `ops:restores:apply` |
| `GET/POST /api/ops/v1/workers*` | `ops:workers:read`, `ops:workers:control` |
| `GET /api/ops/v1/security/*` | `ops:security:read` |
| `POST /api/ops/v1/security/waf/*` | `ops:waf:control` |
| `POST /api/ops/v1/security/tls/renewals` | `ops:tls:renew` |
| `/api/ops/v1/schedules*` | `ops:schedules:write` |

### The CLI and the workers, later

Both get the same mechanism and a different scope set; neither gets a special case in the router.

* **`tools/cms-tui`** (the operator's CLI, `cms`): authenticates as the operator, not as the panel —
  its own token, issued by whatever issues the panel's, with the ops scopes it needs and no `act`
  claim (an operator is the actor). Today it runs on the host with the operator's own rights; when it
  moves onto the API the loose command-line surface it has now becomes a scope set.
* **Workers (`cms-worker`)**: they are peers on the *grading* path, not callers of the ops API. Their
  existing authentication is the RPC shared secret and is untouched by this slice. When the RPC
  transport is replaced, the same token mechanism carries the caller's identity (`service:worker`,
  `service:evaluation`), which is what retires the residual above.
* **Internal hop to the database**: the API connects as the application role, never as superuser and
  never with `BYPASSRLS` (REQ-S07). See §5 — the *form* of that connection is open, the constraint is
  not.

## 3. The error and the audit row

### One envelope

Every refusal from the ops API is:

```json
{ "error": { "code": "forbidden", "message": "the token does not carry `ops:containers:control`" } }
```

`code` is a closed set — `unauthenticated`, `forbidden`, `bad_request`, `not_found`, `conflict`,
`dependency_unavailable`, `dependency_error`, `internal_error` — so a client branches on one value
rather than on strings. `message` is prose no caller parses. `dependency_unavailable` is the code the
panel's current `{success, error}` envelope cannot express, and it carries the distinction that
matters operationally: "the docker daemon did not answer" is not "your request was wrong", and the
panel's UI needs to say which.

The request id travels in the `x-request-id` response header, not in the body, so a failure that never
produced a body is still correlatable with the server's log line.

Status mapping: `unauthenticated` → 401, `forbidden` → 403, `bad_request` → 400,
`not_found` → 404, `conflict` → 409, the two dependency codes → 502/503, `internal_error` → 500 with
no detail in the body.

### Where the audit row is written

Today the panel writes it: `lib/audit.ts` builds an entry
(`{verb, entity, entityId, beforeValues, afterValues, reason, result, actorId}`), requires a reason
for a destructive verb (`assertReasonForDestructive`), chains it with
`computeEntryHash(previousHash, canonicaliseEntry(entry))`, inserts it, and fans out a web and a
Discord notification.

Once the API owns the action, **the API owns the row**, and the rule is: *the row is written by the
same writer that performed the action, in the same operation*. Concretely:

* The API writes the row through `cms-audit` (the workspace's append-only writer), not a second
  writer of its own — the constraint this contract inherits from the workspace it lands in.
* The actor comes from the **verified token** (`act.adminId`), never from the request body. An
  endpoint that accepted an actor id would put the panel back in charge of its own attribution.
* `beforeValues`/`afterValues` and `result` come from what the operation actually did. `result:
  failure` with the refusal's code is written for a refused or failed action, which is when the row
  matters most.
* The `reason` requirement and the destructive-verb classification move to the API with the verb. A
  destructive verb without a reason is a `bad_request` before anything is touched, not a row written
  after.
* The notification fan-out (web + Discord) is a *consumer* of the audit row, not part of the write
  path: it moves to whatever consumes rows, so the panel and the API cannot both notify.

Two properties must not be lost in the move, and both are stated here as requirements on the switch:

1. **Exactly one writer per action.** In the lane that moves a verb, the panel's `recordAudit` call
   for that verb is deleted in the same change. Two writers means two rows per action, and a chain
   that proves nothing.
2. **The chain stays continuous.** `computeEntryHash` chains each row to its predecessor. A writer
   that appends without the chain, or a row inserted with the chain's columns left null, breaks the
   property the log exists for. §5 records the open question about which store the row lands in; the
   chain obligation holds under either answer.

## 4. Slice order and the parity harness

### Order within slice 1

The ordering rule is: **read-only first, ops-only before contest-critical, and never a write whose
answer differs under load.** Within that:

1. **`GET /api/ops/v1/containers`** — the safest, most-read operation in the inventory. It is a
   read-only `docker ps -a`, it is already polled by the panel's container views, its body shape is
   already fixed by the panel's `ContainerInfo`, and nothing in the contest path depends on it.
2. `GET /api/ops/v1/containers/usage`, `GET /api/ops/v1/security/{tls,waf}`,
   `GET /api/ops/v1/workers` — remaining reads (worker stats is a read of contest-critical data, but
   still a read).
3. `GET /api/ops/v1/containers/{id}/logs` — a read with a size bound; the bound is the whole
   difference between it and #1.
4. `GET /api/ops/v1/containers/{id}/restart-policy`, `GET /api/ops/v1/operations/{id}`.
5. `POST /api/ops/v1/containers/{id}/actions` — the first write. Ops-only, reversible by the same
   call, and the one the panel's own UI exercises most.
6. Then the ops-only writes that change files or images: `config/sync`, `images/pull`,
   `images/rebuild`, `wiring/render`, backups, restore previews.
7. **Last, and never mid-contest**: stacks (`up`/`down`/`restart` on `contest`), deploys, worker
   actions, WAF recreate/restart, TLS renewal, and the restore-apply family. These change what the
   contest is doing; the operator schedules them.

### The parity harness

The point of the harness is to answer "does the endpoint return what the shell-out returned" without
running both against production. Three parts:

1. **Record.** For each operation, capture the shell-out's own stdout/stderr/exit code, the argv that
   produced it, and the environment it ran in (compose file list, deployment mode, host location), as
   a fixture. `docker ps -a --format "{{json .}}"` output is the natural first fixture: it is text,
   and the API's parser reads exactly that text.
2. **Replay and compare.** The API's docker access is behind a seam that can be fed those bytes
   instead of a live daemon, so an endpoint's answer is computed from the recorded output in a test.
   The comparison is *field by field against the panel's own parser*, not against a hand-written
   expectation — the panel's `parseContainerList` is the reference, and a difference in a field is a
   bug in the new code or a finding about the old one.
3. **Dual-run in the dev stack.** In the dev/test compose the panel and the API both run; the panel's
   view is compared with the endpoint's body for the same instant. Divergence is reported, not
   resolved automatically. This is REQ-F10's shape ("verified through the real user-facing path")
   applied to one operation at a time.

The harness runs before the panel switches, and the switch for an operation is one commit: endpoint
live, panel call replaced, panel's shell-out deleted, panel's audit call for that verb deleted.

## 5. The database, schema and migration layer — OPEN

**This section decides nothing.** The operator has taken the stack decision back and is choosing it
now, and the rule he has set is: *SQL and database migrations are generated only — nothing writes SQL
by hand, and nothing uses a shell script that prints literal SQL text.*

What that rule already implies for the material in this repository, recorded here so it is not
rediscovered later:

* **It disqualifies the current generator as a policy source.** `scripts/__generate_rls_sql.sh` reads
  `admin-panel/prisma/schema.prisma` (line 9) and the migration history (line 10) and *prints* SQL
  text — `ALTER TABLE … ENABLE ROW LEVEL SECURITY` / `FORCE ROW LEVEL SECURITY` guards per model. It
  is a script that prints literal SQL, which the rule forbids.
* **It disqualifies the hand-written policy set as a source too.** The permissive policies live in a
  committed migration, `admin-panel/prisma/migrations/20260912000400_rls_policies/migration.sql`
  (`CREATE POLICY cmsuser_all ON public.<t> FOR ALL TO cmsuser USING (true) WITH CHECK (true)`, with
  `audit_log` and `submissions` carved out), and the role layout in
  `admin-panel/prisma/sql/20260820120000_db_roles.sql` +
  `20260820125000_backup_role.sql` + `20260912000500_owner_hardening.sql`. Under the rule these are
  re-expressed as declarations, not hand-kept SQL.
* **It disqualifies `sqlx` as the authoring tool.** `sqlx` is SQL-first: the SQL is typed by hand and
  the macro checks it. That is precisely what the rule excludes, so the workspace crate that assumes
  it — `cms-db`, 2046 lines — is **SQL-first and violates the rule, and will be re-authored** under
  whichever tool is chosen. This is stated as a fact about the base branch, not as a criticism of the
  work: it was written before the rule existed.
* **The schema's home moves with the rule.** The generator's *input* is `admin-panel/prisma/schema.prisma`,
  so the schema is owned by the panel today. Under a generated-only pipeline the declaration is the
  source of truth and every artefact — DDL, policies, the Rust types — is generated from it, which
  means the panel stops owning the schema. **This conflicts with REQ-F08** ("Prisma remains the
  authority for tables; the schema is unchanged by this work", priority P0). The two cannot both hold
  once generation is the rule, and that is a decision for the operator, not for this document.

### What the API must be held to whatever is chosen

These are constraints on the API, not decisions about the store, and they are recorded because the
slice that first writes to the database needs them settled:

1. **One connection, one role.** The API connects as the application role (`cmsuser` on today's
   layout) — never as the owner-for-DDL role, never as superuser, never with `BYPASSRLS` (REQ-S07).
   The backup role's `BYPASSRLS` stays a backup-only property.
2. **Every write runs inside a transaction that has set its actor**, so the scope is structural rather
   than a convention a code path can forget. The mechanism is whatever the chosen tool generates;
   `set_config('cms.actor', $actor, /* local */ true)` is the *requirement* it has to satisfy — a
   setting that dies with the transaction, so an actor cannot leak to the next borrower of a pooled
   connection.
3. **The policies must become load-bearing, and one table goes first.** Today every generic table
   carries `USING (true) WITH CHECK (true)` for `cmsuser`, which under `FORCE ROW LEVEL SECURITY`
   *enables* RLS without *deciding* anything; `audit_log` is the only table with a real guarantee (no
   UPDATE/DELETE policy exists, so those verbs are denied by absence). The first table to get a
   predicate is **`audit_log`**, because it is the first table the API writes (see §3) and its whole
   value is that it names who did what. The predicate that makes it load-bearing:

   ```sql
   -- SELECT and INSERT only; UPDATE/DELETE stay absent, which is what denies them.
   USING      (current_setting('cms.actor', true) IS NOT NULL)
   WITH CHECK (current_setting('cms.actor', true) IS NOT NULL)
   ```

   `missing_ok = true` makes an unset actor `NULL` rather than an error, so the predicate reads "no
   actor, no rows" — a code path that forgot to set the actor is refused **by the database** on the
   first statement instead of writing unattributed rows. `submissions` and its results are the second
   family, where the predicate has to express "the participant's own rows, or the permission that
   governs them"; that is a generated declaration, not a stipulation this document makes.
4. **Nothing of Python or Next.js touches the database directly** once the API owns writes (REQ-F14).
   The panel's Prisma reads are a separate, later migration; the constraint is on the *write* path.

## 6. How `cms-worker` relates to the Python workers

They are the same thing in two languages, at different points on the path, and the distinction
matters for this inventory.

* `backend/cms-worker` is the Rust counterpart of the Python **worker service**
  (`src/cms/service/Worker.py`, RPC method `execute_job_group` at `:103`): it runs one job group at a
  time, refuses a second concurrent request instead of queueing it, launches runs through the
  isolation program (`cms-worker/src/sandbox`), and decides each run's outcome from the execution log
  (`ExecutionStats`, `measure.rs`, `stats.rs`). It is on the **grading path**, which makes it
  contest-critical by definition.
* It does **not** replace the Python **EvaluationService** (`cms/service/EvaluationService.py`), nor
  the checker/scorer services, nor the resource/log/proxy services. Those are separate RPC peers.
* It has nothing to do with the panel's `src/scheduler` (backup schedules) or with the worker *fleet
  control* in §1D. Today the panel observes and controls the worker fleet from **outside** it — a
  `docker ps --filter name=cms-worker`, a status emitter script, and `__admin_worker_control.sh`. Those
  are the ops endpoints; they do not require `cms-worker` to exist, and they keep working while the
  Python workers are still the ones grading.
* The consequence for sequencing: a slice may put worker-fleet *observation* on the API while
  `cms-worker` is nowhere near replacing the Python worker. The two migrations are independent, and
  the ops endpoints must be written so they observe "the worker fleet", not "the Rust workers".

## 7. The skeleton: withheld

A walking skeleton for the endpoint in §4 step 1 was started inside the existing workspace, on the
instruction that the router and handlers go in `cms-svc`, the DB layer in `cms-db`, and the wire types
in `cms-proto`. It was **withdrawn uncommitted** when the stack was taken back, and no part of it was
committed. Nothing SQL-related was ever written: no migration, no DDL, no policy, no table
definition, and no `set_config` helper.

Withdrawn, and where the files are held (moved aside, not deleted, so nothing is lost):

| Held at | Files |
|---|---|
| `~/.hermes/cache/scratch/rust-core-hold/new-lane-cms-proto-api/` | `mod.rs`, `container.rs`, `envelope.rs`, `health.rs` — the wire types (`ContainerInfo` mirroring the panel's, the error envelope, the health body) |
| `~/.hermes/cache/scratch/rust-core-hold/old-lane-rust-crate/` | a first attempt at a standalone `rust/` workspace: `Cargo.toml`, `api/Cargo.toml`, `api/src/{error,docker,auth}.rs`, `api/tests/fixtures/docker_ps_ndjson.txt` (the recorded `docker ps` fixture from the harness in §4). This attempt is superseded by the instruction to work inside the existing workspace; the lane that held it was removed and its branch deleted (never pushed) |
| reverted in the working tree | `backend/Cargo.toml` — the workspace dependency additions the skeleton needed (axum, tower, tower-http, tracing, utoipa, uuid, secrecy, jsonwebtoken, tokio, http-body-util) were removed again, so the manifest is exactly as the base branch has it |

What it established, kept as proposals rather than claims, and to be re-decided with the stack:

* The endpoint's body is the panel's `ContainerInfo`, in camelCase, unchanged — the panel's views read
  `isCmsContainer` and `protected`, so a second spelling is the defect the work exists to remove.
* The container list is a **pure function of the daemon's own output text** (`docker ps -a --format
  "{{json .}}"`), so the port that reaches the daemon can be fed recorded bytes and the endpoint
  tested without a daemon. That is the harness in §4 part 2, and it needs no database.
* The error envelope is the one in §3, and it is the only new shape the API introduces.

## 8. What this document asks the operator to decide

| # | Question | Blocking |
|---|---|---|
| 1 | The generation tool for schema/DDL/policies (the rule is set; the tool is not). | The `cms-db` re-authoring, and every slice that writes. |
| 2 | Where the schema declaration lives once `admin-panel/prisma/schema.prisma` stops being the input — this contradicts REQ-F08 as written. | Same as 1. |
| 3 | Which panel vintage the API replaces: `major/admin-panel`'s surface (this inventory) or `feat/backend-rust`'s seven modules. | The scope of slice 1 beyond the first endpoint. |
| 4 | `cms-svc` as the home of the router (as instructed) versus `cms-api` as a crate of its own, which is what `docs/backend-migration/ARCHITECTURE.md` proposes. | Where slice 1's code lands. |
| 5 | Whether the ops API and the RPC transport end up on one wire (REQ-F06's phased move) or stay two. | The CLI's and the workers' client. |
