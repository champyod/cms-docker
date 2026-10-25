# Security feed — Renovate + Diun + host rootfs scan → the panel

**Decided by the operator 2026-10-24.** Scope: give the panel one place that answers *"is anything I run
out of date or known-vulnerable, and what do I do about it"* — without touching the hosts.

## The rule this ships under

The hosts are **operator-manual**: no host script, no host package, no new host environment variable, ever.
Everything below is a **container** (compose service) or a **CI job**. A convenience that would need a host
install is out of scope by construction.

The other standing rule: **one source of truth per fact.** The feed has exactly **one** consumer (the panel),
**one** ingest endpoint, **one** findings table, and **one** waiver table. A producer never writes the
database directly and never keeps its own copy of what it reported.

## Producers (four, all containers)

| producer | answers | cadence | what it emits |
|---|---|---|---|
| **Renovate** (`ghcr.io/renovatebot/renovate`) | "a newer version of X exists" — repos: **compose files** (`docker-compose` manager, `/(^|/)(?:docker-)?compose[^/]*\.ya?ml$/`), Dockerfiles, `bun.lock`, `requirements`/`constraints.txt`, `Cargo.lock`, GitHub Actions | daily | **PRs** and its dependency-dashboard issue. **Not findings**: Renovate has no notifier to POST to, so it owns the *actionable* half and the panel links to it rather than waiting for it |
| **osv-scan** (`ghcr.io/google/osv-scanner`) | "**our own dependencies** have a known advisory" — `osv-scanner scan source -r` over the checked-out tree (bun.lock, constraints.txt, Cargo.lock) against the OSV database | nightly + on demand | JSON → `POST` (this is the half Renovate cannot deliver: an advisory without a version bump) |
| **Diun** (`crazymax/diun`) | "the image I am **running** is not the digest the registry now serves" — Docker provider, local socket | `DIUN_WATCH_SCHEDULE`, default every 6 h | webhook POST on `new`/`update` |
| **rootfs-scan** (`ghcr.io/aquasecurity/trivy`, same binary as `aquasec/trivy`) | "the **host's own** OS packages have CVEs" — without installing anything on it | nightly + on demand | JSON from `trivy rootfs` POSTed to the panel |

Verified while writing this, not recalled:

- `trivy rootfs [flags] ROOTDIR` — the command exists and works against a mounted filesystem; `aquasec/trivy`
  and `ghcr.io/aquasecurity/trivy` are the **same image** (identical digest `sha256:790fd66d…` when pulled
  2026-10-24). The old `aquasecurity/trivy` Hub name no longer resolves.
- `osv-scanner` runs as `ghcr.io/google/osv-scanner`, usage `osv-scanner scan source -r <dir>` (the image's own
  `--help`, run 2026-10-24).
- Diun's webhook notifier is configured `DIUN_NOTIF_WEBHOOK_ENDPOINT` / `_METHOD` / `_HEADERS_<KEY>`, and its
  documented JSON body carries `status`, `provider`, `image`, `digest`, `created`, `platform`, `metadata`.
- Renovate ships as `renovate/renovate` and `ghcr.io/renovatebot/renovate`; the CLI **processes repos then
  exits**, so a scheduler is what makes it periodic — and its documented output channels are PRs and the
  dashboard issue, with no findings webhook. **Do not invent one.**

**Every image above is pinned by digest** (`tag@sha256:…`) per
`docs/decisions/image-digest-pinning.md`: an unpinned reference would make "the digest the registry
now serves" move without a commit, and Diun's `update` event is only meaningful against a pin that
someone chose to move.

**Host read-only guarantee for the rootfs scan:** the host root is mounted `:ro`, the scan runs with
`--scanners vuln --pkg-types os`, and the container has **no** write mount anywhere except its own cache
volume. It cannot change a host package even if it wanted to. `--pkg-types os` is what keeps the run to the
host's package database instead of walking every file under `/home`.

**Two coverage facts, measured 2026-10-24, that the implementation must honour:**

