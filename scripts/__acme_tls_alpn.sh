#!/usr/bin/env bash
# scripts/__acme_tls_alpn.sh — TLS-ALPN-01 issuance over lego, and the :443 handover it
# needs. Sourced by scripts/__domain.sh after __acme.sh.
#
# Why its own file: this is the only challenge that takes a port away from the proxy to
# run at all, so it is the only one whose failure mode can leave the site down.

readonly ACME_TLS_PORT=443
readonly ACME_PORT_RELEASE_POLL_S=1
readonly ACME_HANDOVER_TIMEOUT_DEFAULT=60

# The container the handover stopped, so exactly that one is put back. Empty means nothing
# to undo, which is what makes the restore safe to call twice.
ACME_PROXY_TO_RESTORE=""

# Waits for host :443 to stop answering; docker can return while the listener still closes.
acme_wait_for_port_free() {
  local timeout="${ACME_HANDOVER_TIMEOUT:-$ACME_HANDOVER_TIMEOUT_DEFAULT}" elapsed=0
  (( timeout > 0 )) || return 0
  while (( elapsed < timeout )); do
    if ! acme_is_port_bound; then
      log_info "port 443 released after ${elapsed}s"
      return 0
    fi
    sleep "$ACME_PORT_RELEASE_POLL_S"
    elapsed=$(( elapsed + ACME_PORT_RELEASE_POLL_S ))
  done
  log_warn "port 443 still listening after ${timeout}s — continuing anyway"
  return 0
}

# Whether anything still holds the host's :443; with no ss to ask it reports free rather
# than burning the whole timeout.
acme_is_port_bound() {
  command -v ss >/dev/null 2>&1 || return 1
  ss -tln 2>/dev/null | grep -qE "[:.]${ACME_TLS_PORT}[[:space:]]" && return 0
  return 1
}

# Gives up :443 for the length of the challenge. The restore target is recorded only after
# a successful stop: a stop that failed left the proxy running, and starting it again
# would restart a container nobody stopped.
acme_release_port443() {
  local container
  container="$(_running_domain_proxy)"
  if [[ -z "$container" ]]; then
    log_info "no domain proxy is running — :443 is already free for the challenge"
    return 0
  fi
  log_warn "releasing :443 — ${container} is stopped for the length of the TLS-ALPN-01 challenge"
  docker stop "$container" >/dev/null \
    || log_die "could not stop ${container}, so :443 is still held by the proxy" 1
  ACME_PROXY_TO_RESTORE="$container"
  acme_wait_for_port_free
  return 0
}

# Puts back what acme_release_port443 took; a second call finds nothing and does nothing,
# so the exit trap and the normal path can both call it.
acme_restore_port443() {
  local container="${ACME_PROXY_TO_RESTORE:-}"
  ACME_PROXY_TO_RESTORE=""
  [[ -n "$container" ]] || return 0
  if docker start "$container" >/dev/null; then
    log_info "${container} restarted"
  else
    log_warn "could not restart ${container} — start it by hand"
  fi
  return 0
}

# Copies what lego wrote into the lineage directory the proxy reads.
acme_install_lego_cert() {
  local src_cert="$1" src_key="$2" dest_dir
  if [[ ! -f "$src_cert" || ! -f "$src_key" ]]; then
    log_die "lego reported success but ${src_cert} or ${src_key} is missing" 1
  fi
  dest_dir="$(_cert_store_dir)/live/${CERT_LINEAGE_DOMAIN}"
  mkdir -p "$dest_dir"
  cp -f "$src_cert" "${dest_dir}/fullchain.pem"
  cp -f "$src_key" "${dest_dir}/privkey.pem"
  chmod 600 "${dest_dir}/privkey.pem"
  log_info "TLS-ALPN-01 certificate installed into ${dest_dir}"
}

