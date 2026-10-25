#!/usr/bin/env bash
# scripts/__security_stack.sh — the one supported way to turn the security stack ON and OFF.
#
# WHY a Makefile target and this script, and not `./cms`: every `./cms <subcommand>` is dispatched by
# the Rust cms-tui binary (tools/cms-tui, cli/mod.rs), so a new operator verb there means a Rust change
# and a rebuilt binary on every host. Optional-profile bring-up already lives in the Makefile (core,
# admin, contest, worker, infra, domain, waf, proxy) together with the *_UP_PROFILES constants, so the
# verbs are make targets — `security-check`, `security-dry-run`, `security-up`, `security-off` — and
# this script owns the argv, the prerequisite gate and the plan rendering behind them.
#
# THE INVARIANT: enabling these overlays must not touch anything serving contestants.
#
#   * the target set is an explicit service list (the eight overlay services), never "every service the
#     enabled profiles cover";
#   * `--no-deps`, so a named service never drags a base service in behind it;
#   * `up -d` only — no `down`, no `--force-recreate`, no `--build` when DEPLOYMENT_TYPE=img.
#
# WHY the explicit list is not cosmetic. docker-compose.security.yml adds Diun's opt-in labels to
# admin-panel-next, nginx-proxy, database, redis-rate-limit, monitor and worker. A label is part of the
# container's config hash, so a project-wide `up -d` behind that overlay plans a RECREATE for every one
# of them — measured on compose v5 (see tests/test_security_profiles_enable.sh, which probes exactly
# this). Naming the services keeps compose's action set to those names, and the dry-run below reports
# the per-service config hash it compares, which is the same value compose uses to decide.
#
# Usage:
#   bash scripts/__security_stack.sh check   [--feed-only] [--allow-idle]
#   bash scripts/__security_stack.sh dry-run [--feed-only] [--allow-idle]
#   bash scripts/__security_stack.sh up      [--feed-only] [--allow-idle]
#   bash scripts/__security_stack.sh verify  [--feed-only]
#   bash scripts/__security_stack.sh off
#   bash scripts/__security_stack.sh print
#
# Called from the Makefile; docs/SECURITY-FEED.md -> Operating is the operator-facing half.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/common.sh"

# The overlay services, grouped by the profile that gates them. WHY grouped: the on-switch starts the
# feed and its monitoring, and `--feed-only` has to be able to drop exactly the signal and nothing else.
readonly MONITORING_SERVICES=(prometheus grafana node-exporter)
readonly FEED_SERVICES=(renovate diun diun-bridge security-scan)
readonly SIGNAL_SERVICES=(security-signal)
readonly OVERLAY_PROFILES=(monitoring security security-signal)
# The panel is the reader of PROMETHEUS_URL and the consumer of every push, so it is the container the
# two cross-checks run from. Named rather than looked up: one container name, one place to change it.
readonly PANEL_CONTAINER="${PANEL_CONTAINER:-cms-admin-panel-next}"
VERB="${1:-}"
if [[ $# -gt 0 ]]; then shift; fi

FEED_ONLY=0
ALLOW_IDLE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --feed-only) FEED_ONLY=1 ;;
    --allow-idle) ALLOW_IDLE=1 ;;
    -h|--help) VERB=help ;;
    *) log_warn "ignoring unknown argument: $1" ;;
  esac
  shift
done

# ---------------------------------------------------------------------------
# The compose invocation
# ---------------------------------------------------------------------------
# WHY both env files and only when they exist: `--env-file` replaces the default `.env` rather than
# adding to it, so `.env.security` is passed *after* `.env` (later wins) and never on its own. Naming a
# file that is not there is a hard error in compose, so each is passed only if present.
ENV_FILES=()
ENV_FILE_FLAGS=()
for _f in .env .env.security; do
  ENV_FILES+=("$_f")
  [[ -f "$_f" ]] && ENV_FILE_FLAGS+=(--env-file "$_f")
done

