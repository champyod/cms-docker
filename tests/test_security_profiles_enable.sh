#!/usr/bin/env bash
# tests/test_security_profiles_enable.sh — turning the security stack ON is one command, provably safe.
#
# WHY this suite exists. The overlay was startable only by typing a six-line `docker compose` invocation
# out of a doc, and the obvious spelling of it — `--profile security up -d` over the merged project —
# is the one that RECREATES the containers serving contestants: docker-compose.security.yml adds Diun's
# opt-in labels to admin-panel-next, nginx-proxy, database, redis-rate-limit, monitor and worker, and a
# label is part of the container's config hash. On a contest-live box that is a restart of the whole
# stack caused by enabling an optional feed.
#
# So this suite pins the five properties the operator now relies on:
#
#   1. the command exists, and the compose invocation it issues names the overlay services explicitly;
#   2. a second run issues no recreate — proved at the decision layer (the rendered config and the
#      per-service config hashes are byte-identical across runs, which is exactly what compose compares)
#      and, when the overlay is already up and CMS_SECURITY_LIVE=1, by comparing container IDs;
#   3. the dry run has no side effects — nothing created, started, stopped, pulled or tagged;
#   4. the off-switch names only the overlay services, and stops rather than deletes;
#   5. every overlay service is profile-gated, and the prerequisite gate fails loudly.
#
# Usage: bash tests/test_security_profiles_enable.sh
#        CMS_SECURITY_LIVE=1 bash tests/test_security_profiles_enable.sh   # adds the container-ID arm
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

STACK=scripts/__security_stack.sh
MAKEFILE=Makefile
OVERLAY_SECURITY=docker-compose.security.yml
OVERLAY_MONITORING=docker-compose.monitoring.yml

TARGETS=(prometheus grafana node-exporter renovate diun diun-bridge security-scan security-signal)
BASE_SERVICES=(database admin-panel-next nginx-proxy worker monitor redis-rate-limit scheduler
  contest-web-server log-service resource-service scoring-service checker-service evaluation-service
  proxy-service admin-web-server ranking-web-server audit-retention)

pass=0
fail=0
skipped=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }
skip() { skipped=$((skipped + 1)); printf '  skip %s\n' "$1"; }
is() { # <label> <expected> <actual>
  if [[ "$2" == "$3" ]]; then ok "$1"; else no "$1 (expected '$2', got '$3')"; fi
}
contains() { # <label> <text> <needle>
  if printf '%s' "$2" | grep -Fq -- "$3"; then ok "$1"; else no "$1 (missing: $3)"; fi
}
lacks() { # <label> <text> <needle>
  if printf '%s' "$2" | grep -Fq -- "$3"; then no "$1 (unexpectedly found: $3)"; else ok "$1"; fi
}
have_docker() { command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; }

# A fixed environment for every render, so the suite is independent of whatever .env the box carries:
# the point is that the SAME inputs give the SAME hash twice, which is what makes the second run a no-op.
export SECURITY_ENABLED=1
export SECURITY_FEED_TOKEN=render-only-fixed-token
export DISCORD_WEBHOOK_URL=https://example.invalid/webhook
export SECURITY_HOST=test-host
export PANEL_URL=http://admin-panel-next:3000
export DEPLOYMENT_TYPE=img
export IMG_TAG=major-admin-panel
export PROMETHEUS_BIND_IP=127.0.0.1
export GRAFANA_BIND_IP=127.0.0.1
export SECURITY_BRIDGE_BIND_IP=127.0.0.1

COMPOSE_MODEL=(-f docker-compose.yml -f "$OVERLAY_MONITORING" -f "$OVERLAY_SECURITY")
PROFILE_FLAGS=(--profile monitoring --profile security --profile security-signal)
render() { docker compose "${COMPOSE_MODEL[@]}" "${PROFILE_FLAGS[@]}" "$@" 2>/dev/null; }

printf '\n== 1. the command exists, and it names what it will start ==\n'
if [[ -f "$STACK" ]]; then ok "$STACK exists"; else no "$STACK is missing"; fi
for target in security-up security-off security-check security-dry-run security-verify security-print; do
  if grep -qE "^${target}:" "$MAKEFILE"; then ok "make target '$target' exists"; else no "make target '$target' is missing"; fi
