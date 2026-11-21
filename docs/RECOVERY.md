# Recovery Runbook — CMS Docker

Bringing the stack back after a host reboot, a crash, or a partial outage.

**Live file:** `docker-compose.yml` (profiles: core, admin, contest, worker, monitor).
The split `docker-compose.<stack>.yml` files are legacy but carry the same restart policy.

## Why the old procedure failed

The stack used `restart: on-failure:5`. That policy restarts a container only when it
exits non-zero, and **never** starts containers when the Docker daemon starts. A reboot
therefore left every service down until someone started them by hand.

Restart policy is now `unless-stopped`, so Docker brings the stack back on its own when
the daemon starts after a reboot.

## Never recover with `docker start`

`docker start <name>` bypasses `depends_on` and health gating, so dependents race the
database and die with `could not translate host name "database"`. Always recover through
`./cms` or `docker compose`.

## Recovery after a reboot

1. Confirm the daemon is up: `systemctl status docker`
2. Confirm what came back: `./cms status`
3. If services are missing, bring the whole stack up in order:
   ```
   ./cms deploy all
   ```
   This loops core → infra → admin → contest → worker and honours `depends_on`.
4. Verify:
   ```
   ./cms status          # all running; core services healthy
   ./cms test            # smoke test
   ```

## If the database is not ready yet

Do not `docker start` the dependents. Start them through compose (`./cms deploy core`,
then the remaining stacks), or simply wait — with `unless-stopped` they retry until the
database is reachable.

## Workers after a reboot

The worker entrypoint recreates `ISOLATE_CGROUP_PATH` (`/sys/fs/cgroup/cms-isolate`) at
startup, because `/sys/fs/cgroup` is kernel-maintained and wiped on every boot.

If the path is still missing and cannot be created, run on the worker host:
```
sudo ./scripts/__worker_cgroup_setup.sh
./cms worker deploy
```

## Health verification

```
docker inspect -f '{{.State.Health.Status}}' \
  cms-database cms-log-service cms-resource-service \
  cms-scoring-service cms-checker-service
```
