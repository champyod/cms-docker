#!/usr/bin/env bash
# scripts/__acme.sh — ACME challenge, client and certificate-authority resolution.
# Sourced by scripts/__domain.sh.

# Directory URL behind each ACME_CA name, so a typo fails at config load rather than as a
# connection error to the wrong host.
readonly ACME_DIRECTORY_STAGING="https://acme-staging-v02.api.letsencrypt.org/directory"
readonly ACME_DIRECTORY_ZEROSSL="https://acme.zerossl.com/v2/DV90"
readonly ACME_DIRECTORY_BUYPASS="https://api.buypass.com/acme/directory"

# Unattended-handover defaults, named because a margin or an hour is a schedule rather
# than a bare number.
readonly ACME_RENEW_AT_UTC_DEFAULT="03:00"
readonly ACME_RENEW_BEFORE_DAYS_DEFAULT=7

# Prints the ACME directory to use, empty when the client's own default is correct.
#
# Precedence is LE_STAGING, then an explicit URL, then the named CA: a flag that loses to
# a config key is a flag that does nothing.
acme_resolve_directory() {
  if [[ "$LE_STAGING" == "1" ]]; then
    printf '%s' "$ACME_DIRECTORY_STAGING"
    return 0
  fi
  if [[ -n "$ACME_DIRECTORY_URL" ]]; then
    printf '%s' "$ACME_DIRECTORY_URL"
    return 0
  fi
  case "$ACME_CA" in
    letsencrypt)         printf '' ;;
    letsencrypt-staging) printf '%s' "$ACME_DIRECTORY_STAGING" ;;
    zerossl)             printf '%s' "$ACME_DIRECTORY_ZEROSSL" ;;
    buypass)             printf '%s' "$ACME_DIRECTORY_BUYPASS" ;;
    custom)              log_die "ACME_CA=custom also needs ACME_DIRECTORY_URL" 1 ;;
    *)                   log_die "unknown ACME_CA: ${ACME_CA} — use letsencrypt, letsencrypt-staging, zerossl, buypass or custom" 1 ;;
  esac
  return 0
}

# Fails when the configured challenge, client and CA cannot work together. Scoped to
# letsencrypt, the only method that talks to a CA.
acme_validate_config() {
  [[ "$DOMAIN_CERT_METHOD" == "letsencrypt" ]] || return 0

  case "$ACME_CHALLENGE" in
    http-01|dns-01|tls-alpn-01) ;;
    *) log_die "unknown ACME_CHALLENGE: ${ACME_CHALLENGE} — use http-01, dns-01 or tls-alpn-01" 1 ;;
  esac
  case "$ACME_CLIENT" in
    certbot|lego) ;;
    *) log_die "unknown ACME_CLIENT: ${ACME_CLIENT} — use certbot or lego" 1 ;;
  esac
  # Fatal rather than a warning: certbot has no TLS-ALPN-01, so this combination fails
  # long after the proxy has already been stopped for it.
  if [[ "$ACME_CHALLENGE" == "tls-alpn-01" && "$ACME_CLIENT" != "lego" ]]; then
    log_die "ACME_CHALLENGE=tls-alpn-01 needs ACME_CLIENT=lego — certbot has no TLS-ALPN-01 support" 1
  fi
  if [[ "$ACME_CHALLENGE" == "dns-01" && -z "$ACME_DNS_PROVIDER" ]]; then
    log_die "ACME_CHALLENGE=dns-01 also needs ACME_DNS_PROVIDER (e.g. cloudflare) and its credentials" 1
  fi
  if [[ "$ACME_CHALLENGE" == "http-01" && -n "$ACME_DNS_PROVIDER" ]]; then
    log_warn "ACME_DNS_PROVIDER is set but ACME_CHALLENGE=http-01 — set ACME_CHALLENGE=dns-01 to use it"
  fi
  acme_validate_renewal_window
  acme_resolve_directory >/dev/null
  return 0
}

# Validates the ACME configuration and reports the combination this run would use. The
# banner is here so a dry run names the challenge, client and CA before --apply could hide
# them behind an actual issuance.
acme_describe_run() {
  acme_validate_config
  local directory
  directory="$(acme_resolve_directory)"
  log_info "ACME: challenge=${ACME_CHALLENGE} client=${ACME_CLIENT} ca=${ACME_CA} directory=${directory:-client-default}"
  [[ -n "$CERT_EMAIL" ]] || log_die "CERT_EMAIL is required for letsencrypt — set env or pass --email" 1
  # :80 only carries HTTP-01; the other two answer on :53 and :443.
  if [[ "$ACME_CHALLENGE" == "http-01" ]]; then
    _preflight_port80
  fi
  return 0
}

# Validates the unattended-handover window, only when a handover is what would read it.
acme_validate_renewal_window() {
  [[ "$ACME_CHALLENGE" == "tls-alpn-01" ]] || return 0
  if [[ -n "$ACME_RENEW_AT_UTC" && ! "$ACME_RENEW_AT_UTC" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]]; then
    log_die "ACME_RENEW_AT_UTC must be HH:MM on the 24-hour clock in UTC (e.g. 03:00) — got ${ACME_RENEW_AT_UTC}" 1
  fi
  [[ "$ACME_RENEW_BEFORE_DAYS" =~ ^[0-9]+$ ]] \
    || log_die "ACME_RENEW_BEFORE_DAYS must be a non-negative integer — got ${ACME_RENEW_BEFORE_DAYS}" 1
  return 0
}