- Trivy's OS scanning covers the distro the hosts run: against a freshly extracted **Ubuntu 22.04** rootfs the
  command above returned one result, class `os-pkgs`, **37 vulnerabilities**. Against this dev box (CachyOS,
  Arch/pacman) the same command returned **no `Results` at all** — Arch is not covered. A dev-box run is
  therefore not a proof of the host path; the Ubuntu fixture is.
- **An empty scan must never resolve anything.** If trivy reports no `Results` entry of class `os-pkgs`, the run
  is *incomplete*, not clean — pushing `complete: true` there would mark every existing host finding resolved and
  silently clear the box's CVE list. The rootfs producer therefore pushes `complete: false` (or exits non-zero and
  pushes nothing) whenever the package database was not read. The same rule binds the osv producer: `complete:
  true` only on exit 0 with a parsable report.

## Consumer — the panel

### Tables (Prisma, one migration, generated-style naming as the repo does)

```
model security_findings {
  id           Int      @id @default(autoincrement())
  source       String   @db.VarChar   // renovate | diun | rootfs
  key          String   @db.VarChar   // stable identity within the source
  kind         String   @db.VarChar   // image | os-package | dependency | advisory
  severity     String?  @db.VarChar   // CRITICAL | HIGH | MEDIUM | LOW | UNKNOWN (null when a producer has none)
  subject      String   @db.VarChar   // image ref, package name, or dependency name
  installed    String?  @db.VarChar
  available    String?  @db.VarChar   // version that fixes it, when known
  title        String?  @db.VarChar
  url          String?  @db.VarChar
  host         String?  @db.VarChar   // which box reported it, for diun/rootfs
  detail       Json?
  first_seen   DateTime @default(now())
  last_seen    DateTime @updatedAt
  resolved_at  DateTime?
  @@unique([source, key])
  @@index([resolved_at, severity])
}

model security_waivers {
  id          Int      @id @default(autoincrement())
  source      String   @db.VarChar
  match       String   @db.VarChar   // the finding key, or a CVE id the finding carries
  reason      String
  review_by   DateTime               // not optional: a waiver without a date is how a hole becomes permanent
  created_by  Int
  created_at  DateTime @default(now())
  ended_at    DateTime?
}
```

**Resolution is never a delete.** A finding that stops being reported gets `resolved_at` set by the ingest
call (the producer sends its full current set); history stays readable and the audit row keeps its subject.

### Ingest

`POST /api/security/findings` — one endpoint, all three producers.

- Auth: `Authorization: Bearer ${SECURITY_FEED_TOKEN}`; the route rejects with 401 otherwise, and the token
  is compared in constant time. No cookie/session path — this is machine-to-machine inside the tailnet.
- Body: `{ "source": "diun|rootfs|osv", "host": "<name>", "findings": [ … ], "complete": true,
  "run_started_at": "2026-10-25T10:00:00Z" }`.
  `run_started_at` is **required** — the instant the producing run began, sent with every push of that run.
  `complete: true` licenses the route to resolve this source's findings (`host`-scoped when the push names
  one) that were last seen **before `run_started_at`**; a partial push (`false`) must never resolve anything.
  WHY resolution is run-scoped and not push-scoped: a host scan is delivered in batches (34,606 findings is
  139 of them), and "everything this body did not mention" would close the earlier batches' own rows — that
  happened once, on a live host, taking 34,500 findings with it. A row this run touched carries
  `last_seen >= run_started_at`, wherever it arrived.
- Validation: schema-checked at the boundary (source enum, key ≤ 200 chars, severity in the allowlist,
  array ≤ 2000), 422 with the offending index, never a stack trace.
- Each accepted push writes one `audit_log` row (`security.findings.ingest`, actor = the source).
- Rate limited per source, and the body size capped — a feed endpoint is still an input boundary.

### Surface

One new field in the existing **security** module — `security.patching` — plus four cards on the existing
`security.overview` page. It is **not** a new top-level module: the security group already owns WAF, blocks
and TLS, and the overview already renders cards from `app/actions/security*.ts`.

- `security.patching` requires `security:read` + `patching:read`, matching how `security.waf` and
  `security.tls` gate themselves.
- The page lists: unresolved findings grouped by source, each row carrying severity, subject, installed →
  available, host, first/last seen, and the waiver state (`none` / `active until <date>` / **`expired`**).
