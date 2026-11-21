#!/usr/bin/env bash
# scripts/__acme_tls_alpn.sh — TLS-ALPN-01 issuance over lego, and the :443 handover it
# needs. Sourced by scripts/__domain.sh after __acme.sh.
#
# Why its own file: this is the only challenge that takes a port away from the proxy to
# run at all, so it is the only one whose failure mode can leave the site down.

readonly ACME_TLS_PORT=443
readonly ACME_PORT_RELEASE_POLL_S=1
readonly ACME_HANDOVER_TIMEOUT_DEFAULT=60
# Seconds a restored container is given to report healthy. Sized above the WAF's own
# start_period (20s) and retries (3) because it has to cover them, not race them.
readonly ACME_RESTORE_HEALTH_TIMEOUT_DEFAULT=90

# The containers the handover stopped, so exactly those are put back. Empty means nothing to
# undo, which is what makes the restore safe to call twice.
ACME_PORT443_STOPPED=()

# Whether one container's published-port list contains host TCP :443. docker prints bindings
# as "host:port->container/proto", comma-separated, where host is "0.0.0.0", "[::]" or a bare
# address, and the port half may be a range; so the host port is whatever follows the last
# colon before "->", and a range counts as holding :443 when it spans it. Only /tcp is read,
# because that is the protocol the challenge binds.
_acme_publishes_443() {
  local binding host published low high
  while IFS= read -r binding; do
    binding="${binding#"${binding%%[![:space:]]*}"}"
    binding="${binding%"${binding##*[![:space:]]}"}"
    [[ "$binding" == *'/tcp' ]] || continue
    host="${binding%%->*}"
    published="${host##*:}"
    low="${published%%-*}"
    high="${published#*-}"
    [[ "$high" == "$published" ]] && high="$low"
    if [[ "$low" =~ ^[0-9]+$ && "$high" =~ ^[0-9]+$ ]] \
      && (( low <= ACME_TLS_PORT && ACME_TLS_PORT <= high )); then
      return 0
    fi
  done < <(printf '%s\n' "${1:-}" | tr ',' '\n')
  return 1
}

# The running containers publishing host :443, one name per line. Discovered rather than
# named, because which one holds :443 is a deployment choice: WAF_PORT=443 puts grader-waf
# in front and the proxy moves to 8443, so a hardcoded proxy would be stopped while the WAF
# kept the port the challenge has to bind.
#
# A row whose bindings cannot be read is treated as a holder, because the failure this
# handover exists to prevent is silently carrying on while :443 is still taken.
_acme_port443_holders() {
  local rows row name status=0
  rows="$(docker ps --format '{{.Names}}|{{.Ports}}' 2>/dev/null)" || status=$?
  (( status == 0 )) || return 1
  while IFS= read -r row; do
    [[ -n "$row" ]] || continue
    name="${row%%|*}"
    [[ -n "$name" ]] || continue
    if [[ "$row" != *'|'* ]] || _acme_publishes_443 "${row#*|}"; then
      printf '%s\n' "$name"
    fi
  done <<< "$rows"
  return 0
}

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

# Gives up :443 for the length of the challenge. Each holder is recorded only after its own
# stop succeeded: a stop that failed left that container running, and starting it again
# would restart a container nobody stopped.
acme_release_port443() {
  local rows="" holders=() holder
  rows="$(_acme_port443_holders)" \
    || log_die "could not list the running containers, so :443 cannot be given up safely" 1
  if [[ -n "$rows" ]]; then
    mapfile -t holders <<< "$rows"
  fi
  if [[ "${#holders[@]}" -eq 0 ]]; then
    log_info "no domain proxy is running — :443 is already free for the challenge"
    return 0
  fi
  log_warn "releasing :443 — ${holders[*]} stopped for the length of the TLS-ALPN-01 challenge"
  for holder in "${holders[@]}"; do
    docker stop "$holder" >/dev/null \
      || log_die "could not stop ${holder}, so :443 is still held by it" 1
    ACME_PORT443_STOPPED+=("$holder")
  done
  acme_wait_for_port_free
  return 0
}

# Waits for one restored container to report healthy.
#
# WHY this exists: `docker start` returns as soon as the container is created, well before
# its healthcheck has run, so a status read straight after a renewal showed the WAF as
# `starting` or briefly `unhealthy` even on a clean restore — the restore looked like a
# failure it was not.
#
# WHY a container with no healthcheck counts as done: docker reports no health state at
# all for it, so there is nothing to wait for. Waiting would burn the whole timeout on
# every proxy restart and then report a failure that describes nothing.
#
# WHY an unreadable state also counts as done: `docker inspect` can fail on its own —
# no daemon, a container already reaped. Looping on an answer that will never arrive
# turns a cosmetic wait into a stalled handover, and this runs inside an EXIT trap.
#
# WHY a timeout warns instead of failing: the certificate is already installed and the
# container is already running by this point. Refusing to return would leave the EXIT
# trap re-running the restore, and a slow healthcheck endangers nothing that matters.
_acme_wait_healthy() {
  local holder="$1" timeout="${ACME_RESTORE_HEALTH_TIMEOUT:-$ACME_RESTORE_HEALTH_TIMEOUT_DEFAULT}"
  local elapsed=0 state
  while (( elapsed < timeout )); do
    state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
      "$holder" 2>/dev/null)" || state=""
    case "$state" in
      healthy)
        log_info "${holder} is healthy ${elapsed}s after restart"
        return 0
        ;;
      none)
        log_info "${holder} has no healthcheck — running is the most it reports"
        return 0
        ;;
      unhealthy)
        log_warn "${holder} is unhealthy ${elapsed}s after restart — it is running, and the certificate is installed"
        return 0
        ;;
      '')
        log_warn "could not read the health of ${holder} — it is running, and the certificate is installed"
        return 0
        ;;
    esac
    sleep "$ACME_PORT_RELEASE_POLL_S"
    elapsed=$(( elapsed + ACME_PORT_RELEASE_POLL_S ))
  done
  log_warn "${holder} did not report healthy within ${timeout}s — it is running, and the certificate is installed"
  return 0
}

# Puts back what acme_release_port443 took; a second call finds nothing and does nothing,
# so the exit trap and the normal path can both call it.
acme_restore_port443() {
  local pending=() holder
  pending=(${ACME_PORT443_STOPPED[@]+"${ACME_PORT443_STOPPED[@]}"})
  ACME_PORT443_STOPPED=()
  [[ "${#pending[@]}" -gt 0 ]] || return 0
  for holder in "${pending[@]}"; do
    if docker start "$holder" >/dev/null; then
      log_info "${holder} restarted"
      _acme_wait_healthy "$holder"
    else
      log_warn "could not restart ${holder} — start it by hand"
    fi
  done
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

  ACME_PORT443_STOPPED=()
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