done
PRINT="$(bash "$STACK" print 2>&1)"
contains "the printed invocation uses 'up -d --no-deps'" "$PRINT" "up -d --no-deps"
contains "the printed invocation omits nothing of the monitoring overlay" "$PRINT" "-f docker-compose.monitoring.yml"
contains "the printed invocation includes the security overlay" "$PRINT" "-f docker-compose.security.yml"
for p in monitoring security security-signal; do
  contains "profile '$p' is requested" "$PRINT" "--profile $p"
done
for svc in "${TARGETS[@]}"; do
  contains "target list names '$svc'" "$PRINT" " $svc"
done
lacks "the invocation never force-recreates" "$PRINT" "--force-recreate"
lacks "the invocation never runs 'down'" "$PRINT" " down "
lacks "the invocation never removes containers" "$PRINT" " rm "
lacks "the invocation never uses --remove-orphans" "$PRINT" "--remove-orphans"
contains "img mode never builds on the box" "$PRINT" "--no-build"

printf '\n== 2. a second run issues no recreate ==\n'
# WHY the hash and not just "the second run printed Running": compose's decision is a comparison of the
# rendered service hash against the container's com.docker.compose.config-hash label, so identical
# renders on identical inputs make the second run a no-op by construction — and this arm needs no daemon.
H1="$(render config --format json | sha256sum | cut -d' ' -f1)"
H2="$(render config --format json | sha256sum | cut -d' ' -f1)"
is "the rendered project is byte-identical across two runs" "$H1" "$H2"
KH1=""; KH2=""
for svc in "${TARGETS[@]}"; do
  KH1+="$(render config --hash "$svc" | awk '{print $NF}')"$'\n'
  KH2+="$(render config --hash "$svc" | awk '{print $NF}')"$'\n'
done
is "every service config hash is identical across two runs" "$KH1" "$KH2"
if [[ -n "${KH1//$'\n'/}" ]]; then ok "all ${#TARGETS[@]} overlay services rendered a config hash"; else no "no config hashes were rendered"; fi
P1="$(bash "$STACK" print 2>&1)"; P2="$(bash "$STACK" print 2>&1)"
is "the invocation is identical across two invocations" "$P1" "$P2"

if [[ "${CMS_SECURITY_LIVE:-0}" == "1" ]] && have_docker; then
  # WHY the first run is not the assertion: this suite exports a FIXED environment (above), so if the
  # box's .env differs the first `up` legitimately recreates the containers to match it. The claim under
  # test is the NEXT one, with identical inputs: that run must change nothing. Skipped unless asked for,
  # because it starts (or re-creates) real containers.
  if ! bash "$STACK" up >/dev/null 2>&1; then no "live: the first alignment run failed"; fi
  docker ps -a --format '{{.Names}} {{.ID}}' | LC_ALL=C sort > "${TMPDIR:-/tmp}/cms-security-ids-before.txt"
  PLAN="$(bash "$STACK" up 2>&1)" || no "live: the second run failed"
  docker ps -a --format '{{.Names}} {{.ID}}' | LC_ALL=C sort > "${TMPDIR:-/tmp}/cms-security-ids-after.txt"
  if diff -q "${TMPDIR:-/tmp}/cms-security-ids-before.txt" "${TMPDIR:-/tmp}/cms-security-ids-after.txt" >/dev/null; then
    ok "live: a second run created, removed and recreated nothing (identical container IDs)"
  else
    no "live: a second run changed the container set:"; diff "${TMPDIR:-/tmp}/cms-security-ids-before.txt" "${TMPDIR:-/tmp}/cms-security-ids-after.txt" | sed 's/^/       /'
  fi
  contains "live: the plan reports every overlay service as no-op" "$PLAN" "create 0 · start 0 · no-op ${#TARGETS[@]} · recreate 0"
else
  skip "live container-ID arm: set CMS_SECURITY_LIVE=1 (with a daemon) to align and then re-run the overlay for real"
fi

printf '\n== 3. the dry run has no side effects ==\n'
if have_docker; then
  snap() {
    {
      docker ps -a --format '{{.Names}} {{.ID}} {{.State}}'
      docker volume ls -q
      docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}'
      docker network ls --format '{{.Name}}'
    } | LC_ALL=C sort
  }
  snap > "${TMPDIR:-/tmp}/cms-security-snap-before.txt"
  DRY="$(bash "$STACK" dry-run 2>&1)"
  snap > "${TMPDIR:-/tmp}/cms-security-snap-after.txt"
  if diff -q "${TMPDIR:-/tmp}/cms-security-snap-before.txt" "${TMPDIR:-/tmp}/cms-security-snap-after.txt" >/dev/null; then
    ok "docker state (containers, volumes, images, networks) is unchanged by a dry run"
  else
    no "a dry run changed docker state:"; diff "${TMPDIR:-/tmp}/cms-security-snap-before.txt" "${TMPDIR:-/tmp}/cms-security-snap-after.txt" | sed 's/^/       /'
  fi