- Cards added to `security/overview`: **Stale images**, **Unresolved CVEs**, **Expired waivers**,
  **Host OS updates available**. They read from the same actions module the page uses — one read path.
- Build it from the app's existing components (`Card`, the list/table and `BulkActionBar` primitives, the
  dictionary-driven labels, both locales). No new one-off table component.

### Waivers

`security_waivers` is the *only* waiver mechanism, and it replaced the two ad-hoc escapes that used to
exist: `.trivyignore` (three CVEs, "Dated 2026-10-10") and `bun audit --ignore GHSA-vfj7-8cjw-p6xm`.
Neither exists any more — both files/flags are gone, and a test (`tests/security-waiver-suppression-sources.test.ts`)
fails if either comes back. A finding covered by a waiver is **not hidden** — it renders as `waived` with its
`review_by`, and once `review_by` passes it renders as **`expired`** and counts in the overview card. That is
the whole point: a waiver is a decision with a date, not a deleted line.

A row needs all four things, and each is refused at its own layer:

| field | what it answers | refused by |
|---|---|---|
| `match` | what it covers (a finding key, or a CVE/GHSA id the finding carries) | the write path, and the export boundary in `lib/security/waiver-gate.ts` |
| `reason` | why | `NOT NULL` in the migration, the write path, the export boundary |
| `review_by` | when the decision is re-read | `NOT NULL` in the migration, the write path (must be in the future), the export boundary |
| `created_by` | who | `NOT NULL` in the migration, resolved from the session by the server action (the CLI files it under `root`) |

### Suppressions in CI

**How CI learns the waivers.** The panel's read path renders them to a committed file, once, where the
database is:

```
(cd admin-panel && bun run scripts/security-waivers.ts export)   # writes security/waivers.json
```

`security/waivers.json` is machine output — `{version, generatedAt, waivers[]}` from the same
`readWaiverExport()` query the page reads. It is never hand-edited: the gate refuses a row with no reason,
no owner, no review date, an unknown `source`, a duplicate id, an ended row, or a version it does not know.
CI then, on a plain checkout with no credential at all:

| job | command | what it does |
|---|---|---|
| `waivers` | `scripts/__security_waivers.sh check` | fails the build, naming ids and dates, when any waiver is past `review_by`, when the export is malformed, or when the export is older than 30 days |
| `panel` | `... render --audit-ids $RUNNER_TEMP/waiver-audit-ids` | the only `--ignore` ids `bun audit` receives are the live `osv` waivers |
| `container-scan` | `... render --trivy .trivyignore` | writes Trivy's ignore file from the live `rootfs` waivers; expired and ended ones are not written, so they stop suppressing immediately |
| `image-scan` (nightly) | `... render --trivy .trivyignore` | the same ignore file, for the pinned **third-party** images — see "Nightly image scan" below |

**Why this is the least-privilege option.** The alternatives were an API read with a scoped token, or a
generated artifact committed by a scheduled job. A token — even a read-only one — is a credential that
reaches the panel from a hosted runner, and the panel is tailnet-only: it would mean either publishing a
read endpoint to the internet or putting a tailnet identity in CI, and it would make every PR depend on a
live panel. A scheduled job that commits the export needs a repo write token *and* still lets the file go
stale between runs. The committed export gives CI **no credential, no network and no database access**; the
only thing it can do is read a JSON file that already exists in the tree, and the 30-day bound plus the
export-boundary validation are what keep that file honest.

**Why a stale export cannot hide a suppression.** Expiry is judged against the current clock, so a lapsed
date fails even in an old file. A waiver missing from the export can only make CI *stricter* — the finding
it used to cover fails the scan, and the fix is to re-render. The one direction the age bound closes is an
ended waiver still suppressing because nobody re-rendered, which is why a month-old export fails rather
than warns.

**Renewing.** There is no edit: ending a waiver and filing a new one is the decision trail, and the gate
keeps failing until the lapsed row is ended (`cms panel waiver end <id> --reason …`, or the page). Then
re-render the export and commit it with the renewal — otherwise the next run reads the old file, and the
30-day bound is the only thing forcing the refresh.


