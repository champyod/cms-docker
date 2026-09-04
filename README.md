# CMS Docker Deployment

Scalable, containerized deployment for the [Contest Management System (CMS)](https://github.com/cms-dev/cms).

> **📚 New to CMS?** Check out our [**Step-by-Step Tutorial**](docs/TUTORIAL.md) for a complete walkthrough!

---

## Choose Your Deployment Path

| Path | Command | Best for |
|------|---------|----------|
| **1. One-stop script** ⭐ | `./cms` | Everyone. Zero-arg full bootstrap, resumable |
| **2. Pre-built images** | `make env && make core-img ...` | Fast production deploys |
| **3. Build from source** | `make env && DEPLOYMENT_TYPE=src make core ...` | Custom CMS patches / air-gapped |
| **4. Raw docker compose** | `docker compose --profile core up -d --build` | Compose-native workflows |

All four paths share one config step (`make env`) and one consolidated
[`docker-compose.yml`](docker-compose.yml) with service profiles
(`core`, `admin`, `contest`, `worker`, `monitor`).

---

## 0. Prerequisites

```bash
git clone https://github.com/champyod/cms-docker.git
cd cms-docker
git submodule update --init --recursive   # pulls the CMS Python source

# Linux worker hosts additionally need (once, root):
sudo ./scripts/__worker_cgroup_setup.sh     # prepares isolate cgroup path
```

Requirements: Docker Engine + compose plugin, ~8 GB free disk for images,
bash. The `./cms` entrypoint already carries the executable bit in git;
if a checkout loses it: `chmod +x cms`.

---

## 1. One-Stop Script (Recommended)

`./cms` walks the entire lifecycle and stops loudly at the first real
problem, telling you how to fix it:

```
prereqs → env → core → cms-init → prisma-sync → admin
        → contest (+ sample import if DB empty) → worker → monitor
        → superadmin prompt → health matrix summary
```

```bash
chmod +x cms          # only needed if the bit was lost in transfer
./cms                 # everything, interactive where it matters
```

Useful variants:

```bash
./cms --yes                  # non-interactive (CI): prints manual cmds instead of prompting
./cms --skip worker,monitor  # partial bring-up; every step is idempotent — re-run resumes
./cms --no-sample            # don't import examples/contests.yaml into an empty DB
./cms --no-tui               # force plain CLI mode (skip TUI routing — for scripting/SSH)
make setup                   # same thing via Makefile (CMS_ARGS="--no-sample" make setup)
```

Deployment mode is picked from `DEPLOYMENT_TYPE` in `.env.admin`
(`img` = pull pre-built images from GHCR, `src` = build locally).
Override per-invocation with `DEPLOYMENT_TYPE_OVERRIDE=src ./cms`.

---

## 2. Manual: Pre-Built Images

Fastest production path — pulls versioned images from GHCR.

```bash
cp .env.core.example .env.core      # then edit credentials!
# ... optionally copy other .env.*.example files ...
make env                            # merge envs, render configs, run preflight gate

make pull                           # fetch all stack images
make core-img                       # database + RPC services (health-gated)
make cms-init                       # create/patch DB schema
make admin-create                   # interactive superadmin
make prisma-sync                    # sync Admin Panel schema
make contest-img admin-img infra-img
make worker-img                     # needs host cgroup prep (see Prerequisites)
```

## 3. Manual: Build From Source

Builds the CMS image locally from `src/` (all grading languages included).
Set it once in `.env.admin` (`DEPLOYMENT_TYPE=src`) or per-command:

```bash
cp .env.core.example .env.core      # then edit credentials!
make env

DEPLOYMENT_TYPE=src make core       # builds + starts core stack
make cms-init
make admin-create
DEPLOYMENT_TYPE=src make admin contest worker infra
```

Legacy `*-img` targets still work as deprecated aliases and now force
image mode regardless of `DEPLOYMENT_TYPE`.

## 4. Manual: Raw Docker Compose

The single `docker-compose.yml` exposes five profiles. Cross-stack
dependencies are health-gated, so activate prerequisite profiles together:

```bash
set -a; source .env.core; set +a    # or export your values

# Core first (creates shared network/volumes):
docker compose --profile core up -d --build

# Contest stack (core is its dependency — include both profiles):
docker compose --profile core --profile contest up -d --build

# Worker (host cgroup prep required) / Monitor:
docker compose --profile worker up -d
docker compose --profile monitor up -d
```

Image-vs-source is controlled by `IMG_TAG` + each service's
`build:` block: add `--build` to compile from source, use
`pull` + `up -d --no-build` for registry images.

---

## Updating an Existing Deployment

Pick by scenario:

### Config changes only (passwords, ports, contest ID, limits)
```bash
./cms update        # interactive wizard over every managed variable
# or edit .env.* directly, then:
./cms               # idempotent re-run: regenerates configs, recreates changed containers
```

### Repair broken/missing config non-interactively
```bash
./cms fix           # restores missing secrets, fixes insecure defaults
```

### Platform update (new code / new images)
```bash
git pull && git submodule update --init --recursive
./cms update-server     # safe path: preflight -> auto-backup -> rolling recreate -> health verify
                        # records old image digests + git HEAD to /tmp/cms-update-*.txt for manual rollback
./cms doctor            # post-check if you skipped it inside update-server
```

### Rollback
`update-server` never auto-reverts. On failed health checks it prints the
recorded digests; restore with:
```bash
git checkout <recorded_git_head>
docker compose -f docker-compose.yml --profile <stack> pull   # or retag digests
docker compose -f docker-compose.yml --profile core --profile <stack> up -d --no-build --force-recreate
# database rollback: scripts/__backup.sh output + scripts/__restore.sh <dump>
```

### Data safety
Schema-affecting updates are covered by the automatic backup taken before
any container is recreated (`make backup` equivalent). Test restorability
anytime with `./cms backup drill`.

---

## `./cms` Command Reference

One control plane for everything. Zero-arg = full bootstrap; subcommands
below map 1:1 onto the Makefile and helper scripts.

| Command | Purpose |
|---------|---------|
| `./cms` | Full bootstrap lifecycle (idempotent, resumable) |
| `./cms setup` | First-time guided setup — fresh install **or** update wizard on existing installs |
| `./cms update` | Interactive configuration wizard (any managed variable) |
| `./cms update all` | Alias for `update-server` — full server update |
| `./cms fix` | Non-interactive repair of missing/insecure config |
| `./cms deploy <stack> [--img]` | Start one stack (`core/admin/contest/worker/infra`) or `all`; `--img` forces registry images |
| `./cms stop [stack]` / `clean [stack]` / `pull [stack]` | Lifecycle per stack or all |
| `./cms db init\|reset\|clean\|sync` | Database shortcuts (init schema, full reset, wipe, Prisma sync) |
| `./cms admin-create` | Create a superadmin interactively |
| `./cms status` | Live service status dashboard |
| `./cms monitor` | Monitoring/backup operations UI |
| `./cms backup [drill\|offsite]` | Full backup now; `drill` proves the restore path; `offsite` syncs to a remote backup node |
| `./cms restore <archive>` | Restore a backup archive into a scratch container |
| `./cms secrets rotate\|audit\|generate` | Rotate weak/default secrets (apply guarded), audit current values, generate new |
| `./cms doctor` | Preflight checks only (disk, secrets, ports, cgroup) |
| `./cms test` | Smoke-test: boot stacks headless, verify healthchecks, teardown |
| `./cms worker` / `edit` | Fleet TUI: list/add/edit/delete workers, live status, batch deploy |
| `./cms worker deploy [shard]` / `stop` | Deploy all/some fleet entries non-interactively / stop them |
| `./cms worker server` | TUI: choose which main server this worker connects to |
| `./cms worker connect\|cgroup` | Attach to a worker / prepare host cgroups (root) |
| `./cms contest create <yaml...>` | Batch-create contests from YAML/JSON |
| `./cms funnel setup\|passwd\|remove\|status` | Public ts.net access behind basic auth — no tailnet needed |
| `./cms domain setup\|status\|renew\|preflight` | HTTPS domain lifecycle for `DOMAIN_NAME` (TLS certs + Nginx) |
| `./cms config sync [--dry-run]` / `edit` / `show` | Generate `.env.*` + `cms.toml` from `config.toml` / open it in `$EDITOR` / print it |
| `./cms update-server` | Safe server update: preflight → backup → rolling recreate → verify |

Global bootstrap flags: `--yes` (non-interactive), `--skip <a,b>`,
`--no-sample`, `--no-tui` (force plain CLI).

---

## Access Points

| Service | URL | Notes |
|---------|-----|-------|
| Modern Admin Panel (Next.js) | http://localhost:8891 | Manage everything here |
| Contestant Interface | http://localhost:8888 | Per-contest port via `CONTEST_ID` |
| Classic Admin Panel | http://localhost:8889 | Legacy Python UI |
| Ranking | http://localhost:8890 | Live scoreboard |

---

## Tailscale-Only Admin & Ranking Access (HTTPS)

Recommended exposure for admin/classic/ranking UIs: hide their raw ports
and reach them through your tailnet with automatic TLS.

### 1. Stop exposing raw ports
In `.env.admin` bind all three services to loopback only:

```
ADMIN_NEXT_BIND_IP=127.0.0.1   # admin panel  :8891
ADMIN_BIND_IP=127.0.0.1        # classic admin :8889
RANKING_BIND_IP=127.0.0.1      # ranking      :8890
```
Then `./cms deploy admin --img` (recreates with new binds).

### 2. Pick exposure per UI with one TUI

`./cms expose` opens an interactive matrix over all five UIs
(contest-web, nginx-front, classic-admin, ranking, admin-panel):

```
 sel  service         wiring (sel → active)        port    url hint
 >    contest-web     local      → public          8888   http://<host>: 8888
      classic-admin   ts-https   → local           8889   https://<node>.ts.net:8844
 ...
```

Cycle each row through **local** (127.0.0.1) · **public** (0.0.0.0) ·
**ts-http** (bound to your tailscale IP — WireGuard-encrypted plain HTTP)
· **ts-https** (loopback + automatic browser TLS via tailscale serve),
then ⏎ applies it and offers stack recreation.

> **Does ts-https need the tailscale IP?** No. The backend stays on
> loopback; `tailscale serve` publishes it at
> `https://<node>.<tailnet>.ts.net:<port>` with the node's auto-renewed
> certificate. The IP form is only used by the separate *ts-http* mode.

### 3. Or front them with Tailscale HTTPS directly (free plan OK)

One command registers all three listeners and can hide the raw ports:

```bash
./cms tailscale setup --hide-ports   # serves + rebinds .env.admin to loopback
./cms deploy admin --img             # apply the new binds
./cms tailscale status               # inspect listeners + mapping
./cms tailscale remove               # undo
```

Manual equivalent, if you prefer:

```bash
sudo tailscale serve --bg --https=8843 http://127.0.0.1:8891   # admin panel
sudo tailscale serve --bg --https=8844 http://127.0.0.1:8889   # classic admin
sudo tailscale serve --bg --https=8845 http://127.0.0.1:8890   # ranking
tailscale serve status
```

Bootstrap automation: set `TAILSCALE_SERVE=1` in `.env.admin` and every
`./cms` run re-registers the listeners automatically after the admin stack
is healthy.
Browse to `https://<machine>.<tailnet>.ts.net:8843/` etc.
Certificates issue and renew automatically per machine.

**Free-plan limit?** The TLS certificate is issued **per machine**, not per
service — one node cert covers unlimited HTTPS listeners/ports. Portainer
on another node uses its own cert; even on this node extra `serve` entries
are free. No 3-service cap exists.

Traffic inside the tailnet is WireGuard-encrypted end-to-end regardless.

### Remote worker machines

On each worker host (after its own `./cms` bootstrap), pick the main server
it talks to:

```bash
./cms worker server     # TUI: add/select main servers; Enter sets CORE_SERVICES_HOST
./cms worker deploy all # deploy local shards against the selected main
```

Candidates persist as `WORKER_MAIN_<n>=label|host` in `.env.worker`.

Contest web stays public through `cms-nginx-contest` (enable TLS there via
`ENABLE_TLS=true` when a public domain + certs are available).

---

## Validation & Operations

```bash
make preflight     # disk floor (3 GB), secrets, ports, cgroup — fails loudly
make lint          # shellcheck + hadolint + yamllint + compose config validation
make smoke-test    # boot stacks headless, poll healthchecks, teardown (keeps volumes)
make backup        # full pg_dump (-Fc, incl. large objects) + volume tar + manifest
scripts/__restore.sh <dump>            # restore into scratch container (never live w/o --force)
scripts/__backup_drill.sh                # end-to-end restore proof
make db-clean      # FULL RESET: down -v across all profiles
```

Backups land in `./backups/{db,volumes}` with SHA256 sidecars and a
rotation policy (count/age/size) enforced by the monitor container.

---

## Architecture

One [`docker-compose.yml`](docker-compose.yml), five profiles:

| Profile | Services |
|---------|----------|
| `core` | PostgreSQL · LogService · ResourceService · ScoringService · CheckerService |
| `admin` | AdminPanelNext (:8891) · AdminWebServer (:8889) · RankingWebServer (:8890) · optional PrintingService |
| `contest` | ContestWebServer (:8888+) · EvaluationService · ProxyService · nginx (TLS option) |
| `worker` | Sandboxed isolate workers (`WORKER_SHARD` unique per instance) |
| `monitor` | Health/backups/Discord alerting (non-root, docker.sock via `DOCKER_GID`) |

Startup ordering is healthcheck-gated (`depends_on: condition:
service_healthy`) — no sleep hacks. Shared resources are plain named
volumes/network declared once; no `external:` coupling between stacks.

### Multi-Contest & Remote Workers
* Set `CONTEST_ID` in `.env.contest` (canonical; legacy `ACTIVE_CONTEST_ID`
  still mapped by `make env` with a warning). Ports follow
  `CONTEST_PORT_EXTERNAL`.
* Remote workers: point `.env.worker`'s `CORE_SERVICES_HOST` /
  `POSTGRES_*` at the main host, keep RPC bindings on the Tailscale IP
  (`TAILSCALE_IP` in `.env.core`), then `make worker` on that machine.
* Batch-create contests:
  `./scripts/__create_contests.sh -f examples/contests.yaml`
  (names must be codename-safe: `[A-Za-z0-9_-]`).

---

## Configuration Files

| File | Purpose |
|------|---------|
| `.env.core` | Source of truth: DB creds, bind IPs, shards |
| `.env.admin` | Panel ports, `DEPLOYMENT_TYPE=img\|src`, `AUTH_SECRET` |
| `.env.contest` | `CONTEST_ID`, ports, TLS, submission limits |
| `.env.worker` | Shard id, resource limits, cgroup path |
| `.env.infra` | Discord webhook, thresholds, backup rotation, `DOCKER_GID` |
| `config/cms.toml` | Rendered CMS config — regenerated by `make env`; containers always reach the DB as `database:5432` over the compose network |

Secrets hygiene: generated files are chmod 600 on POSIX filesystems
(NTFS mounts ignore chmod — preflight detects this and skips the check);
preflight hard-fails on placeholder/default secrets with fix instructions.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Preflight aborts with placeholder-secret message | Fill real values in the named `.env.*` file, re-run |
| `worker` exits citing `ISOLATE_CGROUP_PATH` | Run `sudo ./scripts/__worker_cgroup_setup.sh` once on that host |
| Monitor can't reach docker.sock | Set `DOCKER_GID` in `.env.infra` to `stat -c %g /var/run/docker.sock` |
| CWS logs "no contest with the specified id" | Import a contest or align `CONTEST_ID`: `./scripts/__create_contests.sh -f examples/contests.yaml` |
| Config changes not applying | `make env` never overwrites existing `config/cms.toml`; delete it to force regeneration |
| Disk near-full during pulls | Images total ≈ 6–7 GB; preflight aborts under 3 GB free — prune with `docker system df` guidance |

## Useful References

| Doc | Purpose |
|-----|---------|
| [docs/TUTORIAL.md](docs/TUTORIAL.md) | Step-by-step first contest walkthrough |
| [docs/QUICKREF.md](docs/QUICKREF.md) | Command cheat sheet for daily operations |
| [docs/ACCESS-CONFIGURATION.md](docs/ACCESS-CONFIGURATION.md) | Binding IPs, ports, and exposure modes |
| [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md) | External dependencies and versions |
| [docs/optional-features.md](docs/optional-features.md) | HSM, Vault, DNSSEC/CAA, mTLS, rate limiting, monitoring stack |
| [docs/waf-tuning.md](docs/waf-tuning.md) | WAF (ModSecurity CRS) enablement and tuning |
| [docs/csp-implementation.md](docs/csp-implementation.md) | Content-Security-Policy details |
| [docs/dnssec-caa-guide.md](docs/dnssec-caa-guide.md) | DNSSEC + CAA record setup |
| [docs/WORKER-SETUP.md](docs/WORKER-SETUP.md) | Remote worker host preparation, step by step |
| [docs/SERVICE_GUIDE.md](docs/SERVICE_GUIDE.md) | Service dependencies and restart ordering |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Extended troubleshooting beyond the table above |
| [docs/PORTAINER-GUIDE.md](docs/PORTAINER-GUIDE.md) | Managing the stack from Portainer |

Historical release notes: [docs/RELEASE_NOTES_v1.1.2.md](docs/RELEASE_NOTES_v1.1.2.md).

## License

AGPL-3.0 (Derived from CMS)