else
  DRY="$(bash "$STACK" dry-run 2>&1)"
  skip "docker-state snapshot: no daemon reachable (the dry run still rendered)"
fi
contains "the dry run says it is a dry run" "$DRY" "DRY RUN"
contains "the dry run states it had no side effects" "$DRY" "no side effects"
contains "the dry run lists the host rootfs read-only mount" "$DRY" "/rootfs"
contains "the dry run marks that mount read-only" "$DRY" "host rootfs, read-only"
contains "the dry run prints the superset verdict" "$DRY" "SUPERSET of the running one"
contains "the dry run prints a digest it would pull" "$DRY" "sha256:"
contains "the dry run reports every published port as loopback" "$DRY" "all loopback: yes"
for svc in "${TARGETS[@]}"; do
  contains "the dry run resolves '$svc'" "$DRY" " $svc "
done

printf '\n== 4. the off-switch names only the overlay services ==\n'
OFF_LINE="$(printf '%s\n' "$PRINT" | grep -E '^  #   stop ' || true)"
if [[ -n "$OFF_LINE" ]]; then
  ok "the off-switch service list is printed:${OFF_LINE#\#   stop }"
  for svc in "${TARGETS[@]}"; do
    contains "off-switch stops '$svc'" "$OFF_LINE" " $svc"
  done
  for svc in "${BASE_SERVICES[@]}"; do
    lacks "off-switch does NOT name base service '$svc'" "$OFF_LINE" " $svc"
  done
else
  no "the printed invocation has no off-switch line"
fi
contains "the off-switch stops containers (stop, not down)" "$(sed -n '/^verb_off()/,/^}/p' "$STACK")" 'compose_run stop'
lacks "the off-switch never runs 'down'" "$(sed -n '/^verb_off()/,/^}/p' "$STACK")" 'compose_run down'
lacks "the off-switch never deletes volumes" "$(sed -n '/^verb_off()/,/^}/p' "$STACK")" 'down -v'
contains "the off-switch says findings and waivers survive" "$(sed -n '/^verb_off()/,/^}/p' "$STACK")" "rows in the panel's database"
contains "the off-switch says the scan cache is disposable" "$(sed -n '/^verb_off()/,/^}/p' "$STACK")" "disposable"

printf '\n== 5. every overlay service is profile-gated ==\n'
GATED="$(python3 - "$OVERLAY_SECURITY" "$OVERLAY_MONITORING" <<'PY'
import re, sys

services = {}
for path in sys.argv[1:]:
    name = None
    block = None
    for raw in open(path, encoding="utf-8"):
        line = raw.rstrip("\n")
        found = re.match(r"^  ([A-Za-z0-9_.-]+):\s*$", line)
        if found:
            name = found.group(1)
            services.setdefault(name, set())
            block = None
            continue
        if name is None:
            continue
        if re.match(r"^    profiles:\s*$", line):
            block = "profiles"
            continue
        item = re.match(r"^      -\s*([A-Za-z0-9_.-]+)\s*$", line)
        if item and block == "profiles":
            services[name].add(item.group(1))
            continue
        if re.match(r"^    [A-Za-z0-9_.-]+:", line):
            block = None

for svc in sorted(services):
    print(svc + "\t" + ",".join(sorted(services[svc])))
PY
)"
for svc in "${TARGETS[@]}"; do
  line="$(printf '%s\n' "$GATED" | awk -F'\t' -v s="$svc" '$1 == s { print $2 }')"
  case ",$line," in
    *,monitoring,*|*,security,*|*,security-signal,*) ok "'$svc' is behind a profile ($line)" ;;
    *) no "'$svc' is not profile-gated (profiles: '${line:-none}')" ;;
  esac
done
is "with no profile selected the overlay renders zero services" "0" "$(docker compose "${COMPOSE_MODEL[@]}" config --services 2>/dev/null | wc -l | tr -d ' ')"
is "with the three profiles selected it renders exactly the overlay" "${#TARGETS[@]}" \
  "$(render config --services | wc -l | tr -d ' ')"