## Nightly image scan (CI, advisory)

**What runs.** `.github/workflows/image-scan.yml`, nightly at **03:17 Asia/Bangkok** (`17 20 * * *` UTC) and
on demand (`workflow_dispatch`). It is **not** part of `ci.yml` and **not** in that file's required `CI`
aggregator: a finding here arrives overnight, without a commit, so reddening a PR for it would be a gate on
something the PR did not cause. It holds `contents: read` + `issues: write` and nothing else — no registry
login, no host, no deploy token.

**What it scans.** Every third-party `image:` reference in the compose files this repository ships
(`docker-compose*.yml`, `docker/docker-compose*.yml`; `*generated*` and gitignored files skipped), with
`${VAR:-default}` resolved to its default — the reference a checkout actually runs. The list is
**discovered, never hardcoded** (`scripts/__image_scan.sh refs`), so a new service is covered the day it
lands, and the workflow fails when the list comes back empty rather than reporting a clean scan of nothing.
Each ref is scanned at the digest committed in `docker-compose*.yml` — scanning a floating tag would answer
a question nobody asked, because nothing deploys it. Severity `CRITICAL,HIGH` with `--ignore-unfixed` and the
rendered `.trivyignore`: the same policy and the same waivers as `container-scan`.

**What it reports, and where.** The job summary lists every scanned ref with its total CRITICAL/HIGH count,
its fixable count and its top three packages — so the unfixed tail stays visible without failing a run
(measured 2026-10-25: `postgres:15` 88 findings of which 26 are fixable, 3 of those waived today so the job
counts 23; `nginx:alpine` 1; `redis:7-alpine` 0; the whole set 13 refs). The job
itself fails **only** on a fixable CRITICAL/HIGH. Notification is **one upserted issue**, titled
`Nightly image scan: fixable CVEs`: created if absent, body replaced each run, closed with a one-line
`Clean as of <date>` when there is nothing fixable. Its body carries a hidden
`<!-- image-scan:state=… refs=… fixable=… drift=… at=… run=… -->` marker, and a run that cannot reach a
verdict replaces the body with an **INCOMPLETE** notice rather than leaving the previous table standing as
if it were current.

**Digest drift.** For every pin it asks the registry what that tag serves *now* (Docker Hub and GHCR
anonymous token flow) and compares it to the committed digest. A differ means a newer build of the tag we
already run exists — the cheapest fix, independent of CVE data. A check that cannot answer (429 after
retries, 401 on a repo we cannot read, no digest header) is reported as **`unknown`, never `up to date`**.
Measured 2026-10-25: all 13 refs matched, which is what makes the equality meaningful rather than vacuous.

**What it can and cannot see.**

- **Sees:** the pinned third-party images, at the digest pinned, OS and library CVEs (CRITICAL/HIGH), and
  whether the pin is behind the tag.
- **Does not see our own images.** `ghcr.io/champyod/*` is skipped by design: those refs are built by this
  repo's CI, selected at deploy time by `${IMG_TAG}` rather than pinned, and `ci.yml`'s `container-scan`
  scans the image it builds from our Dockerfile on the push that produces it. This workflow covers the half
  CI cannot: the images we pull.
- **Does not see** an operator's env override (`ACME_CERTBOT_IMAGE`, `IMG_TAG`), anything pulled outside
  compose, severities below HIGH, or a fixable finding the waiver table currently covers (waived ids are
  filtered exactly as in CI, and their `review_by` gates keep the lapse visible through the `waivers` job).
- **Does not gate anything.** It never runs on a PR and is not a required check.

**When the issue appears.** Read the table: `fixable` > 0 means a fixed release exists in that image's
repository now. In order of preference: (1) bump that one image's digest to what its tag serves today
(`docker buildx imagetools inspect <ref>`), one image per commit, per
`docs/decisions/image-digest-pinning.md`; (2) if the fix is not in any usable tag yet, file a
`security_waivers` row with a `review_by` date — the only suppression mechanism, never a second ignore file;
(3) for a **drift** row, bumping the digest is the cheap win and often clears the CVE rows with it. An
**unknown** row is not a clearance: it means the registry could not be read, so check by hand.


