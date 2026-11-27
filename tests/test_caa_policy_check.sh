#!/usr/bin/env bash
# A CAA gap is visible in status and preflight, not only in a scan report months later.
#
# CAA (DNS Certification Authority Authorization) is the record that tells a certificate
# authority whether it may issue for a name. Because it inherits from the closest enclosing
# set, one record at the apex covers every subdomain, which is why the check reads the apex
# and not the leaf. The live zone currently answers CAA with NOERROR and no records, so any
# public authority may issue for the name and nothing in the tooling said so.
#
# These cases drive the real script against a stubbed `dig`, so the verdict is asserted
# rather than the presence of a string: present, missing, partial, and the no-dig case that
# must not read as success.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
DOMAIN="${REPO_ROOT}/scripts/__domain.sh"
# shellcheck source=__lib/domain_sandbox.sh
source "${SCRIPT_DIR}/__lib/domain_sandbox.sh"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

trap domain_sandbox_cleanup EXIT

# A sandbox whose `dig` answers from a fixture file, so each case chooses the DNS answer
# without touching a resolver. Records are "tag value" lines; an empty file is NODATA.
sandbox() { # <records-fixture path>
  local dir
  dir="$(domain_sandbox)"
  cat > "${dir}/bin/dig" <<'STUB'
#!/usr/bin/env bash
# Only the CAA query is answered from the fixture; anything else returns nothing, which is
# what the script already handles for an unreachable resolver.
qtype=""
for arg in "$@"; do
  case "$arg" in
    CAA) qtype="CAA" ;;
    +short) short=1 ;;
  esac
done
if [[ -n "${DIG_FAILS:-}" ]]; then exit 9; fi
if [[ "$qtype" == "CAA" ]]; then
  # The fixture maps "<zone> <value>" so a walk is answered per level. A zone absent from
  # the fixture is NODATA, which is how an unpublished level really answers.
  qname=""
  for arg in "$@"; do
    case "$arg" in CAA|+short|-*) ;; *) [[ -z "$qname" ]] && qname="$arg" ;; esac
  done
  if [[ -n "${short:-}" ]]; then
    awk -v want="$qname" '$1 == want { $1=""; sub(/^ /,""); print "0 issue \"" $0 "\"" }' "${CAA_FIXTURE}" 2>/dev/null
  else
    printf ';; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 1\n'
  fi