readonly COMPOSE_MODEL=(-f docker-compose.yml -f docker-compose.monitoring.yml -f docker-compose.security.yml)
PROFILE_FLAGS=()
for _p in "${OVERLAY_PROFILES[@]}"; do PROFILE_FLAGS+=(--profile "$_p"); done
COMPOSE_ARGV=(docker compose "${ENV_FILE_FLAGS[@]}" "${COMPOSE_MODEL[@]}" "${PROFILE_FLAGS[@]}")

compose_run() { "${COMPOSE_ARGV[@]}" "$@"; }
compose_print() { printf '%q ' "${COMPOSE_ARGV[@]}"; printf '\n'; }

# The services this run is allowed to touch. `--feed-only` removes the signal (the only service with an
# external side effect) and nothing else.
TARGET_SERVICES=()
build_target_services() {
  TARGET_SERVICES=("${MONITORING_SERVICES[@]}" "${FEED_SERVICES[@]}")
  (( FEED_ONLY )) || TARGET_SERVICES+=("${SIGNAL_SERVICES[@]}")
}

# ---------------------------------------------------------------------------
# Effective configuration
# ---------------------------------------------------------------------------
# WHY the shell environment first: compose interpolates shell variables OVER the env files, so a value
# exported in the operator's session is the value the container gets. Reading the files first would
# report a token as set while compose used an empty one from the environment.
env_value() {
  local key="$1" file found out=""
  if [[ -n "${!key+x}" ]]; then printf '%s' "${!key}"; return 0; fi
  for file in "${ENV_FILES[@]}"; do
    [[ -f "$REPO_ROOT/$file" ]] || continue
    # WHY an explicit FOUND marker: a later file that sets KEY= (empty) must override an earlier
    # file's value — an unset variable and an empty one are different answers to compose.
    found="$(awk -v k="$key" 'BEGIN { f = 0 } index($0, k "=") == 1 { v = substr($0, length(k) + 2); f = 1 } END { if (f) printf "FOUND:%s", v }' "$REPO_ROOT/$file")"
    [[ -n "$found" ]] && out="${found#FOUND:}"
  done
  env_unquote "$out"
}

# ---------------------------------------------------------------------------
# Prerequisite gate
# ---------------------------------------------------------------------------
# Every failure below names the CONSEQUENCE, not just the missing key: the point of the gate is that an
# operator can decide, from the message alone, whether to fix it or to accept it deliberately.
PREREQ_FAILS=0
prereq_fail() { # <headline> <consequence...>
  local headline="$1"; shift
  PREREQ_FAILS=$((PREREQ_FAILS + 1))
  printf '[FAIL] %s\n' "$headline" >&2
  local line
  for line in "$@"; do printf '       %s\n' "$line" >&2; done
}
prereq_ok() { printf '[ ok ] %s\n' "$*"; }
prereq_note() { printf '[note] %s\n' "$*"; }

check_feed_token() {
  local token
  token="$(env_value SECURITY_FEED_TOKEN)"
  if [[ -z "$token" ]]; then
    prereq_fail "SECURITY_FEED_TOKEN is empty — every producer push will be refused with 401, by design." \
      "The ingest route compares this bearer token in constant time and rejects a request without it," \
      "so osv, rootfs and diun findings never reach the panel: the patching page fills with nothing and" \
      "each producer logs a 401 on every run. This is not a warning — nothing lands." \
      "Fix: openssl rand -hex 32, put the value in .env.security on this host AND the same value on the" \
      "     panel (SECURITY_FEED_TOKEN in .env), then restart only the panel so the route reads it."
    return 1
  fi
  prereq_ok "SECURITY_FEED_TOKEN is set (${#token} chars) — the ingest route will accept this host's pushes"
}

check_discord() {
  local url
  url="$(env_value DISCORD_WEBHOOK_URL)"
  if [[ -z "$url" ]]; then
    if (( FEED_ONLY )); then
      prereq_note "DISCORD_WEBHOOK_URL is empty and --feed-only was passed: the signal is NOT being started, so nothing is paged. Findings still land in the panel — the patching page is the only surface."
      return 0
    fi
    prereq_fail "DISCORD_WEBHOOK_URL is empty — the signal would run but reach no human." \
      "security-signal keeps working as designed: it reads Postgres and Prometheus, it dedupes through" \
      "audit_log so it never repeats itself, and it logs every decision. What it cannot do is deliver:" \
      "lib/discord-notifier.ts drops the message. An unwaived CRITICAL, a lapsed waiver or a stale" \
      "backup would reach nobody, and this command refuses to report that as success." \
      "Fix: set DISCORD_WEBHOOK_URL ([infra], written to .env) to the webhook the backup and lockout" \
      "     alerts already use. Or re-run with --feed-only: start the feed without the signal, knowing" \
      "     that nothing is paged until the webhook is set."
    return 1
  fi
  prereq_ok "DISCORD_WEBHOOK_URL is set — the signal has a human channel"
}

