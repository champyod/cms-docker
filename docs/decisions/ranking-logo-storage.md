# ADR: Ranking Logo Storage — Volume vs DB vs S3

- **Status:** Accepted
- **Date:** 2026-08-31
- **Deciders:** Admin Panel, Ranking Service
- **Scope:** `RANKING_LOGO_PATH` / `/logo` asset lifecycle

## Context

Ranking branding is served by `cmsranking.RankingWebServer.ImageHandler` at `GET /logo` with Accept-based negotiation over `png`, `jpg`, `gif`, `bmp` and a static fallback (`static/img/logo.png`). Configuration originates from host `config.toml` (`[admin] RANKING_LOGO_PATH = "./config/assets/logo.<ext>"`) as the single source of truth; `scripts/__config_sync.sh` regenerates derived configs and syncs the host file into the `cms-ranking-data` volume. The current flow (Task 1) writes uploads to both the mounted volume path `/var/local/lib/cms/ranking/logo.<ext>` and the host mirror `./config/assets/logo.<ext>`, updates `RANKING_LOGO_PATH`, and hot-swaps by overwriting the single `logo.<ext>` while removing other `logo.*` variants. The question is whether this volume-plus-mirror approach remains the right backing store versus DB or S3.

## Options

### Option A — Docker Volume `cms-ranking-data` (Current)

Ranking persists to the named volume `cms-ranking-data` mounted at `/var/local/lib/cms/ranking`. `Config.lib_dir` defaults to that path; `ImageHandler` resolves `<lib_dir>/logo.<ext>` when `logo_path` is unset or missing. The admin panel also mounts the volume directly (`cms-ranking-data:/var/local/lib/cms/ranking:rw`) so `POST /api/ranking/logo` can write without a helper container. A host mirror at `./config/assets/logo.<ext>` is kept for portability across `docker compose down -v` and for `config.toml` traceability.

### Option B — Database `fsobjects` / PostgreSQL Large Objects

Store the binary in PostgreSQL using the CMS `fsobjects` + Large Object pattern already used for task datasets and testcases. An upload would create/update a row (e.g., ranking asset table or reuse `fsobjects` with a ranking discriminator), persist `oid`/digest, and serve via a new DB-backed handler or by materializing to `lib_dir` on read. Survives volume resets, participates in `cmsdb` backups, and is queryable via SQLAlchemy. Requires schema migration, ORM model, permission-aware handler, and cache invalidation (Last-Modified/ETag from DB rather than filesystem mtime).

### Option C — S3 / MinIO Service

Introduce an object store (MinIO in compose, or external S3) with a `ranking-assets` bucket. Uploads `PUT` to `s3://ranking-assets/logo.<ext>`; `RankingWebServer` fetches on demand (or via presigned redirect/proxy) with content-type negotiation preserved. Durable across hosts, suitable for multi-host or offsite deployments, and naturally versioned. Requires a new compose service, bucket lifecycle, credentials in `config.toml`/env, S3 client in Python, and RankingWebServer fetch path with fallback.

## Tradeoffs

| Dimension | Volume + Host Mirror (A) | DB / Large Objects (B) | S3 / MinIO (C) |
|---|---|---|---|
| **Operational complexity** | Lowest. Existing compose volume, one mount in `admin-panel-next`, no new service. `__config_sync.sh` already handles sync. | Medium. New table/migration, ORM mapping, API change, and cache semantics. | Highest. New service, networking, bucket policy, credentials, and fetch path in RankingWebServer. |
| **Durability** | Volume survives restarts, not `down -v`; host mirror (`./config/assets`) closes the gap for that case. Backed up via volume snapshot / host file. | Strongest within single stack. Survives `down -v`, covered by `cmsdb` backups. No extra backup path. | Strongest across hosts. Independent lifecycle, replication, and offsite-friendly. |
| **Hot-swap / latency** | Immediate. Filesystem overwrite, single file, old `logo.*` removed. `Last-Modified` from mtime works today. | Immediate if materialized synchronously; otherwise read-through latency on first request. ETag from DB digest. | Proxy adds fetch latency unless cached locally. Negotiation preserved but requires reverse-proxy or redirect logic. |
| **Multi-host / scale** | Single-host bound. Replicated workers need volume sharing. | Single-host bound to `cmsdb` but accessible to any service with DB access. | Native multi-host. Any replica can fetch without shared volume or DB load. |
| **Backup / restore story** | Host mirror is plain-file, gitignore-friendly; volume included in monitor backup if `cms-ranking-data` is enumerated. | Restored with `cmsdb` dump; no separate artifact step. | Separate bucket backup/versioning; decoupled from DB backup. |
| **Security / permissions** | Inherits host + volume permissions (`644`). Admin-panel verifies `verifyApiPermission('all')` at upload; read path is public `/logo` as today. | Row-level access can be enforced in handler; Large Objects need careful `lo` permission handling. | Bucket policy + presigned URLs; credentials must be scoped and rotated (secrets handling). |
| **Migration cost** | Zero. Already implemented. | Moderate. Data migration (file → LO), handler rewrite, fallback during rollout. | Significant. Infra + code + docs (`config.toml.example`, compose, secrets). |
| **Waste / cleanup** | Single `logo.<ext>`, other `logo.*` deleted on write — no orphan growth. | Orphan LOs if `fsobjects` row deleted without `lo_unlink`; requires vacuum. | Versioning can accumulate objects unless lifecycle rule caps versions. |

## Recommendation

**Keep Option A (volume `cms-ranking-data` + host mirror `./config/assets/logo.<ext>`) as the accepted path now.**

Rationale:

- It satisfies the spike constraints: simple, hot-swappable, no orphan files, consistent with `config.toml` as source of truth, and already wired through the mounted volume and `RANKING_LOGO_PATH`. No new service or migration is needed to ship Task 1 and Task 2.
- The host mirror recovers the only durability gap of pure volume storage (`down -v` loss) without introducing DB or S3 overhead.
- DB and S3 are reserved as a future refactor behind a feature flag rather than a present fork.

**Future extension (no code in this ADR):** introduce `RANKING_LOGO_STORAGE=volume|db|s3` (default `volume`) and honor it in the upload API and `RankingWebServer` resolution order. `MINIO_ENABLED` gates the `s3` branch; when disabled, the `s3` value is rejected with a validation error. The flag keeps a single call site for the storage backend and defers schema/service cost until an explicit infra decision enables MinIO.

## Consequences

- **Positive:** Minimal operational surface, fast hot-swap, cache-bust via `?ts` remains valid, `scripts/__config_sync.sh` stays authoritative, and the host mirror preserves the logo across volume resets.
- **Negative:** Multi-host deployments still require shared storage or a later migration to S3; DB backup coverage for the logo depends on remembering to snapshot the volume/host file rather than relying solely on `cmsdb`.
- **Follow-up:** When `RANKING_LOGO_STORAGE` is introduced, add migration docs, update `config.toml.example` with the new key and `MINIO_ENABLED` reference, and adjust `docker-compose.yml` / `docker-compose.admin.yml` plus RankingWebServer fetch logic under the flag. Until then, no change to `RankingWebServer` beyond the existing `logo_path` fallback.
