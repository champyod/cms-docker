#!/usr/bin/env bash
# OCSP stapling is offered only when the certificate can actually be stapled.
#
# Let's Encrypt removed the OCSP URL from issued certificates on 2025-05-07 and turned
# off its responders on 2025-08-06, publishing revocation exclusively through CRLs. nginx
# declines stapling for such a certificate (src/event/ngx_event_openssl_stapling.c:463-469
# logs "no OCSP responder URL in the certificate" and returns NGX_DECLINED), so emitting
# the directives unconditionally ships a control that cannot fire while the tests keep
# asserting the directive text. These cases pin the decision to the certificate.
#
# The stubs let a run plant a leaf with and without an OCSP URL, so the assertion is about
# the branch taken, not about a fixture that happens to match one deployment.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
HEADERS="${REPO_ROOT}/scripts/__security_headers.sh"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# One CA and two leaves: a modern one with only a CRL distribution point (what Let's
# Encrypt issues now) and a legacy one that still carries an OCSP AIA URL.
make_certs() {
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=OCSP Test CA" \
    -keyout "$work/ca.key" -out "$work/ca.pem" 2>/dev/null
  openssl req -newkey rsa:2048 -nodes -subj "/CN=cms.example.org" \
    -keyout "$work/leaf.key" -out "$work/leaf.csr" 2>/dev/null
  for kind in crl-only legacy; do
    local ext="$work/${kind}.ext"
    if [[ "$kind" == "crl-only" ]]; then
      printf 'crlDistributionPoints = URI:http://crl.example.org/ca.crl\n' > "$ext"
    else
      printf 'authorityInfoAccess = OCSP;URI:http://ocsp.example.org,caIssuers;URI:http://ca.example.org/ca.crt\n' > "$ext"
    fi
    openssl x509 -req -in "$work/leaf.csr" -CA "$work/ca.pem" -CAkey "$work/ca.key" \
      -CAcreateserial -days 30 -extfile "$ext" -out "$work/${kind}.pem" 2>/dev/null
  done
}

make_certs

# Runs the builder with the given leaf in place and prints the OCSP result plus the line
# the builder logged, so both the emitted directives and the operator-visible signal can
# be asserted.
render() { # <leaf path> [extra env assignments...]
  local leaf="$1"
  shift
  mkdir -p "$work/store/live/cms.example.org"
  cp -f "$leaf" "$work/store/live/cms.example.org/fullchain.pem"
  env CERT_LINEAGE_DOMAIN=cms.example.org REPO_ROOT="$REPO_ROOT" \
      CERT_DIR_NAME="$work/store" HSTS_MAX_AGE=300 "$@" \
    bash -c 'source "$1"; _security_headers_build; {
        printf "OCSP|%s\n" "$OCSP_STAPLING_DIRECTIVES"
        printf "ANCHOR|%s\n" "${OCSP_STAPLING_ANCHOR:-}"
        printf "NOTE|%s\n" "${OCSP_STAPLING_NOTE:-}"
      }' _ "$HEADERS" 2>&1
}

printf '\n== a leaf with no OCSP URL is not stapled ==\n'
OUT="$(render "$work/crl-only.pem")"
if printf '%s\n' "$OUT" | grep -qE '^OCSP\|\s*ssl_stapling on;'; then
  no "stapling is not emitted for a CRL-only certificate"
else
  ok "stapling is not emitted for a CRL-only certificate"
fi
if printf '%s\n' "$OUT" | grep -q 'no OCSP responder URL'; then
  ok "the reason is logged where an operator sees it"
else
  no "the reason is logged where an operator sees it (got: $(printf '%s' "$OUT" | grep '^NOTE|' | head -1))"
fi
if printf '%s\n' "$OUT" | grep -q 'Certificate Revocation List'; then
  ok "the log names the mechanism that does cover this certificate"
else
  no "the log names the mechanism that does cover this certificate"
fi

printf '\n== a leaf that carries an OCSP URL is still stapled ==\n'
OUT="$(render "$work/legacy.pem")"
if printf '%s\n' "$OUT" | grep -q '^OCSP|ssl_stapling on;'; then
  ok "stapling is emitted when the certificate can be stapled"
else
  no "stapling is emitted when the certificate can be stapled (got: $(printf '%s' "$OUT" | grep '^OCSP|' | head -1))"
fi
if printf '%s\n' "$OUT" | grep -q 'ssl_stapling_verify on;'; then
  ok "verification travels with stapling"
else
  no "verification travels with stapling"
fi
if printf '%s\n' "$OUT" | grep -q '^ANCHOR|ssl_trusted_certificate /etc/letsencrypt/live/cms.example.org/fullchain.pem;'; then
  ok "the trust anchor still names the issued chain"
else
  no "the trust anchor still names the issued chain"
fi

printf '\n== the operator switch still governs, and off stays off ==\n'
OUT="$(render "$work/legacy.pem" OCSP_STAPLING=0)"
if printf '%s\n' "$OUT" | grep -q '^OCSP|# OCSP stapling disabled'; then
  ok "OCSP_STAPLING=0 disables stapling for a staplable certificate"
else
  no "OCSP_STAPLING=0 disables stapling for a staplable certificate"
fi
OUT="$(render "$work/crl-only.pem" OCSP_STAPLING=0)"
if printf '%s\n' "$OUT" | grep -Eq '^OCSP\|(#|$)'; then
  ok "OCSP_STAPLING=0 stays off for a CRL-only certificate"
else
  no "OCSP_STAPLING=0 stays off for a CRL-only certificate"
fi

printf '\n== a missing certificate is not guessed at ==\n'
OUT="$(render "$work/absent.pem")"
if printf '%s\n' "$OUT" | grep -q '^OCSP|ssl_stapling on;'; then
  no "an unreadable certificate does not enable stapling"
else
  ok "an unreadable certificate does not enable stapling"
fi
if printf '%s\n' "$OUT" | grep -q 'no OCSP responder URL\|cannot be read'; then
  ok "an unreadable certificate is reported rather than assumed staplable"
else
  no "an unreadable certificate is reported rather than assumed staplable"
fi

printf '\n== summary ==\n'
printf 'PASS: %d  FAIL: %d\n' "$pass" "$fail"
if [[ "$fail" -ne 0 ]]; then exit 1; fi
printf 'ALL PASS\n'