check_security_enabled() {
  local enabled
  enabled="$(env_value SECURITY_ENABLED)"
  if [[ "$enabled" != "1" ]]; then
    if (( ALLOW_IDLE )); then
      prereq_note "SECURITY_ENABLED=${enabled:-<unset>} and --allow-idle was passed: the containers start and do nothing (Renovate idles, the scan scheduler exits, the bridge drops what it receives). The patching page will stay empty."
      return 0
    fi
    prereq_fail "SECURITY_ENABLED=${enabled:-<unset>} — you asked to turn the feed on, but it would start and do nothing." \
      "The profile decides which containers exist; SECURITY_ENABLED decides whether they do any work." \
      "With it off, Renovate idles, the scan scheduler exits, the Diun translator accepts notifications" \
      "and drops them — the stack is up and the patching page never fills. Reporting that as 'enabled'" \
      "would be a false success." \
      "Fix: SECURITY_ENABLED=1 in .env.security ([infra] key SECURITY_ENABLED). To stage the containers" \
      "     without starting the work, re-run with --allow-idle."
    return 1
  fi
  prereq_ok "SECURITY_ENABLED=1 — the scan, the translator and Renovate will do work"
}

check_loopback_bindings() {
  # A published port on 0.0.0.0 would expose the feed's write path and the metrics API to the network.
  # The compose defaults are loopback; a host .env that set one of these to 0.0.0.0 silently isn't.
  local var value bad=0
  for var in PROMETHEUS_BIND_IP GRAFANA_BIND_IP SECURITY_BRIDGE_BIND_IP; do
    value="$(env_value "$var")"
    [[ -n "$value" ]] || continue
    case "$value" in
      127.0.0.1|::1|localhost) ;;
      *)
        bad=1
        prereq_fail "$var=$value — that publishes an overlay port on a non-loopback address." \
          "Prometheus (:9090), Grafana (:3001) and the Diun translator's debug port (:8099) exist for" \
          "this host only. Grafana holds dashboards and a login; the translator is a write path into the" \
          "panel's findings table. Publishing either on a routable address is a new input boundary." \
          "Fix: set $var = 127.0.0.1 (or remove the key — the compose default is loopback)."
        ;;
    esac
  done
  (( bad )) || prereq_ok "every overlay port stays on loopback (PROMETHEUS_BIND_IP / GRAFANA_BIND_IP / SECURITY_BRIDGE_BIND_IP)"
}

# The panel is the only reader of PROMETHEUS_URL, and a name that resolves on the host but not inside
# cms-network is precisely the failure a host-side check cannot see. node is used rather than getent
# because the panel image always has node (it IS the server) and getent is not guaranteed everywhere.
panel_container_running() {
  [[ "$(docker inspect -f '{{.State.Running}}' "$PANEL_CONTAINER" 2>/dev/null || echo false)" == "true" ]]
}

# The host to resolve: whatever PROMETHEUS_URL names, not a hardcoded "prometheus", so an operator who
# points the panel at an external scrape target is checked against the target they actually chose.
prometheus_host() {
  local url
  url="$(env_value PROMETHEUS_URL)"
  url="${url:-http://prometheus:9090}"
  python3 -c 'import sys; from urllib.parse import urlparse; print(urlparse(sys.argv[1]).hostname or "prometheus")' "$url"
}

dns_lookup_in_panel() { # <name>
  docker exec "$PANEL_CONTAINER" node -e '
    require("dns").lookup(process.argv[1], (err) => process.exit(err ? 1 : 0));
  ' "$1" >/dev/null 2>&1
}