## Compose shape

`docker-compose.security.yml`, additive overlay in the same style as `docker-compose.monitoring.yml`:

- one `profiles: [security]` gate, off unless the operator enables it;
- four services as shipped: `renovate`, `diun`, `security-scan` (one image, `osv`/`rootfs`/`schedule`
  modes) and `diun-bridge`; every published port bound to `127.0.0.1`;
- **why a fourth service:** Diun notifies one image per POST and its body is not this contract's body, so
  something has to translate it. `diun-bridge` is that translator, running the same purpose-built image —
  the alternative was a host-side receiver, which the container-only rule forbids. It always pushes
  `complete: false`, because a single-image notification says nothing about the other images;
- the host mounts in the whole overlay are `/:/rootfs:ro` on `security-scan` and `/var/run/docker.sock:ro`
  on `diun` — both read-only, and nothing in the overlay writes to the host;
- env in `.env.security` (gitignored) with `.env.security.example` committed — `SECURITY_FEED_TOKEN`,
  `RENOVATE_TOKEN`, `DIUN_*`, `SECURITY_SCAN_SCHEDULE`;
- documented in `config.toml.example [infra]` the way `MONITORING_ENABLED` is, with the same default-off
  convention and the same "why" comment.

## Acceptance

1. `docker compose -f docker-compose.yml -f docker-compose.security.yml --profile security config` is valid.
2. A dry run of each findings producer (`osv-scan`, `diun`, `rootfs-scan`) against the dev box produces a
   payload the ingest route accepts (`201`), and a second identical push changes nothing but `last_seen`.
   Renovate's acceptance is a real dry run against the repo (`renovate --dry-run` over the config) that lists
   the compose-file updates it *would* open PRs for — that is its half, and no POST is expected from it.
3. `complete: true` sets `resolved_at` on this source's rows last seen before the push's `run_started_at`;
   `complete: false` never resolves anything, and rows written earlier in the same run stay open.
4. `security.patching` renders for an admin with `security:read` **and** `patching:read`, 403s without
   `patching:read`, and the four overview cards match the page's numbers.
5. `tsc` 0, `lint` 0 errors, the panel suite green, icons gate green.
6. Nothing was installed, written or reconfigured on any host; the only host interaction is a read-only mount.
7. `bash scripts/__security_waivers.sh check` fails on an expired waiver, naming its id and date, and passes
   once the lapsed row is ended and a replacement is filed and the export is re-rendered.

## Operating

Everything below is a container action. Nothing here installs, writes or reconfigures anything on a host.

**Enable the feed on a box — one command**

`make security-up`. It starts the `monitoring`, `security` and `security-signal` profiles as **eight named
services** and touches nothing that is serving contestants. `make` is the home for this rather than
`./cms` because every `./cms <verb>` is dispatched by the Rust cms-tui binary (`tools/cms-tui`,
`cli/mod.rs`) — a new operator verb there means a Rust change and a rebuilt binary on every host — while
optional-profile bring-up already lives in the Makefile beside `infra`, `waf`, `domain` and `proxy`.
`scripts/__security_stack.sh` owns the argv, the prerequisite gate and the plan renderer.

```bash
make security-dry-run    # 1. what would happen — reads only, changes nothing
make security-check      # 2. the prerequisites, each failure naming what breaks
make security-up         # 3. the same plan, then the up, then the cross-checks
make security-off        # off-switch: stops ONLY the eight overlay containers
```

The invocation underneath is exactly this — the eight names and `--no-deps` are the whole safety
property, so they are visible here rather than hidden in a script:

```bash
docker compose --env-file .env --env-file .env.security \
  -f docker-compose.yml -f docker-compose.monitoring.yml -f docker-compose.security.yml \
  --profile monitoring --profile security --profile security-signal \
  up -d --no-deps \
  prometheus grafana node-exporter renovate diun diun-bridge security-scan security-signal
```

`make security-print` prints it resolved for the host it runs on. Both env files are passed because
`--env-file` replaces `.env` rather than adding to it; `.env.security` only overrides the keys it sets.

