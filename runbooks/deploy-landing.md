# Deploy runbook — landing branch (measured 2026-11-08 on `como-main`)

Every number here was read from the host over SSH and from the repository at the target SHA. The earlier
version of this file was wrong in two ways worth stating, because both would have cost a contest window:
it claimed prod ran `14c81d212` (it does not), and that the delta carried the Python core (it does not).

The panel step changed on 2026-11-13: the panel deploys by colour swap (step 4) and its rollback is a
second swap. The host facts below are still the 2026-11-08 reading; the swap's own contract — the order,
the refusals, the rollback — is pinned by `tests/test_admin_panel_swap.sh`, 39 cases run locally.

## What production is actually running

Host facts: checkout `/home/com-o/cms-docker`, at `0c2f8f99`, `DEPLOYMENT_TYPE=img`, compose project `cms-docker`.

| Container(s) | Image | Revision |
|---|---|---|
| `cms-admin-panel-next`, `cms-exposure-reconciler` | `cms-docker-admin-panel` | **`9340362b`** |
| `cms-log/resource/scoring/checker/evaluation/proxy-service`, `cms-admin-web-server`, `cms-ranking-web-server`, `cms-contest-web-server` | `cms-docker-core` | **`9340362b`** |
| `cms-worker-0..3` | `cms-docker-worker` | `11962e78` |
| `cms-monitor` | `cms-docker-monitor` | `5a80cd96` |
| `cms-scheduler`, `cms-security-signal` | `cms-docker-scheduler` | `0c2f8f99` |
| `cms-security-scan`, `cms-diun-bridge` | `cms-docker-security-scan` | `0c2f8f99` |

Four different builds in one stack, and a checkout that is **ahead of every container** — the tree was
updated without a matching deploy. That is the state being deployed *from*.

## The delta, by what each image actually contains

The root `Dockerfile` copies the whole tree (`COPY . /home/cmsuser/src`), so what decides a recreate is
which **directories** changed, not the file count:

| Build input | Changed files vs prod's `9340362b` | Consequence |
|---|---|---|
| `src/` (Python core) | **0** | core image behaves identically → **no core service is recreated** |
| `ranking-web/` | **0** | ranking binary identical → no recreate |
| `admin-panel/` | **29** | **the panel image is the one whose content changed** (includes the session gate, `a6c73203`) |
| `docker/monitor` | **0** | unchanged |
| `docker/scheduler` | **1** | scheduler image changed; batch service, no contest impact |
| `docker/security-scan` | **4** | scanner image changed; the feed re-reads it on restart |
| `config/` (nginx templates) | **0** | no `make expose` / reload step needed |

**This deploy needs no contest window.** The previous version demanded one because a stale base made the
delta look like 561 files across the Python core. Measured against the builds that are actually running,
it is a panel change.

## The one migration — record it, do not re-run it

The repo carries `20261026130400_rls_policy_set_fresh`; the database has it **unrecorded but already in
effect**. Verified, not assumed:

```sql
select pg_get_expr(polqual, polrelid) from pg_policy p
  join pg_class c on c.oid = p.polrelid
 where c.relname = 'audit_log' and polname = 'cms_actor_read';
-- (cms_actor_is_staff() OR cms_actor_any(ARRAY['system:audit-retention'::text])
--                     OR cms_actor_any(ARRAY['system:ingest'::text]))
```

That is exactly what the migration writes. The file is idempotent anyway (311 `DROP POLICY IF EXISTS` +
84 `CREATE POLICY`), but re-running it takes an exclusive lock per statement on a live database for no
change. Record it instead:

```bash
cd /home/com-o/cms-docker
docker compose --profile admin exec -T admin-panel-next \
  ./node_modules/.bin/prisma migrate resolve --applied 20261026130400_rls_policy_set_fresh \
  --schema=prisma/schema.prisma
```

Three migrations are recorded in `_prisma_migrations` but **absent from the repo**:
`20261009170100_ranking_console_users_rls` (retired with the console table, `b0ab51c8`),
`20261009200100_backup_locations_rls` (retired with the locations layer, `dd57700d`) and
`20261026140200_rls_helpers_not_inlined` (reverted by `fbdb92d7`). `prisma migrate status` lists them;
that is expected and `migrate deploy` ignores them.

## Steps

**0 · Pre-flight (read-only)**

```bash
cd /home/com-o/cms-docker
git fetch --all --tags && git log --oneline -1 origin/major/admin-panel   # the SHA you intend to deploy
git status --short                                                        # must be clean
docker inspect cms-admin-panel-next --format '{{.Config.Image}}'          # must NOT already be the target
df -h / && docker system df
docker manifest inspect ghcr.io/champyod/cms-docker-admin-panel:sha-<tip>  >/dev/null && echo "tag present"
```

**1 · Backup** — always, even for a panel-only change:

```bash
bash scripts/__backup.sh
```

**2 · Migration record** — the `migrate resolve` line above, after the verification query returns the
`system:ingest` term.

**3 · Check out the target** (the tree is currently at `0c2f8f99`, images behind it):

```bash
git pull --ff-only
git log --oneline -1
```

**4 · Panel only — swap the colour, never recreate the service**

`up -d admin-panel-next` replaces the one container the front dials: the old one dies, the
new one needs ~22 s to answer, and every panel request in that window is a 502. The panel is
stateless (JWT in a cookie, `AUTH_SECRET` from the environment), so it runs as two colours
instead — `cms-admin-panel-next` (colour a) and `cms-admin-panel-b` (colour b). Pull the
image, then let the swap start the idle colour and prove it:

```bash
docker compose --profile admin --profile admin-standby pull admin-panel-next admin-panel-next-b
bash scripts/__admin_panel_swap.sh --timeout 180
```

What it does, in this order — and it does nothing else:

1. detects the colour that is serving (running containers first, then `config/admin-panel-colour`);
2. starts the other colour with `up -d --no-deps` and waits for its compose healthcheck
   (`--timeout`, default 180 s);
3. records the new colour in `config/admin-panel-colour`;
4. re-renders the front through `scripts/__domain_proxy_reload.sh --strict` (render → `nginx -t`
   → reload) and fails the swap if any of the three fails;
5. probes one request through the front — `https://$ADMIN_DOMAIN:$DOMAIN_NGINX_HTTPS_PORT/`,
   any 2xx/3xx — and only then stops the colour that was serving.

Any failure before step 5 re-records and re-renders the previous colour and leaves **both**
colours running; nothing is ever stopped on a guess. `--probe-url` overrides the probe target
when the front is not the configured `ADMIN_DOMAIN` (a different port, a tunnel name).

Check it, and read the same facts the script acted on:

```bash
cat config/admin-panel-colour                                            # the colour serving now
docker ps --format '{{.Names}}' | grep '^cms-admin-panel'                # exactly one running
docker inspect --format '{{.State.Health.Status}}' "cms-admin-panel-$(cat config/admin-panel-colour)"
curl -fsS -o /dev/null -w 'admin: %{http_code}\n' https://admin.cms.mwit.ac.th/en/auth/login   # 200
```

`config/admin-panel-colour` is the front's source of truth and outranks `ADMIN_PANEL_COLOUR`
in `.env`: a later re-render, or a regenerated `.env`, cannot drag traffic back to a colour
this box retired. Do not hand-edit it; delete it only if it is wrong, and the configured
colour applies again.

The old `--no-deps up` line is gone from this step on purpose: it is the ~22 s of 502, not a
deploy.

**5 · Verify the two fixes this deploy carries**

```bash
curl -sk -o /dev/null -w 'login page: %{http_code}\n' https://admin.cms.mwit.ac.th/en/auth/login   # 200
curl -sk -o /dev/null -D - https://admin.cms.mwit.ac.th/login | grep -i '^location'               # /en/auth/login
```

The second line is the `/login` dead-end fix (`32082e3e`): before it, `/login` → `/en/login` → 404; after
it, `/login` → `/en/auth/login`.

**6 · Optional, no urgency** — `worker`, `monitor`, `scheduler`, `security-scan`, `exposure-reconciler`
carry content-identical images today. Recreate them when idle if you want the revisions to line up.

## Rollback — swap back first, pin by digest only for the image

### A swap that has to be undone

Run the swap again. The colour it retired is stopped, never removed, so the script starts
that same container again, waits for its healthcheck, re-points the front and stops the
colour it replaced — the same guards, in the same order, with no hand edits:

```bash
bash scripts/__admin_panel_swap.sh --timeout 180
cat config/admin-panel-colour     # the colour serving now
```

A swap that failed halfway has already restored the front itself: the log says which colour
is serving, and both containers are left running. The next run reuses them.

Never undo a swap with `up -d` on a colour: that recreates the container the front may be
dialling, which is the 502 this procedure exists to avoid.

### The image itself

The tags on `major-admin-panel` move; these digests are what is running now:

```
cms-docker-admin-panel@sha256:fcddca45a2dd4aaa553b2bfc751de4c4179266ee455…   (panel 9340362b)
cms-docker-core@sha256:674762b08f881233ab2e8e320b630d7ddcd27c08c325ebb641…    (core 9340362b)
cms-docker-worker@sha256:b397100fb5588bcca12a37a0b497b4342fba329f8d9de7b9…    (worker 11962e78)
cms-docker-monitor@sha256:79cde13ab5816fe105254db9c33680566e0defba906e103…    (monitor)
cms-docker-scheduler@sha256:41db1ee20a68797ba84343cd75344852690d3745b2c03…    (scheduler 0c2f8f99)
cms-docker-security-scan@sha256:407a673b81a62f97b9c313c10ba7287c1c32e2525…    (security-scan)
```

Roll back the panel by pointing the service at the old digest in an override file, or with
`IMG_TAG=sha-9340362b…` while that tag still resolves.

## Caveats

- **CI is green on the current tip.** Trivy's `CVE-2026-78661` was cleared by the waiver that landed after
  this runbook was first written; the last run on `a6c73203` reported every job successful.
- nginx listens on `10.40.50.120:80/443` only and the session cookie is `Secure`, so the panel is used over
  **https://admin.cms.mwit.ac.th**. `http://100.114.35.41:8891` can never hold a login.
- `cms-admin-panel-next` (colour a) is the only colour that publishes a host port, so `:8891`
  follows colour a and not the live colour. The admin URL above goes through
  `grader-nginx-proxy`, which the swap re-renders and reloads live; the contest/funnel proxy
  (`cms-nginx-contest`) renders its panel target from `ADMIN_PANEL_COLOUR` at start, so the
  tailnet funnel listener follows the swap on its next restart.
- The `/login` fix only reaches a browser after this deploy; until then `/login` still 404s.
