#!/usr/bin/env bash
# tests/test_security_headers.sh — pin the env-driven response hardening.
#
# The front door's CSP, OCSP and server_tokens come from config, not the template:
# a fixed policy in the template could not be tuned per deployment, and the static
# location had to re-declare the headers or it dropped them entirely.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
HEADERS="${REPO_ROOT}/scripts/__security_headers.sh"
TEMPLATE="${REPO_ROOT}/config/grader.nginx.conf.template"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

render() { # <extra env assignments...>
  env CERT_LINEAGE_DOMAIN=grader.example.org HSTS_MAX_AGE=300 "$@" \
    bash -c 'source "$1"; _security_headers_build; printf "TOKENS|%s\n" "$SERVER_TOKENS_DIRECTIVE"; printf "OCSP|%s\n" "$OCSP_STAPLING_DIRECTIVES"; printf "CSP|%s\n" "$CSP_HEADER"; printf "LOC|%s\n" "$LOCATION_SECURITY_HEADERS"' _ "$HEADERS" 2>&1
}

has() { if printf '%s\n' "$OUT" | grep -Fq -- "$2"; then ok "$1"; else no "$1 (missing: $2)"; fi; }

printf '\n== defaults harden without baking a policy in the template ==\n'
OUT="$(render)"
has "server_tokens is off" "server_tokens off;"
has "OCSP stapling is on" "ssl_stapling on;"
has "OCSP verification is on" "ssl_stapling_verify on;"
has "the stapling trust anchor is the issued bundle" "ssl_trusted_certificate /etc/letsencrypt/live/grader.example.org/fullchain.pem;"
has "CSP is off by default" "# Content-Security-Policy disabled (CSP_ENABLED=0)"
if printf '%s' "$OUT" | grep -Fq 'resolver '; then no "OCSP does not add a second resolver"; else ok "OCSP does not add a second resolver"; fi

printf '\n== an operator tunes the policy from config ==\n'
OUT="$(render CSP_ENABLED=1 CSP_MODE=enforce CSP_SCRIPT_SRC="'self' https://cdn.example.org")"
has "enforce chooses the enforcing header name" 'add_header Content-Security-Policy '
has "the source list is carried through" "script-src 'self' https://cdn.example.org"
if printf '%s' "$OUT" | grep -Fq 'Report-Only'; then no "enforce is not report-only"; else ok "enforce is not report-only"; fi

OUT="$(render CSP_ENABLED=1 CSP_MODE=report-only CSP_REPORT_URI=https://reports.example.org/csp)"
has "report-only chooses the reporting header" "Content-Security-Policy-Report-Only"
has "the report endpoint is appended" "report-uri https://reports.example.org/csp"

OUT="$(render CSP_ENABLED=1 CSP_IMG_SRC="")"
if printf '%s' "$OUT" | grep -Fq 'img-src'; then no "an empty source list drops its directive"; else ok "an empty source list drops its directive"; fi

printf '\n== the template carries the hardening into the static location ==\n'
if grep -Fq '${LOCATION_SECURITY_HEADERS}' "$TEMPLATE"; then ok "the static location re-declares the headers"; else no "the static location re-declares the headers"; fi

printf '\n== summary ==\n'
printf 'PASS: %d  FAIL: %d\n' "$pass" "$fail"
if [[ "$fail" -ne 0 ]]; then exit 1; fi
printf 'ALL PASS\n'
