#!/usr/bin/env bash
# scripts/__security-agent.sh — host-side executor for the admin panel's security queue.
#
# The panel never runs fail2ban or certbot itself: it validates a request, writes it under
# <repo>/.security-agent/queue/, and this script applies it on the host. No field from a
# request is ever handed to a shell — each one is validated here and passed as an argument.
#
# Usage:
#   __security-agent.sh --check                 verify prerequisites and paths
#   __security-agent.sh --run                   process the queue once (timer entry point)
#   __security-agent.sh --state                 print the fail2ban state the panel reads
#   __security-agent.sh --unban JAIL IP         unban immediately, without the queue
#   __security-agent.sh --install-timer         install and start the systemd timer (root)
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
AGENT_DIR="${REPO_ROOT}/.security-agent"
QUEUE_DIR="${AGENT_DIR}/queue"
RESULTS_DIR="${AGENT_DIR}/results"
STATE_FILE="${AGENT_DIR}/fail2ban-state.json"
JAIL_FILE="${REPO_ROOT}/config/fail2ban/jail.d/grader.conf"
UNIT_NAME="cms-security-agent"
JAIL_PATTERN='^[a-z0-9][a-z0-9-]*$'
TICK_SECONDS=30

log() { printf '[security-agent] %s\n' "$*" >&2; }
die() { printf '[security-agent][FAIL] %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '9,13p' "${BASH_SOURCE[0]}"
}

require_python() {
  command -v python3 >/dev/null 2>&1 || die "python3 is required to read the request JSON"
}

require_fail2ban() {
  command -v fail2ban-client >/dev/null 2>&1 || die "fail2ban-client is not installed on this host"
}

known_jail() {
  local jail="$1"
  [[ "${jail}" =~ ${JAIL_PATTERN} ]] || return 1
  [[ -f "${JAIL_FILE}" ]] || return 1
  grep -qxF "[${jail}]" "${JAIL_FILE}"
}

validate_ip() {
  python3 -c 'import ipaddress, sys; ipaddress.ip_address(sys.argv[1])' "$1" >/dev/null 2>&1
}

read_field() {
  python3 -c 'import json, sys; print(json.load(open(sys.argv[1])).get(sys.argv[2]) or "")' "$1" "$2"
}

write_result() {
  local request_id="$1" action="$2" status="$3" message="$4"
  mkdir -p "${RESULTS_DIR}"
  python3 - "${RESULTS_DIR}/${request_id}.json" "${request_id}" "${action}" "${status}" "${message}" <<'PY'
import datetime, json, sys

path, request_id, action, status, message = sys.argv[1:6]
payload = {
    "id": request_id,
    "action": action,
    "status": status,
    "message": message,
    "finishedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
}
with open(path, "w") as handle:
    json.dump(payload, handle, indent=2)
PY
}

write_state() {
  command -v fail2ban-client >/dev/null 2>&1 || { log "fail2ban-client not found — state left untouched"; return 0; }
  python3 - "${STATE_FILE}" "${JAIL_FILE}" <<'PY'
import datetime, json, re, subprocess, sys

state_path, jail_file = sys.argv[1:3]
with open(jail_file) as handle:
    jails = re.findall(r"^\[([A-Za-z0-9_-]+)\]$", handle.read(), re.MULTILINE)
bans = []
for jail in jails:
    completed = subprocess.run(
        ["fail2ban-client", "status", jail],
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    match = re.search(r"Banned IP list:\s*(.*)", completed.stdout)
    if match is None:
        continue
    for ip in match.group(1).split():
        bans.append({"jail": jail, "ip": ip, "bannedAt": None, "expiresAt": None})
payload = {
    "updatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "bans": bans,
}
with open(state_path, "w") as handle:
    json.dump(payload, handle, indent=2)
PY
}

handle_request() {
  local file="$1"
  local request_id action jail ip
  request_id="$(read_field "${file}" id)"
  action="$(read_field "${file}" action)"
  jail="$(read_field "${file}" jail)"
  ip="$(read_field "${file}" ip)"

  if [[ -z "${request_id}" ]]; then
    log "discarding a request without an id"
    rm -f "${file}"
    return 0
  fi

  case "${action}" in
    unban)
      if ! known_jail "${jail}"; then
        write_result "${request_id}" "${action}" failure "unknown jail"
      elif ! validate_ip "${ip}"; then
        write_result "${request_id}" "${action}" failure "invalid ip"
      elif fail2ban-client set "${jail}" unbanip "${ip}" >/dev/null 2>&1; then
        write_result "${request_id}" "${action}" success "unbanned ${ip} from ${jail}"
      else
        write_result "${request_id}" "${action}" failure "fail2ban-client refused the unban"
      fi
      ;;
    renew-certs)
      if bash "${REPO_ROOT}/scripts/__domain.sh" renew >/dev/null 2>&1; then
        write_result "${request_id}" "${action}" success "certificate renewal finished"
      else
        write_result "${request_id}" "${action}" failure "scripts/__domain.sh renew failed"
      fi
      ;;
    *)
      write_result "${request_id}" "${action}" failure "unsupported action"
      ;;
  esac
  rm -f "${file}"
}

