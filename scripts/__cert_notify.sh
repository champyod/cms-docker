#!/usr/bin/env bash
# scripts/__cert_notify.sh — announce a certificate renewal to Discord.
#
# WHY a script and not a command inside the unit: systemd expands environment-variable
# references and percent specifiers in a command line before bash ever runs, and splits that
# line on unescaped whitespace. A unit therefore cannot assemble a JSON alert — the webhook
# URL sourced inside the command arrives empty and the body arrives as separate words — so
# the unit runs this instead.
set -eu
# pipefail only if available
if (set -o pipefail 2>/dev/null); then
  set -o pipefail
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# WHY the same contract as the backup path: log_info/log_warn/log_die come from the shared
# library, and a delivery that arrives without it is broken rather than served by a second,
# divergent copy of the helpers.
if [[ ! -f "${SCRIPT_DIR}/__lib/common.sh" ]]; then
  printf '[FAIL] %s\n' "missing ${SCRIPT_DIR}/__lib/common.sh — deliver scripts/__lib beside this script" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/common.sh"

# WHY walking up instead of taking the parent of scripts/: this script is reached through a
# copy as well as through the checkout — a test sandbox stages one — and the one directory
# every copy agrees on is the root holding both the Makefile and ./cms. WHY not $PWD: a run
# from anywhere else would read that directory's .env instead of the checkout's.
repo_root() {
  local dir="${SCRIPT_DIR}"
  while [[ "${dir}" != '/' ]]; do
    if [[ -f "${dir}/Makefile" && -x "${dir}/cms" ]]; then
      printf '%s' "${dir}"
      return 0
    fi
    dir="$(dirname -- "${dir}")"
  done
  log_die "no ancestor of ${SCRIPT_DIR} holds both Makefile and cms — run this from a CMS checkout"
}

# notify_payload_json <hostname> — the alert body on stdout.
# WHY one printf with a single %s: the only interpolated value is a hostname, which carries
# neither a quote nor a backslash, so the delimiter this format writes cannot collide with
# the content it writes. A payload concatenated out of escaped literals is only ever as
# correct as the case nobody thought to escape.
notify_payload_json() {
  printf '{"content": ":lock: SSL cert renewed on %s"}\n' "$1"
}

# discord_post <webhook> <payload_file> <conf_file> — deliver a prepared alert.
# WHY the webhook lands in a curl config file instead of on the command line: the token in
# that URL is a credential, and a process command line is readable by every account on the
# box for as long as the request lives. The body is read from disk for the same reason, so
# no part of an alert — which names the host — is ever in argv.
discord_post() {
  local webhook="$1" payload_file="$2" conf_file="$3"
  cat > "$conf_file" <<EOF
url = "${webhook}"
EOF
  curl -s -o /dev/null -X POST -H "Content-Type: application/json" \
    -d "@${payload_file}" -K "$conf_file" 2>/dev/null
}

# send_notification <webhook> <hostname> — post the alert, and return 0 whatever happens.
# WHY: a Discord outage must not mark a successful certificate renewal failed. The unit used
# to end this command in `|| true`, which was right about the exit status and wrong about
# everything else — it hid a sender that had already stopped delivering, so the renewal
# reported success while no alert had arrived for as long as the unit existed.
send_notification() {
  local webhook="$1" host="$2"
  local payload_file conf_file build_status=0

  if ! payload_file="$(mktemp "${TMPDIR:-/tmp}/cms-cert-notify-payload.XXXXXX")"; then
    log_warn "could not stage the renewal notification payload"
    return 0
  fi
  chmod 600 "$payload_file" 2>/dev/null || true
  if ! conf_file="$(mktemp "${TMPDIR:-/tmp}/cms-cert-notify-request.XXXXXX")"; then
    rm -f -- "$payload_file"
    log_warn "could not stage the renewal notification request"
    return 0
  fi
  chmod 600 "$conf_file" 2>/dev/null || true
  # WHY the removal is one statement at the end and not a RETURN trap: a RETURN trap is not
  # scoped to the function that set it, so it fires at some later return with these locals
  # already gone. Every step below is captured into a status rather than returned early, so
  # this is the only exit and the body — which names the host — is never left behind in a
  # directory every local account can write to.
  notify_payload_json "${host}" > "${payload_file}" || build_status=$?
  if (( build_status != 0 )); then
    log_warn "the renewal notification payload could not be built"
  else
    discord_post "${webhook}" "${payload_file}" "${conf_file}" \
      || log_warn "the Discord webhook POST failed"
  fi
  rm -f -- "${payload_file}" "${conf_file}"
}

main() {
  local repo webhook host

  repo="$(repo_root)"
  # WHY the guarded load the backup path uses: .env carries values written for a shell to
  # source, and a checkout without one has nothing to announce rather than a reason to die.
  if [[ -f "${repo}/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "${repo}/.env" 2>/dev/null || true
    set +a
  fi

  webhook="${DISCORD_WEBHOOK_URL:-}"
  if [[ -z "${webhook}" ]]; then
    log_info "no Discord webhook configured — renewal notification skipped"
    return 0
  fi

  host="$(hostname 2>/dev/null || printf 'unknown')"
  send_notification "${webhook}" "${host}"
}

main "$@"
