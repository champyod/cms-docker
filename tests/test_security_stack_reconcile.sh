#!/usr/bin/env bash
# tests/test_security_stack_reconcile.sh — a deploy must bring the running overlay in step with its tags.
#
# WHY: compose recreates a container only when a compose command names it, and the security overlay is
# started by hand. A rebuilt overlay image therefore updates the TAG and leaves the running container on
# the old layers — measured in production: the scanner ran six nights of a code path that had already
# been fixed, failing every push, with nothing watching. `security-up` would have fixed it, but no deploy
# ran it.
#
# The reconcile verb has two obligations this pins:
#   * it starts NOTHING that was off (an operator who stopped the overlay meant it), and
#   * it touches only the services that are running, letting compose's own image-ID comparison decide
#     whether a container is actually recreated.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
SCRIPT="${REPO_ROOT}/scripts/__security_stack.sh"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT
mkdir -p "${SB}/bin"

# A docker stub: answers `ps -q <svc>` from a per-service flag file and records every argv it receives.
# STATE_DIR/<svc> exists ⇒ that service is running.
cat > "${SB}/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$COMPOSE_LOG"
case "$*" in
  *"ps -q "*)
    # RUNNING is the space-separated list this test declared; anything else answers empty, which is
    # how a stopped service looks to the verb.
    svc="${!#}"
    case " ${RUNNING} " in
      *" ${svc} "*) echo "cid-${svc}" ;;
    esac
    exit 0 ;;
  *" config "*)
    # The script reads the composed config for the service list; a minimal document is enough here.
    echo '{}'
    exit 0 ;;
esac
exit 0
STUB
chmod +x "${SB}/bin/docker"

run_verb() { # <verb> [running services...]
  local verb="$1"; shift
  mkdir -p "${SB}/state"; rm -f "${SB}/state"/*
  : > "${SB}/compose.log"
  PATH="${SB}/bin:${PATH}" \
  COMPOSE_LOG="${SB}/compose.log" RUNNING="$*" \
  CMS_COMPOSE_CMD="${SB}/bin/docker compose -f ${REPO_ROOT}/docker-compose.yml -f ${REPO_ROOT}/docker-compose.security.yml" \
    bash "${SCRIPT}" "$verb" 2>&1
}

printf '\n== an overlay that is off is left off ==\n'
out="$(run_verb reconcile)"
if printf '%s' "$out" | grep -q "not running — nothing to reconcile"; then
  ok "says the overlay is not running"
else
  no "says the overlay is not running (saw: ${out:-nothing})"
fi
if grep -qE " up | up$" "${SB}/compose.log"; then
  no "an off overlay was started anyway: $(tr '\n' ';' < "${SB}/compose.log")"
else
  ok "starts nothing"
fi

printf '\n== a running overlay is reconciled, only for what runs ==\n'
out="$(run_verb reconcile prometheus security-scan)"
if grep -q "pull prometheus security-scan" "${SB}/compose.log"; then
  ok "pulls only the running services"
else
  no "pulls the running services (saw: $(tr '\n' ';' < "${SB}/compose.log"))"
fi
if grep -q "up -d --no-deps --no-build prometheus security-scan" "${SB}/compose.log"; then
  ok "recreates through compose, which compares the image ID itself"
else
  no "recreates through compose (saw: $(tr '\n' ';' < "${SB}/compose.log"))"
fi
# Only the TRAILING argument list of an acting call is the service set: every compose invocation also
# carries `--profile security-signal`, so a substring search for a service name reads a profile flag as
# a named service. `ps -q <svc>` is the probe, not an act.
acting="$(grep -vE 'ps -q' "${SB}/compose.log")"
services_touched="$(printf '%s\n' "$acting" | sed -nE 's/.*(pull|--no-build) //p' | sort -u)"
if [[ "$services_touched" == "prometheus security-scan" ]]; then
  ok "the acting calls name exactly the running services (${services_touched})"
else
  no "the acting calls name exactly the running services (saw: ${services_touched:-nothing})"
fi

printf '\n== the deploy path calls it ==\n'
recipe="$(awk '/^admin:/{f=1;next} f&&/^[^\t#]/{f=0} f' "${REPO_ROOT}/Makefile")"
if printf '%s' "$recipe" | grep -q "__security_stack.sh reconcile"; then
  ok "make admin reconciles the overlay"
else
  no "make admin reconciles the overlay"
fi
if [[ "$(printf '%s' "$recipe" | grep -n "__security_stack.sh reconcile" | cut -d: -f1)" -lt \
      "$(printf '%s' "$recipe" | grep -n 'DOMAIN_PROXY_RELOAD' | cut -d: -f1)" ]]; then
  ok "reconcile runs before the front is reloaded"
else
  no "reconcile runs before the front reload"
fi

printf '\n== the verb is dispatched, not a silent no-op ==\n'
if grep -qE '^\s+reconcile\)\s+verb_reconcile' "${SCRIPT}"; then
  ok "reconcile is a dispatched verb"
else
  no "reconcile is a dispatched verb"
fi
if grep -qE '^verb_reconcile\(\)' "${SCRIPT}"; then
  ok "verb_reconcile is defined"
else
  no "verb_reconcile is defined"
fi

printf '\n== summary ==\n'
printf 'PASS: %d  FAIL: %d\n' "$pass" "$fail"
if [[ "$fail" -ne 0 ]]; then exit 1; fi
printf 'ALL PASS\n'