process_queue() {
  mkdir -p "${QUEUE_DIR}" "${RESULTS_DIR}"
  shopt -s nullglob
  local file
  for file in "${QUEUE_DIR}"/*.json; do
    handle_request "${file}"
  done
  write_state
}

install_timer() {
  [[ "${EUID}" -eq 0 ]] || die "installing the timer needs root — re-run with sudo"
  require_fail2ban
  local service_file="/etc/systemd/system/${UNIT_NAME}.service"
  local timer_file="/etc/systemd/system/${UNIT_NAME}.timer"
  cat > "${service_file}" <<UNIT
[Unit]
Description=CMS security agent (fail2ban unban queue)
After=network.target

[Service]
Type=oneshot
WorkingDirectory=${REPO_ROOT}
ExecStart=/usr/bin/env bash ${REPO_ROOT}/scripts/__security-agent.sh --run
UNIT
  cat > "${timer_file}" <<UNIT
[Unit]
Description=Run the CMS security agent every ${TICK_SECONDS}s

[Timer]
OnBootSec=30s
OnUnitActiveSec=${TICK_SECONDS}s
Unit=${UNIT_NAME}.service

[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now "${UNIT_NAME}.timer"
  log "installed and started ${UNIT_NAME}.timer"
}

check_prerequisites() {
  require_python
  local missing=()
  command -v fail2ban-client >/dev/null 2>&1 || missing+=("fail2ban-client")
  [[ -f "${JAIL_FILE}" ]] || missing+=("${JAIL_FILE}")
  [[ -w "${REPO_ROOT}" ]] || missing+=("write access to ${REPO_ROOT}")
  if [[ "${#missing[@]}" -gt 0 ]]; then
    local item
    for item in "${missing[@]}"; do log "missing: ${item}"; done
    return 1
  fi
  log "queue: ${QUEUE_DIR}"
  log "state: ${STATE_FILE}"
  log "jail config: ${JAIL_FILE}"
}

main() {
  local mode="${1:---run}"
  case "${mode}" in
    --check)
      check_prerequisites
      ;;
    --run)
      require_python
      process_queue
      ;;
    --state)
      require_python
      write_state
      [[ -f "${STATE_FILE}" ]] || die "no state file: fail2ban-client is unavailable on this host"
      cat "${STATE_FILE}"
      ;;
    --unban)
      local jail="${2:-}" ip="${3:-}"
      [[ -n "${jail}" && -n "${ip}" ]] || die "usage: --unban JAIL IP"
      require_fail2ban
      known_jail "${jail}" || die "unknown jail: ${jail}"
      validate_ip "${ip}" || die "invalid ip: ${ip}"
      fail2ban-client set "${jail}" unbanip "${ip}"
      log "unbanned ${ip} from ${jail}"
      ;;
    --install-timer)
      install_timer
      ;;
    *)
      usage
      exit 2
      ;;
  esac
}

main "$@"