fi
exit 0
STUB
  printf '#!/bin/bash\nexit 0\n' > "${dir}/bin/certbot"
  printf '#!/bin/bash\nexit 0\n' > "${dir}/bin/systemctl"
  printf '#!/bin/bash\nexit 0\n' > "${dir}/bin/docker"
  chmod +x "${dir}/bin"/*
  printf '%s' "$dir"
}

# Runs one verb in the sandbox and returns its output.
# WORKER_HOST is set because preflight aborts on it before reaching the CAA row: a real
# deployment always has it, and a sandbox without it would test the abort instead.
run_domain() { # <dir> <args...>
  local dir="$1"; shift
  env PATH="${dir}/bin:${PATH}" \
      DOMAIN_NAME="${NAME:-example.org}" CERT_LINEAGE_DOMAIN="${NAME:-example.org}" \
      WORKER_HOST=127.0.0.1 WORKER_RPC_PORT=26000 \
      CAA_ENABLED="${CAA_ENABLED:-1}" CAA_ISSUER="${CAA_ISSUER:-letsencrypt.org}" \
      CAA_FIXTURE="${CAA_FIXTURE:-/dev/null}" DIG_FAILS="${DIG_FAILS:-}" \
      bash "${dir}/scripts/__domain.sh" "$@" 2>&1
}

printf '\n== a published apex policy is reported as present ==\n'
dir="$(sandbox)"
CAA_FIXTURE="$(mktemp)"; printf 'example.org letsencrypt.org\n' > "$CAA_FIXTURE"
OUT="$(CAA_FIXTURE="$CAA_FIXTURE" run_domain "$dir" status)"
if printf '%s\n' "$OUT" | grep -qi 'CAA.*PASS'; then ok "status reports the policy present"; else no "status reports the policy present"; fi

printf '\n== a missing policy is reported, not assumed ==\n'
: > "$CAA_FIXTURE"
OUT="$(CAA_FIXTURE="$CAA_FIXTURE" run_domain "$dir" status)"
if printf '%s\n' "$OUT" | grep -qiE 'CAA.*(MISSING|WARN)'; then ok "status reports the policy missing"; else no "status reports the policy missing (got: $(printf '%s' "$OUT" | grep -i caa | head -1))"; fi

printf '\n== a policy that does not allow the configured issuer is a mismatch ==\n'
printf 'example.org pki.goog\n' > "$CAA_FIXTURE"
OUT="$(CAA_FIXTURE="$CAA_FIXTURE" run_domain "$dir" status)"
if printf '%s\n' "$OUT" | grep -qiE 'CAA.*(MISMATCH|does not allow|WARN)'; then ok "status reports an issuer mismatch"; else no "status reports an issuer mismatch"; fi

printf '\n== the apex is what gets checked, once ==\n'
printf 'example.org letsencrypt.org\n' > "$CAA_FIXTURE"
OUT="$(CAA_FIXTURE="$CAA_FIXTURE" run_domain "$dir" status)"
if printf '%s\n' "$OUT" | grep -qi 'CAA (example.org)'; then ok "the check names the apex it read"; else no "the check names the apex it read"; fi
if [[ "$(printf '%s\n' "$OUT" | grep -c -iE '^[[:space:]]+CAA \(')" -eq 1 ]]; then ok "the apex is checked once, not per subdomain"; else no "the apex is checked once, not per subdomain"; fi

printf '\n== an unreadable resolver is not a pass ==\n'
: > "$CAA_FIXTURE"
OUT="$(CAA_FIXTURE="$CAA_FIXTURE" DIG_FAILS=1 run_domain "$dir" status)"
if printf '%s\n' "$OUT" | grep -qiE 'CAA.*PASS'; then no "a failed lookup is not reported as PASS"; else ok "a failed lookup is not reported as PASS"; fi

printf '\n== preflight carries the same verdict ==\n'
printf 'example.org letsencrypt.org\n' > "$CAA_FIXTURE"
OUT="$(CAA_FIXTURE="$CAA_FIXTURE" run_domain "$dir" preflight)"
if printf '%s\n' "$OUT" | grep -qi 'CAA'; then ok "preflight includes the CAA row"; else no "preflight includes the CAA row"; fi
: > "$CAA_FIXTURE"
OUT="$(CAA_FIXTURE="$CAA_FIXTURE" run_domain "$dir" preflight)"
if printf '%s\n' "$OUT" | grep -qiE 'CAA.*(MISSING|WARN)'; then ok "preflight reports the missing policy"; else no "preflight reports the missing policy"; fi

printf '\n== a deep name under a two-level suffix reads the governing zone ==\n'
# The real deployment serves <host>.<site>.<school>.ac.th, i.e. a name under a TWO-LEVEL
# public suffix. "Last two labels" therefore resolves to the suffix itself (ac.th) — a zone
# nobody here can publish to that would bind unrelated institutions. The governing zone is
# the school domain one level down. This shape is the whole point of the case: an earlier
# fixture with a single-label suffix passed while the shipped code read ac.th on the real
# name, because "last two labels" happened to be correct there.
DEEP='a.b.school.ac.th'
printf 'school.ac.th letsencrypt.org\n' > "$CAA_FIXTURE"
OUT="$(NAME="$DEEP" CAA_FIXTURE="$CAA_FIXTURE" run_domain "$dir" status)"
if printf '%s\n' "$OUT" | grep -q 'CAA (school.ac.th)'; then ok "the governing zone is the school domain, not the suffix"; else no "the governing zone is the school domain, not the suffix (got: $(printf '%s' "$OUT" | grep -i ' CAA (' | head -1 | sed 's/  */ /g'))"; fi
if printf '%s\n' "$OUT" | grep -qE 'CAA \(a\.b\.school\.ac\.th\)|CAA \(ac\.th\)'; then no "the label is neither the host nor the suffix"; else ok "the label is neither the host nor the suffix"; fi

printf '\n== a record at the host itself wins the walk ==\n'
printf '%s letsencrypt.org\n' "$DEEP" > "$CAA_FIXTURE"
OUT="$(NAME="$DEEP" CAA_FIXTURE="$CAA_FIXTURE" run_domain "$dir" status)"
if printf '%s\n' "$OUT" | grep -qi 'CAA.*PASS'; then ok "an exact-name record is found first"; else no "an exact-name record is found first"; fi

printf '\n== nothing at any level names where to publish ==\n'
: > "$CAA_FIXTURE"
OUT="$(NAME="$DEEP" CAA_FIXTURE="$CAA_FIXTURE" run_domain "$dir" status)"
if printf '%s\n' "$OUT" | grep -q 'school.ac.th'; then ok "the MISSING verdict names the zone to publish at"; else no "the MISSING verdict names the zone to publish at"; fi

rm -f "$CAA_FIXTURE"

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