MISSING="$(render config --services | LC_ALL=C sort > "${TMPDIR:-/tmp}/cms-security-svc.txt"; printf '%s\n' "${TARGETS[@]}" | LC_ALL=C sort | comm -23 - "${TMPDIR:-/tmp}/cms-security-svc.txt")"
is "every target service is in the rendered model" "" "$MISSING"

printf '\n== 6. the prerequisite checks fail loudly ==\n'
check_with() { # <env assignments...> -- runs `check` with them
  env "$@" bash "$STACK" check 2>&1
}
OUT="$(check_with SECURITY_FEED_TOKEN=)"
RC=$?
if [[ "$RC" -ne 0 ]]; then ok "an empty SECURITY_FEED_TOKEN refuses (exit $RC)"; else no "an empty SECURITY_FEED_TOKEN did not refuse"; fi
contains "the token failure says pushes are refused with 401" "$OUT" "401"
contains "the token failure says what to put in .env.security" "$OUT" "openssl rand -hex 32"

OUT="$(check_with DISCORD_WEBHOOK_URL=)"
RC=$?
if [[ "$RC" -ne 0 ]]; then ok "an empty DISCORD_WEBHOOK_URL refuses (exit $RC)"; else no "an empty DISCORD_WEBHOOK_URL did not refuse"; fi
contains "the webhook failure says no human is reached" "$OUT" "reach no human"
contains "the webhook failure says the signal still dedupes" "$OUT" "audit_log"

OUT="$(check_with DISCORD_WEBHOOK_URL= SECURITY_FEED_TOKEN=)"
contains "the webhook failure offers --feed-only as the deliberate escape" "$OUT" "--feed-only"

OUT="$(check_with SECURITY_ENABLED=0)"
RC=$?
if [[ "$RC" -ne 0 ]]; then ok "SECURITY_ENABLED=0 refuses (exit $RC)"; else no "SECURITY_ENABLED=0 did not refuse"; fi
contains "the idle failure says the stack would start and do nothing" "$OUT" "would start and do nothing"

OUT="$(env SECURITY_ENABLED=0 bash "$STACK" check --allow-idle 2>&1)"
RC=$?
if [[ "$RC" -eq 0 ]]; then ok "--allow-idle accepts SECURITY_ENABLED=0 deliberately"; else no "--allow-idle did not accept SECURITY_ENABLED=0 (exit $RC)"; fi
contains "the idle acceptance says the patching page stays empty" "$OUT" "patching page will stay empty"

OUT="$(check_with PROMETHEUS_BIND_IP=0.0.0.0)"
RC=$?
if [[ "$RC" -ne 0 ]]; then ok "a non-loopback publish address refuses (exit $RC)"; else no "a non-loopback publish address did not refuse"; fi
contains "the binding failure explains the exposure" "$OUT" "non-loopback address"

OUT="$(env DISCORD_WEBHOOK_URL= bash "$STACK" check --feed-only 2>&1)"
RC=$?
if [[ "$RC" -eq 0 ]]; then ok "--feed-only accepts an empty webhook and starts no signal"; else no "--feed-only did not accept an empty webhook (exit $RC)"; fi
contains "--feed-only says nothing is paged" "$OUT" "nothing is paged"

OUT="$(bash "$STACK" check 2>&1)"
RC=$?
if [[ "$RC" -eq 0 ]]; then ok "with every prerequisite set the gate passes"; else no "the gate failed with every prerequisite set (exit $RC)"; fi
contains "a passing gate says so" "$OUT" "all prerequisite checks passed"

printf '\n== 7. the documented enable path is the command, not a hand-typed invocation ==\n'
DOC=docs/SECURITY-FEED.md
for needle in "make security-dry-run" "make security-up" "make security-off"; do
  contains "docs name '$needle'" "$(cat "$DOC")" "$needle"
done
contains "docs say the patching page fills after the first scan" "$(cat "$DOC")" "patching page is empty until the first"
contains "docs say the digest card reads 'cannot evaluate' until Prometheus scrapes" "$(cat "$DOC")" "cannot evaluate"

printf '\n== summary ==\n'
printf 'PASS: %d  FAIL: %d' "$pass" "$fail"
[[ "$skipped" -gt 0 ]] && printf '  SKIP: %d' "$skipped"
printf '\n'
if [[ "$fail" -ne 0 ]]; then exit 1; fi
printf 'ALL PASS\n'