**Why the service list is not cosmetic.** `docker-compose.security.yml` adds Diun's opt-in labels to
`admin-panel-next`, `nginx-proxy`, `database`, `redis-rate-limit`, `monitor` and `worker`. A label is part
of a container's config hash, so the obvious spelling — `--profile security up -d` over the merged
project — plans a **recreate** for all six. Measured on compose v5 with a two-service probe: a scoped
`up -d <name>` left a sibling whose labels had changed untouched (same container ID); the unscoped
`up -d` replaced it (new container ID). That is a full restart of the panel, the proxy and the database
caused by enabling an optional feed, on a box mid-contest. `tests/test_security_profiles_enable.sh`
pins the scoped form.

**Proving the resulting set is a superset.** `make security-dry-run` renders the project twice: once with
only these three profiles (the set the command will start) and once with every profile enabled (the
resulting project model), then compares both against what is running now:

```
SUPERSET PROOF  (docker compose config, every profile enabled)
  running now in project cms : 6  [cms-admin-panel-next cms-database cms-monitor cms-nginx-contest ...]
  in the resulting model     : 25 services
  dropped by this command    : 0
  -> the resulting container set is a SUPERSET of the running one; nothing is dropped

CONTAINER SET
  prometheus   grader-prometheus   no-op   092eb471e037a5ec
  ...
  create 0 · start 0 · no-op 8 · recreate 0
```

The `action` column is the decision compose itself makes: it compares the rendered service hash with the
container's `com.docker.compose.config-hash` label. `no-op` means a second run replaces nothing;
`create` means the container does not exist yet; `start` means it exists and is stopped.

**Before the first run, fill in `.env.security`**

1. `cp .env.security.example .env.security` and fill in `SECURITY_HOST` (`hostname -s`),
   `SECURITY_FEED_TOKEN` (`openssl rand -hex 32` — the panel needs the same value), and
   `RENOVATE_TOKEN` + `RENOVATE_REPOSITORIES` if Renovate is wanted.
2. `SECURITY_ENABLED=1` in `.env.security` (or in `config.toml` `[infra]`, which `./cms config sync`
   writes to `.env`). With the profile up and the flag at `0` the containers start and do nothing: the
   scan scheduler exits, Renovate idles, the Diun translator accepts and drops. `make security-check`
   refuses that state, because "the stack is up" would be a false success; `SECURITY_ARGS=--allow-idle`
   stages it deliberately.
3. `DISCORD_WEBHOOK_URL` in `[infra]` / `.env`. The signal works without it — it reads Postgres and
   Prometheus and dedupes through `audit_log` — but `lib/discord-notifier.ts` drops the message, so a
   lapsed waiver, an unwaived CRITICAL or a stale backup reaches nobody. The gate says so and refuses;
   `SECURITY_ARGS=--feed-only` starts the feed without the signal instead.

**What the gate checks, and what breaks if it is ignored**

| check | if nobody looks |
|---|---|
| `SECURITY_FEED_TOKEN` set | the ingest route rejects every push with 401 by design — findings never land, the patching page stays empty, every producer logs a 401 per run |
| `DISCORD_WEBHOOK_URL` set | the signal runs, dedupes and logs, but no human is paged |
| `SECURITY_ENABLED=1` | eight containers run and do no work |
| `PROMETHEUS_BIND_IP` / `GRAFANA_BIND_IP` / `SECURITY_BRIDGE_BIND_IP` loopback | Grafana's login and the translator's write path are published on a routable address |
| `prometheus` resolves from the panel container | the panel's digest card and the four patching cards read `cannot evaluate` for backup staleness — fail-closed, permanently, and the signal then pages "cannot evaluate" once per window |

The name lookup is run **inside** `cms-admin-panel-next` (`node -e 'require("dns").lookup(...)'`), because
that is where `PROMETHEUS_URL` is read; a name that resolves on the host proves nothing. On a first
enable the panel is normally already running, so the check is real; with no panel running it is reported
as *unverified*, never as passed, and `make security-verify` repeats it once the panel is up.

**What you will see on first enable — nothing is instant**