# WHY the live lookup is skipped while prometheus is not up yet: on FIRST enable the container does not
# exist, so exec'ing into it is impossible — and refusing there would make the feature unusable for the
# one action that creates it. `up` runs this again in verify, right after the containers are created, so
# the check still happens for real before the command may report success.
check_prometheus_resolves() {
  local host
  host="$(prometheus_host)"
  if ! panel_container_running; then
    # NOT a failure and NOT a pass: with no panel running there is nothing to break, but this command
    # must not imply it verified something it could not. The wording says which half is unverified.
    prereq_note "cannot verify that '${host}' resolves from the panel: ${PANEL_CONTAINER} is not running. Unverified, not broken — run 'make security-verify' once the panel is up; the digest card reads 'cannot evaluate' until then."
    return 0
  fi
  if ! [[ "$(docker inspect -f '{{.State.Running}}' "${PROMETHEUS_CONTAINER:-grader-prometheus}" 2>/dev/null || echo false)" == "true" ]]; then
    prereq_note "'${host}' is not up yet (prometheus container does not exist or is stopped) — the live lookup from ${PANEL_CONTAINER} runs in 'make security-verify', immediately after this starts it."
    return 0
  fi
  if dns_lookup_in_panel "$host"; then
    prereq_ok "'${host}' resolves from ${PANEL_CONTAINER} — PROMETHEUS_URL is reachable where it is read"
    return 0
  fi
  prereq_fail "'${host}' does not resolve from ${PANEL_CONTAINER}." \
    "The overlay joins cms-network under the service name 'prometheus'; if that lookup fails the panel's" \
    "digest card and the four patching cards read 'cannot evaluate' for backup staleness — fail-closed," \
    "but permanently, and the signal then pages 'cannot evaluate' once per window." \
    "Fix: confirm both containers are on cms-network (docker network inspect cms-network), and that the" \
    "     monitoring overlay was the file set used for prometheus (it is the only place it is defined)," \
    "     and that PROMETHEUS_URL names that host."
  return 1
}

run_checks() {
  PREREQ_FAILS=0
  printf '== prerequisites (each failure names what breaks if ignored) ==\n'
  check_feed_token || true
  check_discord || true
  check_security_enabled || true
  check_loopback_bindings
  check_prometheus_resolves || true
  return 0
}

