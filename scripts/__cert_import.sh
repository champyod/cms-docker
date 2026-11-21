#!/usr/bin/env bash
# scripts/__cert_import.sh — the `provided` path: validating an externally-issued
# certificate and keeping it in the one layout the proxy reads. Sourced by
# scripts/__domain.sh.
#
# Why its own file: this is the only certificate path that never talks to a CA, so it has
# none of the questions __acme.sh answers and its own failure shape — installed, then
# refused by nginx.

# Whether the key belongs to the certificate; the public keys are compared, which two
# files that merely both parse cannot satisfy.
cert_key_matches_certificate() {
  local certificate="$1" key="$2" public_from_cert public_from_key
  public_from_cert="$(openssl x509 -noout -pubkey -in "$certificate" 2>/dev/null)" || return 1
  public_from_key="$(openssl pkey -pubout -in "$key" 2>/dev/null)" || return 1
  [[ -n "$public_from_cert" && "$public_from_cert" == "$public_from_key" ]]
}

# Checks a supplied certificate before it becomes the one nginx serves.
#
# A key that does not match is copied happily and only refused at the next reload, by
# which point the old certificate is already gone; a certificate missing one SAN still
# breaks that vhost even though it verifies.
cert_validate_supplied_certificate() {
  local certificate="$1" key="$2" uncovered=""

  if openssl verify -untrusted "$certificate" "$certificate" >/dev/null 2>&1; then
    log_info "chain verified"
  else
    log_warn "chain did not verify — clients may reject this certificate"
  fi

  cert_key_matches_certificate "$certificate" "$key" \
    || log_die "${key} is not the private key for ${certificate}" 1
  log_info "private key matches the certificate"

  if ! openssl x509 -help 2>&1 | grep -q -- '-checkhost'; then
    log_warn "this openssl cannot check host coverage — confirm the names cover ${ACME_HOST_NAMES} by hand"
    return 0
  fi
  local domain verdict
  while read -r domain; do
    # OpenSSL 3.0 (Ubuntu 24.04) prints the verdict but leaves the exit status at 0 —
    # only newer versions fail the command — so the message is the portable signal.
    verdict="$(openssl x509 -noout -checkhost "$domain" -in "$certificate" 2>&1)" \
      || { uncovered+="${domain} "; continue; }
    case "$verdict" in
      *"does NOT match"*) uncovered+="${domain} " ;;
    esac
  done < <(_configured_domains)
  if [[ -n "$uncovered" ]]; then
    log_warn "certificate does not cover: ${uncovered% }"
  else
    log_info "certificate covers every configured domain"
  fi
  return 0
}

# Moves a legacy flat live/{fullchain,privkey}.pem into the lineage the proxy reads.
#
# One feature with two layouts meant a certificate could be installed where nginx never
# looked, and the read fallback that kept honouring the flat path is what made that
# mismatch silent instead of broken.
cert_migrate_flat_store() {
  local flat_cert flat_key destination
  flat_cert="$(_cert_store_dir)/live/fullchain.pem"
  flat_key="$(_cert_store_dir)/live/privkey.pem"
  destination="$(_cert_store_dir)/live/${CERT_LINEAGE_DOMAIN}"
  [[ -f "$flat_cert" || -f "$flat_key" ]] || return 0
  if [[ -f "${destination}/fullchain.pem" ]]; then
    log_warn "both a flat and a lineage certificate exist — ${destination} wins, the flat pair is left alone"
    return 0
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log_info "[dry-run] would move ${flat_cert} and ${flat_key} into ${destination}"
    return 0
  fi
  mkdir -p "$destination"
  if [[ -f "$flat_cert" ]]; then
    mv -f "$flat_cert" "${destination}/fullchain.pem"
  fi
  if [[ -f "$flat_key" ]]; then
    mv -f "$flat_key" "${destination}/privkey.pem"
    chmod 600 "${destination}/privkey.pem"
  fi
  log_warn "moved the legacy flat certificate into ${destination} — the proxy reads the lineage path"
  return 0
}