- **The patching page is empty until the first `security-scan` run pushes a report.** The schedule is
  `SECURITY_SCAN_SCHEDULE` (`0 3 * * *`). To see it now, run one by hand — same image, same POST path:
  `docker compose ... run --rm security-scan all` (see below). An empty page before that run means "no
  producer has reported yet", not "nothing is vulnerable".
- **The digest card reads `cannot evaluate` until Prometheus has scraped `cms_backup.prom` once**, which
  is ~15 s after `node-exporter` starts and only if a backup has run (the textfile is written by
  `publish_backup_metrics`). That is the fail-closed answer by design: a missing series is not "healthy",
  and the card says so rather than claiming the backups are fine.
- **Discord stays quiet.** The signal pushes only what a human must act on and cannot discover from one
  page: a waiver past `review_by`, an unwaived CRITICAL, `cms_backup_stale`/`cms_offsite_stale` = 1, or a
  copy whose staleness cannot be evaluated. Dedupe lives in `audit_log` (`security.signal.notified`), so
  the first enable of a healthy box sends nothing, and re-enabling after an off-switch does not re-page a
  fact someone was already told.
- **Ports are loopback**: Prometheus `127.0.0.1:9090`, Grafana `127.0.0.1:3001`, the Diun translator
  `127.0.0.1:8099`. `node-exporter` publishes none (scraped internally as `node-exporter:9100`).

**Off-switch — and what survives it**

`make security-off` stops exactly the eight overlay containers (`stop`, not `down`, not `rm`). Nothing is
deleted, so `make security-up` starts them again with no pull and no rebuild.

- **Findings and waivers survive**: they are rows in the panel's database (`security_findings`,
  `security_waivers`). The panel keeps rendering them while the overlay is down — no producer needed.
- **The audit trail survives**, including every `security.findings.ingest` and
  `security.signal.notified` row, which is what the signal dedupes against.
- **Volumes survive**: `cms-prometheus-data`, `cms-grafana-data`, `cms-diun-data`, `cms-renovate-cache`
  and `cms-security-scan-cache`. The scan cache is disposable — it holds Trivy's vulnerability database
  and the next run re-downloads it — so `docker volume rm cms-security-scan-cache` is a safe reclaim.
- To make the containers go away as well: `docker compose ... rm -f <the same service list>`.

**Run one scan by hand** (same image, same POST path, no waiting for the schedule):

```
docker compose --env-file .env --env-file .env.security \
  -f docker-compose.yml -f docker-compose.security.yml run --rm security-scan osv        # dependencies in the checked-out repo
docker compose ... run --rm security-scan rootfs     # host OS packages, read-only
docker compose ... run --rm security-scan all        # both
```

The command exits non-zero when it pushed `complete: false` — that is the signal the scan could
not claim a full set (a scanner failed, or trivy found no OS package database it can read, which
is the normal result on Arch/CachyOS hosts). `complete: false` never resolves anything, so an
unreadable host never clears its own CVE list.

To see the payload without a panel, point `PANEL_URL` at any HTTP sink and read the body:

```
PANEL_URL=http://127.0.0.1:8000 docker compose ... run --rm security-scan rootfs
```

**Test the Diun translation by hand** (the translator is the only thing that maps Diun's body):

```
curl -s -X POST http://127.0.0.1:8099/cgi-bin/diun \
  -H 'Content-Type: application/json' \
  -d '{"status":"new","provider":"docker","image":"redis:7","digest":"sha256:deadbeef","created":"2026-10-24T00:00:00Z","platform":"linux/amd64","metadata":{"ctn_name":"cms-redis"}}'
```

It answers `202` when the translated body reached the panel and `502` when it did not.

**Rotate the ingest token**

1. `openssl rand -hex 32` → new value.
2. Set it on the panel (`SECURITY_FEED_TOKEN`), restart the panel so the route compares against it.
3. Put the same value in `.env.security` on every reporting host and
   `docker compose --env-file .env --env-file .env.security ... up -d security-scan diun-bridge` — both read it
   from the environment, so no image rebuild is needed.
4. Until every host is updated its pushes get `401` and are logged by the producer; no finding is
   deleted by a rejected push.

