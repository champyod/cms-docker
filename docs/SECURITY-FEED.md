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
- Body: `{ "source": "diun|rootfs|osv", "host": "<name>", "findings": [ … ], "complete": true }`.
  `complete: true` is what licenses the route to resolve findings the body did not mention; a partial push
  (`false`) must never resolve anything.
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

`security_waivers` is the *only* waiver mechanism, and it replaces the two ad-hoc escapes that exist today:
`.trivyignore` (three CVEs, "Dated 2026-10-10") and `bun audit --ignore GHSA-vfj7-8cjw-p6xm`. A finding
covered by a waiver is **not hidden** — it renders as `waived` with its `review_by`, and once `review_by`
passes it renders as **`expired`** and counts in the overview card. That is the whole point: a waiver is a
decision with a date, not a deleted line.

## Compose shape

`docker-compose.security.yml`, additive overlay in the same style as `docker-compose.monitoring.yml`:

- one `profiles: [security]` gate, off unless the operator enables it;
- `renovate`, `diun`, `rootfs-scan` services; every published port (if any) bound to `127.0.0.1`;
- the only host mount in the whole overlay is `/:/rootfs:ro` on `rootfs-scan`;
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
3. `complete: true` with a smaller set sets `resolved_at` on the missing rows; `complete: false` never does.
4. `security.patching` renders for an admin with `security:read` **and** `patching:read`, 403s without
   `patching:read`, and the four overview cards match the page's numbers.
5. `tsc` 0, `lint` 0 errors, the panel suite green, icons gate green.
6. Nothing was installed, written or reconfigured on any host; the only host interaction is a read-only mount.