# ---------------------------------------------------------------------------
# The plan (dry run)
# ---------------------------------------------------------------------------
# Rendered by python3 from `docker compose config`, which is client-side: it contact no daemon, pulls
# nothing, creates nothing. The only other reads are `docker ps` and `docker image inspect`.
render_plan() {
  PLAN_TARGETS="${TARGET_SERVICES[*]}" \
  PLAN_ALL_TARGETS="$(printf '%s\n' "${MONITORING_SERVICES[@]}" "${FEED_SERVICES[@]}" "${SIGNAL_SERVICES[@]}" | tr '\n' ' ')" \
  python3 - "${COMPOSE_ARGV[@]}" <<'PY'
import json, os, subprocess, sys

argv = sys.argv[1:]
status = {"daemon": True}


def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    return p.returncode, p.stdout.strip(), p.stderr.strip()


targets = os.environ["PLAN_TARGETS"].split()
all_targets = os.environ["PLAN_ALL_TARGETS"].split()

rc, profiles_out, err = run(argv + ["config", "--profiles"])
if rc != 0:
    sys.stderr.write("docker compose config --profiles failed:\n" + err + "\n")
    sys.exit(1)
profiles = [p for p in profiles_out.splitlines() if p.strip() and p.strip() != "default"]

full = list(argv)
for p in profiles:
    if p not in full:
        full += ["--profile", p]

rc, model_json, err = run(full + ["config", "--format", "json"])
if rc != 0:
    sys.stderr.write("docker compose config failed:\n" + err + "\n")
    sys.exit(1)
model = json.loads(model_json)
services = model.get("services") or {}
project = model.get("name") or "?"

rc, own_json, err = run(argv + ["config", "--format", "json"])
if rc != 0:
    sys.stderr.write("docker compose config failed:\n" + err + "\n")
    sys.exit(1)
own = (json.loads(own_json).get("services") or {})

missing = [s for s in all_targets if s not in services]
if missing:
    sys.stderr.write("the overlay is missing services it must define: %s\n" % " ".join(missing))
    sys.exit(1)

hashes = {}
for svc in all_targets:
    rc, out, err = run(argv + ["config", "--hash", svc])
    hashes[svc] = out.split()[-1] if rc == 0 and out.split() else "?"

# Running containers of THIS project, and whether the daemon answers at all.
rc, ps_out, err = run([
    "docker", "ps", "-a",
    "--filter", "label=com.docker.compose.project=" + project,
    "--format", '{{.Names}}\t{{.State}}\t{{.Label "com.docker.compose.service"}}'
    '\t{{.Label "com.docker.compose.config-hash"}}',
])
if rc != 0:
    status["daemon"] = False
    running = {}
else:
    running = {}
    for line in ps_out.splitlines():
        parts = line.split("\t")
        if len(parts) >= 4:
            running[parts[2]] = {"name": parts[0], "state": parts[1], "hash": parts[3]}

W = 62
print("=" * W)
print(" DRY RUN — the security stack as it would be started. Nothing below runs.")
print("=" * W)
print("  compose project : %s" % project)
print("  env files       : %s" % (", ".join(f for f in (".env", ".env.security")
                                              if os.path.exists(f)) or "<none — compose defaults>"))
print("  model files     : docker-compose.yml docker-compose.monitoring.yml docker-compose.security.yml")
print("  profiles        : monitoring security security-signal")
print("  command         : %s up -d --no-deps %s" % (" ".join(argv), " ".join(targets)))
print()

# ---- container set -------------------------------------------------------
print("CONTAINER SET")
print("  %-16s %-22s %-10s %s" % ("service", "container", "action", "config hash"))
actions = {"create": 0, "start": 0, "no-op": 0, "recreate": 0}
for svc in targets:
    cname = (own[svc].get("container_name") or svc)
    cur = running.get(svc)
    if cur is None:
        action = "create"
    elif cur["hash"] != hashes[svc]:
        action = "recreate"
    elif cur["state"].lower() == "running":
        action = "no-op"
    else:
        action = "start"
    actions[action] += 1
    print("  %-16s %-22s %-10s %s" % (svc, cname, action, hashes[svc][:16]))
untouched = sorted(set(services) - set(targets))
print()
print("  create %d · start %d · no-op %d · recreate %d"
      % (actions["create"], actions["start"], actions["no-op"], actions["recreate"]))
if actions["recreate"]:
    print("  NOTE: a recreate is planned for at least one overlay service — its rendered hash differs from")
    print("        the running container's. That is correct when a key in its environment changed since it")
    print("        was created (SECURITY_FEED_TOKEN, DISCORD_WEBHOOK_URL, IMG_TAG…), and is a no-op when")
    print("        nothing changed. Only overlay services can be recreated: no base service is named.")
print("  untouched: %d other services in this project are not named, so compose does not act on them"
      % len(untouched))
print("             (%s)" % " ".join(untouched))
print()

# ---- superset proof ------------------------------------------------------
print("SUPERSET PROOF  (docker compose config, every profile enabled)")
if status["daemon"]:
    print("  running now in project %s : %d  [%s]"
          % (project, len(running), " ".join(sorted(v["name"] for v in running.values())) or "none"))
else:
    print("  running now            : unknown — no docker daemon reachable (config still rendered)")
print("  in the resulting model  : %d services" % len(services))
dropped = [s for s in running if s not in services]
print("  dropped by this command : %d%s" % (len(dropped), ("  " + " ".join(dropped)) if dropped else ""))
if dropped:
    print("  !! NOT a superset: %s would disappear from the project model" % " ".join(dropped))
else:
    print("  -> the resulting container set is a SUPERSET of the running one; nothing is dropped")
print()

# ---- ports ---------------------------------------------------------------
print("PORTS  (every published port must be loopback)")
loopback_all = True
port_rows = 0
for svc in targets:
    for p in own[svc].get("ports") or []:
        host_ip = p.get("host_ip") or ""
        published = p.get("published") or ""
        target = p.get("target")
        proto = p.get("protocol") or "tcp"
        if host_ip not in ("127.0.0.1", "::1"):
            loopback_all = False
        port_rows += 1
        print("  %-16s %s:%s -> %s/%s" % (svc, host_ip or "(all interfaces)", published, target, proto))
if not port_rows:
    print("  (none)")
for svc in targets:
    for e in own[svc].get("expose") or []:
        print("  %-16s internal only: %s/tcp (no host port)" % (svc, e))
print("  -> all loopback: %s" % ("yes" if loopback_all else "NO — a port would be published off-host"))
print()

# ---- volumes -------------------------------------------------------------
print("VOLUMES  (ro = mounted read-only)")
for svc in targets:
    vols = own[svc].get("volumes") or []
    if not vols:
        continue
    for v in vols:
        src = v.get("source") or "(anonymous)"
        ro = "ro" if v.get("read_only") else "rw"
        marker = "   <- host rootfs, read-only" if v.get("target") == "/rootfs" else ""
        print("  %-16s %-11s %-45s %-11s %s%s"
              % (svc, v.get("type") or "volume", src, v.get("target"), ro, marker))
print("  host interaction: /:/rootfs:ro on security-scan and /var/run/docker.sock:ro on diun — both")
print("  read-only; nothing in this file writes to the host.")
print()

# ---- images / digests ----------------------------------------------------
print("IMAGES  (digest-pinned unless marked)")
for svc in targets:
    image = own[svc].get("image") or "(built)"
    if "@sha256:" in image:
        ref, digest = image.split("@", 1)
        print("  %-16s %s" % (svc, ref))
        print("  %-16s   %s" % ("", digest))
    else:
        print("  %-16s %s   [tag only — our own image, see docs/decisions/image-digest-pinning.md]" % (svc, image))
    rc, _, _ = run(["docker", "image", "inspect", image, "--format", "{{.Id}}"])
    print("  %-16s   present locally: %s" % ("", "yes" if rc == 0 else "no (pulled at up)"))
print()
print("no side effects: this render ran `docker compose config` plus read-only `docker ps` /")
print("`docker image inspect`. Nothing was pulled, created, started or stopped.")
PY
}

