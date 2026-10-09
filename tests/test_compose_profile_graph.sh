#!/usr/bin/env bash
# Asserts every compose profile invocation in the Makefile is a valid project graph.
#
# WHY this exists: `make infra` requested `--profile monitor` alone while the monitor
# profile also holds cms-scheduler, whose depends_on is `database: service_healthy` and
# whose database sits behind `profiles: [core]`. Compose validates the project before
# starting anything, so the whole target failed with `service "scheduler" depends on
# undefined service "database": invalid compose project` — and no monitor setting ever
# reached the container. Every other stack already carried its dependency profiles
# through a named *_UP_PROFILES constant; monitor alone was spelled inline, so the
# omission had nothing to catch it.
#
# WHY a static check and not `make audit`: scripts/__regression_audit.py already
# validates profile sets by shelling out to `docker compose config`, which is the
# stronger test — but it needs a Docker daemon, so it cannot run on a host without one
# and it aborts outright when `docker` is absent. This check needs only python3, so the
# defect stays caught on a workstation and in CI.
#
# The rule it enforces is Docker's own: a service that depends_on another service must
# share a profile with it, or the dependency must be enabled whenever the dependent is.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
MAKEFILE="${REPO_ROOT}/Makefile"
COMPOSE="${REPO_ROOT}/docker-compose.yml"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

# Profiles of every service, and the services each depends on. Both keys list their
# items at six spaces of indent, so one pattern serves both and the block already
# opened decides which list an item belongs to.
python3 - "$COMPOSE" <<'PY' > "${TMPDIR:-/tmp}/cms-profile-graph.txt"
import re
import sys

service_re = re.compile(r"^  ([A-Za-z0-9_.-]+):\s*$")
item_re = re.compile(r"^      -\s*([A-Za-z0-9_.-]+)\s*$")
mapping_re = re.compile(r"^      ([A-Za-z0-9_.-]+):")
any_key_re = re.compile(r"^    [A-Za-z0-9_.-]+:")

services = {}
name = None
block = None
for raw in open(sys.argv[1], encoding="utf-8"):
    line = raw.rstrip("\n")
    found = service_re.match(line)
    if found:
        name = found.group(1)
        services[name] = {"profiles": set(), "depends": set()}
        block = None
        continue
    if name is None:
        continue
    if re.match(r"^    profiles:\s*$", line):
        block = "profiles"
        continue
    if re.match(r"^    depends_on:\s*$", line):
        block = "depends"
        continue
    item = item_re.match(line)
    if item and block == "profiles":
        services[name]["profiles"].add(item.group(1))
        continue
    if item and block == "depends":
        services[name]["depends"].add(item.group(1))
        continue
    mapped = mapping_re.match(line)
    if mapped and block == "depends":
        services[name]["depends"].add(mapped.group(1))
        continue
    if any_key_re.match(line):
        block = None

for name, info in sorted(services.items()):
    print("{}\t{}\t{}".format(
        name,
        ",".join(sorted(info["profiles"])) or "default",
        ",".join(sorted(info["depends"])),
    ))
PY

declare -A SVC_PROFILES=()
declare -A SVC_DEPS=()
while IFS=$'\t' read -r svc profs deps; do
  [[ -n "$svc" ]] || continue
  SVC_PROFILES["$svc"]="$profs"
  SVC_DEPS["$svc"]="$deps"
done < "${TMPDIR:-/tmp}/cms-profile-graph.txt"

echo "every compose invocation's profile set is a valid project graph"
# The rule is NOT "a dependent must share a profile with its dependency". admin-profile
# services depend on core-profile services and that combination is the one this repo
# runs in production, via ADMIN_UP_PROFILES. The rule Compose actually enforces is that
# a service's depends_on target must be present in the ENABLED model: unprofiled
# services are always enabled, and a profile is enabled either by name or by the target
# being named on the command line. So the check below is "is every dependency of every
# enabled service itself reachable", which is what decides whether compose validates.

echo "every compose invocation enables a profile that satisfies its dependencies"
# Each *_UP_PROFILES constant and each inline invocation, resolved through the constants
# so the check follows the value actually used rather than the literal text.
declare -A CONSTANTS=()
while read -r key value; do
  [[ -n "$key" ]] || continue
  CONSTANTS["$key"]="$value"
done < <(grep -oE '^[A-Z_]+_UP_PROFILES[[:space:]]*:=.*$' "$MAKEFILE" \
  | sed -E 's/^([A-Z_]+_UP_PROFILES)[[:space:]]*:=[[:space:]]*(.*)$/\1\t\2/')

# A service is in the enabled model when it is unprofiled, or one of its profiles is
# enabled, or it is named explicitly on the command line. A dependency that is not in
# the model is what makes compose reject the project.
in_model() {
  local enabled="$1" svc="$2" targets="$3" prof
  for prof in ${SVC_PROFILES[$svc]//,/ }; do
    [[ "$prof" == "default" ]] && return 0
    [[ ",${enabled}," == *",${prof},"* ]] && return 0
  done
  for target in $targets; do
    [[ "$target" == "$svc" ]] && return 0
  done
  return 1
}

while IFS= read -r line; do
  [[ "$line" == *'#'* ]] && continue
  enabled=""
  explicit=""
  for token in $(grep -oE '\$\([A-Z_]+\)|--profile [a-z]+' <<<"$line"); do
    if [[ "$token" == '$('* ]]; then
      const="${token:2}"; const="${const%)}"
      value="${CONSTANTS[$const]:-}"
    else
      value="$token"
    fi
    for prof in ${value//--profile/ }; do
      [[ -n "$prof" ]] && enabled="${enabled:+$enabled,}$prof"
    done
  done
  # A command line carries no literal --profile when it goes through a constant, so
  # the skip test has to come after resolution or every constant-using target is
  # silently never checked.
  [[ -n "$enabled" ]] || continue
  # Services named after the command verb, as `down <services>` and `up -d nginx-proxy`.
  for verb in up down stop; do
    tail_part="${line#* $verb}"
    for svc in "${!SVC_PROFILES[@]}"; do
      [[ " $tail_part " == *" $svc "* ]] && explicit="${explicit:+$explicit }$svc"
    done
  done

  broken=""
  for svc in "${!SVC_PROFILES[@]}"; do
    in_model "$enabled" "$svc" "$explicit" || continue
    for dep in ${SVC_DEPS[$svc]//,/ }; do
      in_model "$enabled" "$dep" "$explicit" || broken="${broken} ${svc}->${dep}"
    done
  done
  if [[ -z "$broken" ]]; then
    ok "profile set [${enabled}] is a valid project graph"
  else
    no "profile set [${enabled}] has unresolvable dependencies:${broken}"
  fi
done < <(grep -E '\$\(COMPOSE_CMD\)' "$MAKEFILE")

echo "the monitor profile carries its dependency profile"
if grep -qE '^MONITOR_UP_PROFILES[[:space:]]*:=.*--profile core.*--profile monitor' "$MAKEFILE"; then
  ok "MONITOR_UP_PROFILES declares core and monitor"
else
  no "MONITOR_UP_PROFILES declares core and monitor"
fi
if grep -qE '\$\(COMPOSE_CMD\).*\$\(MONITOR_UP_PROFILES\)' "$MAKEFILE"; then
  ok "the infra target uses MONITOR_UP_PROFILES"
else
  no "the infra target uses MONITOR_UP_PROFILES"
fi

rm -f "${TMPDIR:-/tmp}/cms-profile-graph.txt"
printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]