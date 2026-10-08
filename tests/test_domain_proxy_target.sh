#!/usr/bin/env bash
# tests/test_domain_proxy_target.sh — the domain proxy, by exact container name.
#
# WHY this exists: __domain.sh picked the nginx container with `docker ps | grep nginx
# | head -1`, which matched the contest front door (cms-nginx-contest) instead of the
# domain stack's grader-nginx-proxy. The nginx -t and the reload then ran against the
# wrong container, so a stale upstream IP in grader-nginx-proxy survived a
# `domain proxy --apply`. This drives the real script with a docker stub that lists the
# contest container FIRST, which is the ordering that used to pick the wrong one.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
DOMAIN="${REPO_ROOT}/scripts/__domain.sh"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

SANDBOXES=()
cleanup() { rm -rf "${SANDBOXES[@]+"${SANDBOXES[@]}"}"; }
trap cleanup EXIT

# A copy of the script with only what it sources, so a run can never write to the repo.
sandbox() {
  local dir
  dir="$(mktemp -d)"
  SANDBOXES+=("${dir}")
  mkdir -p "${dir}/scripts" "${dir}/bin"
  cp "${DOMAIN}" "${dir}/scripts/"
  while read -r sourced; do
    [[ -e "${REPO_ROOT}/scripts/${sourced}" ]] || continue
    mkdir -p "${dir}/scripts/$(dirname "${sourced}")"
    cp -r "${REPO_ROOT}/scripts/${sourced}" "${dir}/scripts/${sourced}"
  done < <(grep -oE 'source "[^"]+"' "${DOMAIN}" | cut -d/ -f2- | tr -d '"' | sort -u)
  cp "${REPO_ROOT}/config.toml.example" "${dir}/config.toml"
  # Logs every call; `ps` lists the contest front door first, the order that used to win.
  cat > "${dir}/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${DOCKER_CALLS:?}"
if [[ "${1:-}" == "ps" ]]; then
  printf '%s\n' cms-nginx-contest
  printf '%s\n' grader-nginx-proxy
fi
exit 0
STUB
  printf '#!/bin/bash\nexit 0\n' > "${dir}/bin/certbot"
  chmod +x "${dir}/bin"/*
  printf '%s' "${dir}"
}

run_proxy() { # <sandbox> <calls-log>
  local dir="$1" calls="$2"
  PATH="${dir}/bin:${PATH}" DOCKER_CALLS="${calls}" \
    bash "${dir}/scripts/__domain.sh" proxy --apply \
      --domain example.org --email ops@example.org 2>&1
}

printf '\n== proxy --apply drives the domain proxy, not the contest front door ==\n'
dir="$(sandbox)"
calls="${dir}/docker.calls"
out="$(run_proxy "${dir}" "${calls}")"
rc=$?
if [[ "$rc" -eq 0 ]]; then ok "proxy --apply exits 0"; else no "proxy --apply exits 0"; printf '%s\n' "$out" | tail -5; fi

exec_calls="$(grep '^exec ' "${calls}" 2>/dev/null || true)"
if grep -q 'exec grader-nginx-proxy nginx -t' <<< "${exec_calls}"; then
  ok "nginx -t ran in grader-nginx-proxy"
else
  no "nginx -t ran in grader-nginx-proxy"
fi
if grep -q 'exec grader-nginx-proxy nginx -s reload' <<< "${exec_calls}"; then
  ok "nginx -s reload ran in grader-nginx-proxy"
else
  no "nginx -s reload ran in grader-nginx-proxy"
fi
if grep -q 'cms-nginx-contest' <<< "${exec_calls}"; then
  no "the contest front door was never exec'd"
else
  ok "the contest front door was never exec'd"
fi

printf '\n== a box with no domain proxy is not a failure ==\n'
dir2="$(sandbox)"
sed -i '/grader-nginx-proxy/d' "${dir2}/bin/docker"
calls2="${dir2}/docker.calls"
out2="$(run_proxy "${dir2}" "${calls2}")"
rc2=$?
if [[ "$rc2" -eq 0 ]]; then ok "proxy --apply without a domain proxy exits 0"; else no "proxy --apply without a domain proxy exits 0"; printf '%s\n' "$out2" | tail -5; fi
if grep -q '^exec ' "${calls2}" 2>/dev/null; then
  no "nothing is exec'd when no domain proxy runs"
else
  ok "nothing is exec'd when no domain proxy runs"
fi

printf '\n== summary ==\n'
printf 'PASS: %d  FAIL: %d\n' "$pass" "$fail"
if [[ "$fail" -ne 0 ]]; then exit 1; fi
printf 'ALL PASS\n'