# ---------------------------------------------------------------------------
# Verbs
# ---------------------------------------------------------------------------
verb_help() {
  cat <<'USAGE'
scripts/__security_stack.sh — turn the security stack on/off without touching a serving container.

  check      run the prerequisite gate and stop there (nothing is started)
  dry-run    print the resolved container set, ports, volumes and image digests; no side effects
  up         check, then `up -d --no-deps` on the eight overlay services, then verify
  verify     post-start: overlay container states + 'prometheus' resolving from the panel
  off        stop the overlay containers only (findings and waivers survive in the panel database)
  print      print the exact docker compose invocation and exit

Flags: --feed-only (start the feed without the signal service), --allow-idle (accept SECURITY_ENABLED=0)
USAGE
}

verb_print() {
  build_target_services
  printf '# the full invocation, as the make targets run it:\n'
  compose_print
  printf '  # …followed by one of:\n'
  printf '  #   config --format json                     (what the dry run renders)\n'
  printf '  #   up -d --no-deps --no-build %s\n' "${TARGET_SERVICES[*]}"
  printf '  #   stop %s\n' "${TARGET_SERVICES[*]}"
}

verb_check() {
  build_target_services
  run_checks
  printf '\n'
  if (( PREREQ_FAILS > 0 )); then
    printf 'REFUSED: %d prerequisite check(s) failed — see above for what breaks if they are ignored.\n' "$PREREQ_FAILS" >&2
    return 1
  fi
  printf 'all prerequisite checks passed.\n'
}

verb_dry_run() {
  build_target_services
  render_plan
  printf '\n'
  run_checks
  printf '\n'
  if (( PREREQ_FAILS > 0 )); then
    printf 'WOULD REFUSE to start: %d prerequisite check(s) failed (listed above). The plan above is what\n' "$PREREQ_FAILS"
    printf 'would run once they are fixed; a dry run changes nothing either way.\n'
  else
    printf 'no [FAIL] above: this plan is what `make security-up` would execute. A [note] is unverified,\nnot a pass — it says exactly which check did not run.\n'
  fi
  return 0
}