# Reports one CLI value that differs from the configured one, so a run and config.toml
# never disagree in silence. Empty on either side means nothing was overridden.
acme_report_config_override() {
  local flag="$1" configured="$2" given="$3"
  [[ -n "$given" && -n "$configured" ]] || return 0
  [[ "$configured" == "$given" ]] && return 0
  log_warn "${flag} overrides config (${configured} -> ${given}); config.toml is unchanged"
  return 0
}

# Exports the ACME challenge location for both halves of the nginx template.
#
# The two halves move together because on ACME_HTTP01_ON_443 the whole of :80 redirects,
# and a location left there would redirect the challenge to itself.
_acme_export_challenge_locations() {
  local block
  block='location /.well-known/acme-challenge/ {
        root /var/www/certbot;
        allow all;
    }'
  if [[ "$ACME_HTTP01_ON_443" == "1" ]]; then
    ACME_HTTP01_CHALLENGE_ON_80="# ACME_HTTP01_ON_443=1 — answered on :443; :80 redirects everything there"
    ACME_HTTP01_CHALLENGE_ON_443="$block"
  else
    ACME_HTTP01_CHALLENGE_ON_80="$block"
    ACME_HTTP01_CHALLENGE_ON_443="# ACME_HTTP01_ON_443=0 — HTTP-01 answered on :80 as usual"
  fi
  export ACME_HTTP01_CHALLENGE_ON_80
  export ACME_HTTP01_CHALLENGE_ON_443
}

# Whether lego issued the certificate on disk.
acme_cert_is_lego_issued() {
  [[ -f "$(_cert_store_dir)/lego/certificates/${CERT_LINEAGE_DOMAIN}.crt" ]]
}

# The `status` line for a certificate lego owns. It names the window, because
# "renewal: ok" alone reads as "any time".
acme_report_lego_renewal() {
  local days_left
  if [[ -z "$ACME_RENEW_AT_UTC" ]]; then
    log_warn "Renewal: NONE — ACME_RENEW_AT_UTC is empty, so no handover window exists"
  else
    log_info "Renewal: automatic — lego handover at ${ACME_RENEW_AT_UTC} UTC, once within ${ACME_RENEW_BEFORE_DAYS} day(s) of expiry"
  fi
  days_left="$(_cert_days_left)"
  if (( days_left >= 0 )); then
    log_info "Certificate valid for ${days_left} more days"
  fi
}

# Whether an unattended TLS-ALPN-01 renewal may take :443 right now.
#
# Both conditions are required: the margin keeps a renewal from the last moment, the time
# of day keeps it from an hour nobody agreed to. Non-zero means "not now", never an error.
acme_is_handover_window_open() {
  [[ -n "$ACME_RENEW_AT_UTC" ]] || return 1
  local days_left now_utc wanted
  days_left="$(_cert_days_left)"
  (( days_left >= 0 )) || return 1
  (( days_left <= ACME_RENEW_BEFORE_DAYS )) || return 1
  # Base 10 either way: 0900 read as octal is a syntax error, not a time.
  now_utc=$((10#$(date -u +%H%M)))
  wanted=$((10#${ACME_RENEW_AT_UTC//:/}))
  (( now_utc >= wanted )) || return 1
  return 0
}

# The renewal verdict as a JSON boolean, for monitors keyed on `renewal`.
acme_render_renewal_managed_json() {
  case "$1" in
    external|none) printf 'false' ;;
    *) printf 'true' ;;
  esac
}

# Says what to do instead of `certbot renew`, for a certificate nothing under the store
# can renew — certbot discovers renewals by renewal/<lineage>.conf, and without that file
# it reports "No renewals were attempted" while the certificate quietly approaches expiry.
_report_unmanaged_certificate() {
  local days_left expiry procedure
  days_left="$(_cert_days_left)"
  expiry="$(openssl x509 -enddate -noout -in "$(_cert_fullchain_path)" 2>/dev/null | sed 's/notAfter=//' || true)"
  case "$DOMAIN_CERT_METHOD" in
    provided)
      procedure="re-import: ./cms domain setup --cert provided --cert-path <fullchain.pem> --key-path <privkey.pem> --apply"
      ;;
    *)
      if [[ "$ACME_CHALLENGE" == "tls-alpn-01" ]]; then
        procedure="automatic at ACME_RENEW_AT_UTC=${ACME_RENEW_AT_UTC:-<disabled>} within ${ACME_RENEW_BEFORE_DAYS} day(s) of expiry, or now with: ./cms domain renew --apply"
      else
        procedure="re-issue: ./cms domain cert --apply"
      fi
      ;;
  esac
  log_warn "no certbot renewal config for ${CERT_LINEAGE_DOMAIN} — certbot will never renew this certificate"
  if (( days_left >= 0 )); then
    log_warn "certificate expiry: ${expiry:-unknown} (${days_left} day(s) left)"
  else
    log_warn "certificate expiry: unreadable"
  fi
  log_warn "renewal procedure: ${procedure}"
}

# Handles a certificate no renewal config covers: reports the procedure, or dies when the
# operator asked for a renewal that cannot happen.
acme_report_unrenewable_certificate() {
  local days_left
  days_left="$(_cert_days_left)"
  # Quiet while there is no urgency: hourly warnings train the operator to stop reading.
  if [[ "$RENEW_DUE_ONLY" == "1" ]] && (( days_left > ACME_RENEW_BEFORE_DAYS )); then
    log_info "certificate for ${CERT_LINEAGE_DOMAIN} has no certbot renewal config and ${days_left} day(s) left — nothing due"
    return 0
  fi
  _report_unmanaged_certificate
  if [[ "$RENEW_DUE_ONLY" == "1" ]]; then
    return 0
  fi
  log_die "cannot renew ${CERT_LINEAGE_DOMAIN}: no certbot renewal config, so certbot has no record of it" 1
}