# Populates LEGO_ARGS. Global rather than printed, so no subshell loses it.
acme_build_lego_args() {
  LEGO_ARGS=(
    run --accept-tos --email "$CERT_EMAIL"
    --path /lego --cert.name "$CERT_LINEAGE_DOMAIN"
    --tls --tls.address "$ACME_TLS_ALPN_ADDRESS"
  )
  local server_url domain
  server_url="$(acme_resolve_directory)"
  [[ -n "$server_url" ]] && LEGO_ARGS+=(--server "$server_url")
  [[ "$FORCE_RENEWAL" == "1" ]] && LEGO_ARGS+=(--renew-force)
  while read -r domain; do
    LEGO_ARGS+=(-d "$domain")
  done < <(_configured_domains)
  for domain in $EXTRA_DOMAINS; do
    LEGO_ARGS+=(-d "$domain")
  done
  return 0
}

# Issues or renews over TLS-ALPN-01, taking :443 for the run and giving it back on every
# exit path.
#
# The install happens here rather than in a lego --deploy-hook because that hook runs
# inside the container, where the proxy's lineage is a different path — a failing copy
# would be invisible to the host about to reload nginx.
#
# AUTO_RETRY is ignored because each failed validation spends one of the five attempts
# Let's Encrypt allows per hour and per name, and re-running a failing handover is what
# drives a consecutive-failure run into a multi-month issuance pause.
acme_issue_tls_alpn() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log_info "[dry-run] would stop ${DOMAIN_PROXY_CONTAINER}, run ${ACME_LEGO_IMAGE} with --tls --tls.address ${ACME_TLS_ALPN_ADDRESS}, install into live/${CERT_LINEAGE_DOMAIN}, restart it"
    return 0
  fi
  if [[ "$AUTO_RETRY" == "1" ]]; then
    log_warn "ACME_CHALLENGE=tls-alpn-01 does not use --auto-retry: each failed validation counts against the CA's per-name limit"
  fi

  build_cert_domains
  acme_build_lego_args
  local cert_dir lego_path issued=0
  cert_dir="$(_cert_store_dir)"
  lego_path="${cert_dir}/lego"
  mkdir -p "$lego_path"

  ACME_PROXY_TO_RESTORE=""
  trap 'acme_restore_port443' EXIT
  acme_release_port443
  if docker run --rm --network host -v "${lego_path}:/lego" \
      "$ACME_LEGO_IMAGE" "${LEGO_ARGS[@]}"; then
    issued=1
  fi
  acme_restore_port443
  trap - EXIT

  [[ "$issued" -eq 1 ]] \
    || log_die "lego did not obtain a certificate over TLS-ALPN-01 — :443 has been returned to the proxy" 1
  acme_install_lego_cert \
    "${lego_path}/certificates/${CERT_LINEAGE_DOMAIN}.crt" \
    "${lego_path}/certificates/${CERT_LINEAGE_DOMAIN}.key"
}

# Renews a TLS-ALPN-01 lineage: the handover run, then the reload and the announcement.
# Separate from certbot renew, which has no renewal/<lineage>.conf for a lego certificate.
_renew_via_tls_alpn() {
  # A scheduled run finding the window shut did the right thing by doing nothing.
  if [[ "$RENEW_DUE_ONLY" == "1" ]] && ! acme_is_handover_window_open; then
    log_info "tls-alpn-01 renewal not due: ${ACME_RENEW_BEFORE_DAYS} day(s) of margin left, window opens at ${ACME_RENEW_AT_UTC:-<disabled>} UTC"
    return 0
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log_info "[dry-run] would renew ${CERT_LINEAGE_DOMAIN} over tls-alpn-01 (needs the :443 handover)"
    return 0
  fi
  _backup_certificates
  # Forced for an explicit `renew`, left to the CA for `renew --due`.
  [[ "$RENEW_DUE_ONLY" == "1" ]] || FORCE_RENEWAL=1
  acme_issue_tls_alpn
  _reload_running_nginx
  discord_alert "Certificate renewed over tls-alpn-01 for ${CERT_LINEAGE_DOMAIN}" 65280
  log_info "Renewal complete"
  return 0
}