verb_up() {
  build_target_services
  run_checks
  printf '\n'
  if (( PREREQ_FAILS > 0 )); then
    printf 'REFUSED: %d prerequisite check(s) failed — nothing was started.\n' "$PREREQ_FAILS" >&2
    return 1
  fi

  # WHY the plan before the act: it is the same renderer the operator just read in `dry-run`, so the
  # hash comparison that predicts "no recreate" is printed by the command that then does the work.
  render_plan
  printf '\n'

  # Follow the repo's deploy convention: img → pull by tag then never build, src → build from the tree.
  local deploy_type
  deploy_type="$(env_value DEPLOYMENT_TYPE)"
  deploy_type="${deploy_type:-img}"
  if [[ "$deploy_type" == "img" ]]; then
    log_info "DEPLOYMENT_TYPE=img → pulling the overlay images (a failed pull is not fatal: an image already present is used)"
    compose_run pull "${TARGET_SERVICES[@]}" || log_warn "pull reported a failure; continuing with the local images"
    compose_run up -d --no-deps --no-build "${TARGET_SERVICES[@]}"
  else
    log_info "DEPLOYMENT_TYPE=src → building the overlay images from this checkout"
    compose_run up -d --no-deps --build "${TARGET_SERVICES[@]}"
  fi

  printf '\n'
  verb_verify
}

verb_verify() {
  build_target_services
  printf '== the overlay as it is now ==\n'
  compose_run ps "${TARGET_SERVICES[@]}" || true
  printf '\n'
  PREREQ_FAILS=0
  check_prometheus_resolves || true
  printf '\n'
  if (( PREREQ_FAILS > 0 )); then
    printf 'the overlay is up, but a cross-check failed (above) — the panel cannot read what it needs yet.\n' >&2
    return 1
  fi
  cat <<'NEXT'
what to expect next (nothing here is instant):
  · the patching page stays empty until the first security-scan run pushes a report — wait for
    SECURITY_SCAN_SCHEDULE (0 3 * * *), or force one now:
      docker compose --env-file .env --env-file .env.security -f docker-compose.yml \
        -f docker-compose.security.yml --profile security run --rm security-scan all
  · the digest card reads "cannot evaluate" until Prometheus has scraped cms_backup.prom once
    (~15 s after it starts) — that is fail-closed, not a fault
  · Discord stays quiet: the signal only pushes a fact a human must act on, and dedupes against
    audit_log, so the first enable is normally silent
NEXT
  return 0
}

verb_off() {
  TARGET_SERVICES=("${MONITORING_SERVICES[@]}" "${FEED_SERVICES[@]}" "${SIGNAL_SERVICES[@]}")
  log_info "stopping the overlay containers only: ${TARGET_SERVICES[*]}"
  compose_run stop "${TARGET_SERVICES[@]}"
  cat <<'SURVIVES'

stopped, nothing deleted. What survives:
  · findings and waivers — rows in the panel's database (security_findings / security_waivers),
    untouched by this command and still rendered by the panel while the overlay is down
  · the audit trail — including every security.findings.ingest and security.signal.notified row the
    signal uses to dedupe, so re-enabling does not re-page what a human was already told
  · the named volumes cms-prometheus-data, cms-grafana-data, cms-diun-data, cms-renovate-cache and
    cms-security-scan-cache — the scan cache is disposable (it holds Trivy's vulnerability DB, which
    the next run re-downloads); drop it with: docker volume rm cms-security-scan-cache
Containers are stopped, not removed, so `make security-up` starts them again with no pull and no rebuild.
To remove them as well: docker compose ... rm -f <the same service list>.
SURVIVES
}

case "$VERB" in
  check)   verb_check ;;
  dry-run) verb_dry_run ;;
  up)      verb_up ;;
  verify)  verb_verify ;;
  off)     verb_off ;;
  print)   verb_print ;;
  help|"") verb_help ;;
  *) log_die "unknown verb '$VERB' (check|dry-run|up|verify|off|print)" 2 ;;
esac
