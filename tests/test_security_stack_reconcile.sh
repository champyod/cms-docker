#!/usr/bin/env bash
# tests/test_security_stack_reconcile.sh — a deploy brings the running overlay onto its current images.
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

# A docker stub driven by two space-separated service lists the test sets per case.
cat > "${SB}/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$COMPOSE_LOG"
in_list() { case " $1 " in *" $2 "*) return 0 ;; esac; return 1; }
case "$*" in
  *" ps -q "*)
    svc="${!#}"
    in_list "$RUNNING" "$svc" && echo "cid-${svc}"
    exit 0 ;;
  *" config --format json"*)
    printf '{"services":{'
    first=1
    for s in $RUNNING; do
      [ "$first" -eq 1 ] || printf ','
      first=0
      printf '"%s":{"image":"ghcr.io/x/%s:tag"}' "$s" "$s"
    done
    printf '}}\n'
    exit 0 ;;
  image\ inspect*)
    ref="${!#}"
    svc="${ref##*/}"
    svc="${svc%%:*}"
    if in_list "$STALE" "$svc"; then echo "sha256:NEW-${svc}"; else echo "sha256:OLD-${svc}"; fi
    exit 0 ;;
  inspect\ --format*)
    # The container's image is the OLD id of ITS OWN service, so a service in STALE (whose tag names the NEW id) is the
    svc="${!#}"
    svc="${svc#cid-}"
    echo "sha256:OLD-${svc}"
    exit 0 ;;
esac
exit 0
STUB
chmod +x "${SB}/bin/docker"

run_verb() { # <verb> <running services> <stale services>
  : > "${SB}/compose.log"
  PATH="${SB}/bin:${PATH}" \
  COMPOSE_LOG="${SB}/compose.log" RUNNING="$2" STALE="${3:-}" \
    bash "${SCRIPT}" "$1" 2>&1
}

printf '\n== an overlay that is off is left off ==\n'
out="$(run_verb reconcile "")"
if printf '%s' "$out" | grep -q "not running — nothing to reconcile"; then
  ok "says the overlay is not running"
else
  no "says the overlay is not running (saw: ${out:-nothing})"
fi
if grep -qE " up " "${SB}/compose.log"; then
  no "an off overlay was started anyway: $(tr '\n' ';' < "${SB}/compose.log")"
else
  ok "starts nothing"
fi

printf '\n== a current overlay is not touched ==\n'
out="$(run_verb reconcile "prometheus security-scan" "")"
if printf '%s' "$out" | grep -q "already run the image their tag names"; then
  ok "reports that nothing needed recreating"
else
  no "reports that nothing needed recreating (saw: ${out:-nothing})"
fi
if grep -q " up " "${SB}/compose.log"; then
  no "a current container was recreated anyway: $(grep ' up ' "${SB}/compose.log" | head -1)"
else
  ok "recreates nothing when every image is current"
fi

printf '\n== only the drifted container is recreated ==\n'
out="$(run_verb reconcile "prometheus security-scan" "security-scan")"
if grep -q "up -d --no-deps --no-build --force-recreate security-scan$" "${SB}/compose.log"; then
  ok "recreates exactly the drifted service"
else
  no "recreates exactly the drifted service (saw: $(tr '\n' ';' < "${SB}/compose.log"))"
fi
if grep -q "force-recreate prometheus" "${SB}/compose.log"; then
  no "recreated a container whose image was current"
else
  ok "leaves the current container alone"
fi
if printf '%s' "$out" | grep -q "recreated 1 of 2"; then
  ok "says how many of how many it recreated"
else
  no "says how many of how many (saw: ${out:-nothing})"
fi

printf '\n== a scan that is running is not killed ==\n'
# A static check: the stub cannot model `docker top` faithfully enough to prove the guard runs.
guard="$(awk '/verb_reconcile\(\)/,/^}/' "${SCRIPT}")"
if printf '%s' "$guard" | grep -q 'docker top'; then
  ok "the verb asks whether the scanner is executing"
else
  no "the verb asks whether the scanner is executing"
fi
if printf '%s' "$guard" | grep -q 'security-scan is mid-run'; then
  ok "the guard says why it skipped"
else
  no "the guard says why it skipped"
fi

printf '\n== the deploy path calls it ==\n'
# The verb shipped, the wiring did not: on the production host the comparison recreated three healthy containers
recipe="$(awk '/^admin:/{f=1;next} f&&/^[^\t#]/{f=0} f' "${REPO_ROOT}/Makefile")"
if printf '%s' "$recipe" | grep -qE '^\s*@?bash scripts/__security_stack.sh reconcile'; then
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
# WHY no `|| true` here: the verb already exits 0 when the overlay is not running and when nothing drifted, so the
if printf '%s' "$recipe" | grep -qE 'reconcile[[:space:]]*\|\|[[:space:]]*true'; then
  no "a reconcile failure is not swallowed by the deploy"
else
  ok "a reconcile failure fails the deploy"
fi

printf '\n== the verb is dispatched ==\n'
if grep -qE '^\s+reconcile\)\s+verb_reconcile' "${SCRIPT}"; then
  ok "reconcile is a dispatched verb"
else
  no "reconcile is a dispatched verb"
fi

printf '\n== summary ==\n'
printf 'PASS: %d  FAIL: %d\n' "$pass" "$fail"
if [[ "$fail" -ne 0 ]]; then exit 1; fi
printf 'ALL PASS\n'
