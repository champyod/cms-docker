#!/usr/bin/env bash
# The proxy body size was a literal in nine places across three files with no config key,
# so the admin vhost capped at 10M while the admin panel accepts 51MB on the wire: a 10-51MB
# testcase batch died at nginx as a bare 413 and the panel's own explanation never rendered.
# These assert the limit is one configured value end to end.
#
# WHY the envsubst allowlist assertion is the sharpest one here: __domain.sh substitutes an
# explicit name list, so a variable missing from it expands to nothing and the directive
# renders as `client_max_body_size ;` — nginx then refuses to start. That is a site-down
# failure, not a misbehaving one, so it is asserted against the real allowlist rather than
# assumed.
#
# WHY no docker and no built panel: both halves of this contract are configuration. The real
# template is rendered through the real allowlist with envsubst, and the panel module is
# imported directly when bun is present — no stack, no image, no daemon.
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
GRADER_TEMPLATE="${REPO_ROOT}/config/grader.nginx.conf.template"
FUNNEL_TEMPLATE="${REPO_ROOT}/config/funnel-mirror.nginx.conf.template"
RENDER_SH="${REPO_ROOT}/scripts/__nginx-proxy-render.sh"
DOMAIN_SH="${REPO_ROOT}/scripts/__domain.sh"
UPDATE_ENGINE="${REPO_ROOT}/scripts/__update_engine.sh"
PREFLIGHT="${REPO_ROOT}/scripts/__preflight.sh"
PANEL_LIMITS="${REPO_ROOT}/admin-panel/src/lib/testcase-limits.ts"

VAR='${PROXY_MAX_BODY_SIZE}'
# The form used inside the single-quoted shell blocks of __nginx-proxy-render.sh, which a
# sed pass resolves after envsubst has inserted the block text verbatim.
SENTINEL='@PROXY_MAX_BODY_SIZE@'
# WHY 100M: it is the oj vhost's limit today, and it is the only single value that breaks
# nothing. 10M would silently cut the external judge from 100M to 10M; anything above 100M
# raises the ceiling past the largest limit the proxy has ever enforced.
PROXY_DEFAULT='100M'
PANEL_DEFAULT_BYTES=52428800

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

WORK=""
cleanup() { [[ -n "${WORK}" ]] && rm -rf "${WORK}"; }
trap cleanup EXIT
WORK="$(mktemp -d "${TMPDIR:-/tmp}/proxy-body-size.XXXXXX")"

# Fixed-string counts. -F matters: the directive is `client_max_body_size ${PROXY_MAX_BODY_SIZE};`
# and a regex reading of it would have to escape the brace pair on every call.
count_fixed() {
  local file="$1" needle="$2" hits
  hits="$(grep -cF -- "${needle}" "${file}" 2>/dev/null || true)"
  printf '%s' "${hits:-0}"
}

echo "every client_max_body_size directive reads the configured variable"
directives_use_variable() {
  local file="$1" label="$2" expected="$3" total bound
  total="$(count_fixed "${file}" 'client_max_body_size')"
  # WHY both forms count as bound: a directive envsubst expands reads ${VAR}, while one
  # inside a single-quoted shell block that is substituted afterwards has to carry the
  # @SENTINEL@ form — envsubst never revisits text it has already inserted, so ${VAR}
  # there would reach nginx unexpanded. Either way the number is a variable, not a literal.
  bound=$(( $(count_fixed "${file}" "client_max_body_size ${VAR};") + $(count_fixed "${file}" "client_max_body_size ${SENTINEL};") ))
  if [[ "${total}" -eq "${expected}" ]]; then
    ok "${label} declares ${expected} body-size directives"
  else
    no "${label} declares ${expected} body-size directives (found ${total})"
  fi
  if [[ "${bound}" -eq "${expected}" ]]; then
    ok "${label} binds all ${expected} to the variable"
  else
    no "${label} binds all ${expected} to the variable (${bound} do)"
  fi
}
directives_use_variable "${GRADER_TEMPLATE}" "the grader template" 4
directives_use_variable "${FUNNEL_TEMPLATE}" "the funnel template" 3
directives_use_variable "${RENDER_SH}" "the contest proxy renderer" 2

echo "__domain.sh declares a fallback and lets the name through envsubst"
default_line="$(grep -F 'PROXY_MAX_BODY_SIZE="${PROXY_MAX_BODY_SIZE:-' "${DOMAIN_SH}" | head -1 || true)"
if [[ -n "${default_line}" ]]; then
  ok "__domain.sh declares a PROXY_MAX_BODY_SIZE default"
else
  no "__domain.sh declares a PROXY_MAX_BODY_SIZE default"
fi
if [[ "${default_line}" == *"-${PROXY_DEFAULT}}"* ]]; then
  ok "the fallback is ${PROXY_DEFAULT}, the oj vhost's current limit"
else
  no "the fallback is ${PROXY_DEFAULT}, the oj vhost's current limit (got: ${default_line})"
fi

# WHY the single envsubst invocation is located rather than assumed: the allowlist is the
# site-down guard, and reading whichever invocation is actually there is what proves the
# live renderer was given the name.
allowlist="$(grep -oE "envsubst '[^']*'" "${DOMAIN_SH}" | head -1 | sed -e "s/^envsubst '//" -e "s/'$//" || true)"
if [[ "${allowlist}" == *"${VAR}"* ]]; then
  ok "the envsubst allowlist carries ${VAR}"
else
  no "the envsubst allowlist carries ${VAR} — nginx would refuse to start (allowlist: ${allowlist})"
fi

echo "the key is registered so config.toml can set it"
if grep -qE '^[[:space:]]*"[^"]*\|\[infra\]\|PROXY_MAX_BODY_SIZE\|[^|]*\|[^|]*\|[^"]*"$' "${UPDATE_ENGINE}"; then
  ok "__update_engine.sh registers PROXY_MAX_BODY_SIZE under [infra]"
else
  no "__update_engine.sh registers PROXY_MAX_BODY_SIZE under [infra]"
fi
# WHY the optional trailing fields: a row is "Group|[section]|KEY|type|placeholder|default",
# and the placeholder is often empty — the shipped WAF_PORT row reads `|port||8080`, so the
# pattern has to allow the empty field between the type and the default.
if grep -qF "\"Infra & Monitoring|[infra]|PROXY_MAX_BODY_SIZE|" "${UPDATE_ENGINE}" \
  && grep -qE "\|${PROXY_DEFAULT}\"$" <<<"$(grep 'PROXY_MAX_BODY_SIZE' "${UPDATE_ENGINE}")"; then
  ok "the registered default is ${PROXY_DEFAULT}"
else
  no "the registered default is ${PROXY_DEFAULT}"
fi
if grep -qE '^PROXY_MAX_BODY_SIZE' "${REPO_ROOT}/config.toml.example"; then
  ok "config.toml.example documents PROXY_MAX_BODY_SIZE"
else
  no "config.toml.example documents PROXY_MAX_BODY_SIZE"
fi

echo "the rendered config is what nginx will read"
render_template() {
  local template="$1" limit="$2" out="$3"
  PROXY_MAX_BODY_SIZE="${limit}" envsubst "${allowlist}" < "${template}" > "${out}" 2>/dev/null
}
render_template "${GRADER_TEMPLATE}" '77M' "${WORK}/grader.conf"
if [[ "$(count_fixed "${WORK}/grader.conf" "client_max_body_size 77M;")" -eq 4 ]]; then
  ok "the grader template renders the configured limit into all four vhosts"
else
  no "the grader template renders the configured limit into all four vhosts (got: $(grep -F 'client_max_body_size' "${WORK}/grader.conf" | tr '\n' ' '))"
fi
if grep -qF 'client_max_body_size ;' "${WORK}/grader.conf"; then
  no "no directive renders with an empty value"
else
  ok "no directive renders with an empty value"
fi
render_template "${FUNNEL_TEMPLATE}" '77M' "${WORK}/funnel.conf"
if [[ "$(count_fixed "${WORK}/funnel.conf" "client_max_body_size 77M;")" -eq 3 ]]; then
  ok "the funnel template renders the configured limit into all three gateways"
else
  no "the funnel template renders the configured limit into all three gateways"
fi

echo "an unset key still renders a limit"
# WHY the fallback is read from __domain.sh rather than restated here: the renderer only ever
# sees a non-empty value because __domain.sh resolves the default before envsubst runs, so
# the declared line is what stands between an unset key and a blanked directive.
fallback_value="$(
  unset PROXY_MAX_BODY_SIZE
  # shellcheck disable=SC1090
  eval "${default_line}" 2>/dev/null
  printf '%s' "${PROXY_MAX_BODY_SIZE:-}"
)"
if [[ "${fallback_value}" == "${PROXY_DEFAULT}" ]]; then
  ok "the declared fallback evaluates to ${PROXY_DEFAULT}"
else
  no "the declared fallback evaluates to ${PROXY_DEFAULT} (got: ${fallback_value})"
fi
render_template "${GRADER_TEMPLATE}" "${fallback_value}" "${WORK}/grader-fallback.conf"
if [[ "$(count_fixed "${WORK}/grader-fallback.conf" "client_max_body_size ${PROXY_DEFAULT};")" -eq 4 ]]; then
  ok "the fallback reaches every rendered vhost"
else
  no "the fallback reaches every rendered vhost (got: $(grep -F 'client_max_body_size' "${WORK}/grader-fallback.conf" | tr '\n' ' '))"
fi
# WHY assert that an empty value does blank the directive: without this the neighbouring
# assertion passes for the wrong reason. It is the exact site-down failure — nginx refuses
# to start on `client_max_body_size ;` — and it is what the fallback above rules out.
render_template "${GRADER_TEMPLATE}" '' "${WORK}/grader-empty.conf"
if grep -qF 'client_max_body_size ;' "${WORK}/grader-empty.conf"; then
  ok "an empty value is confirmed to blank the directive — the fallback is what prevents it"
else
  no "an empty value blanks the directive; the check above proves nothing"
fi

echo "the contest proxy renderer expands the same value"
# WHY the sentinel rather than ${PROXY_MAX_BODY_SIZE} inside the blocks: PROXY_COMMON and
# PROXY_ADMIN_PANEL are single-quoted so nginx's own $host and $scheme survive the shell,
# which means envsubst expands them to text and never revisits what it just inserted. A
# ${PROXY_MAX_BODY_SIZE} in there reaches nginx as a literal and it refuses to start, so
# the value is substituted by the same sed pass that already resolves @FUNNEL_REALM@.
# WHY the range ends at the last block rather than the first blank line: PROXY_COMMON and
# PROXY_ADMIN_PANEL are separated by a blank line, so stopping at the first one would
# capture only the first and the second would silently never be asserted.
sed -n '/^PROXY_COMMON=/,/^export /p' "${RENDER_SH}" | sed '$d' > "${WORK}/render-head.sh"
render_renderer() {
  local limit="$1" out="$2"
  # WHY the value is resolved inside the child and passed to sed as $1: the sed script is
  # itself expanded by THIS shell, where PROXY_MAX_BODY_SIZE is unset — an inline
  # ${PROXY_MAX_BODY_SIZE} there replaces the sentinel with the empty string and the
  # rendered directive comes out blank, which is the very failure under test.
  PROXY_MAX_BODY_SIZE="${limit}" sh -c "
    export PROXY_MAX_BODY_SIZE=\"\${PROXY_MAX_BODY_SIZE:-100M}\"
    . '${WORK}/render-head.sh'
    printf '%s\n%s' \"\${PROXY_COMMON}\" \"\${PROXY_ADMIN_PANEL}\"
  " 2>/dev/null | sed -e "s|@PROXY_MAX_BODY_SIZE@|${limit:-100M}|g" > "${out}"
}
render_renderer '77M' "${WORK}/render-blocks.txt"
if [[ "$(count_fixed "${WORK}/render-blocks.txt" "client_max_body_size 77M;")" -eq 2 ]]; then
  ok "both proxy blocks render the configured limit"
else
  no "both proxy blocks render the configured limit (got: $(grep -F 'client_max_body_size' "${WORK}/render-blocks.txt" | tr '\n' ' '))"
fi
if grep -qF '${PROXY_MAX_BODY_SIZE}' "${WORK}/render-blocks.txt"; then
  no "no unsubstituted variable survives into the rendered blocks"
else
  ok "no unsubstituted variable survives into the rendered blocks"
fi
# WHY the sentinel itself must be gone from the rendered file: an nginx directive reading
# @PROXY_MAX_BODY_SIZE@ is as broken as one reading ${...}, since neither is a size.
if grep -qF '@PROXY_MAX_BODY_SIZE@' "${WORK}/render-blocks.txt"; then
  no "the sentinel is fully resolved, not passed through to nginx"
else
  ok "the sentinel is fully resolved, not passed through to nginx"
fi
# WHY the render script must carry the sentinel on its envsubst line.
if grep -qE 'sed .*@PROXY_MAX_BODY_SIZE@' "${RENDER_SH}"; then
  ok "the renderer substitutes the sentinel"
else
  no "the renderer substitutes the sentinel"
fi
render_renderer '' "${WORK}/render-blocks-unset.txt"
if grep -qF 'client_max_body_size ;' "${WORK}/render-blocks-unset.txt"; then
  no "an unset key does not blank the renderer's directive"
else
  ok "an unset key does not blank the renderer's directive"
fi
if sh -n "${RENDER_SH}" 2>/dev/null; then
  ok "the renderer is still valid POSIX sh"
else
  no "the renderer is still valid POSIX sh"
fi

echo "the panel cap reads env and never yields NaN"
panel_cap_bytes() {
  local raw="$1"
  PANEL_LIMITS_PATH="${PANEL_LIMITS}" PANEL_RAW="${raw}" bun -e '
    if (process.env.PANEL_RAW !== "__UNSET__") process.env.MAX_TESTCASE_UPLOAD_BYTES = process.env.PANEL_RAW;
    const mod = await import(process.env.PANEL_LIMITS_PATH);
    console.log(String(mod.MAX_TESTCASE_UPLOAD_BYTES));
  ' 2>/dev/null
}
if command -v bun >/dev/null 2>&1; then
  ok "bun is available, so the panel module is imported directly"
  if [[ "$(panel_cap_bytes '__UNSET__')" == "${PANEL_DEFAULT_BYTES}" ]]; then
    ok "an unset env value falls back to ${PANEL_DEFAULT_BYTES}"
  else
    no "an unset env value falls back to ${PANEL_DEFAULT_BYTES} (got: $(panel_cap_bytes '__UNSET__'))"
  fi
  if [[ "$(panel_cap_bytes '104857600')" == '104857600' ]]; then
    ok "a valid env value is honoured"
  else
    no "a valid env value is honoured (got: $(panel_cap_bytes '104857600'))"
  fi
  for bad in '' 'abc' '0' '-5' '1e9999' 'true'; do
    if [[ "$(panel_cap_bytes "${bad}")" == "${PANEL_DEFAULT_BYTES}" ]]; then
      ok "'${bad}' falls back to ${PANEL_DEFAULT_BYTES}"
    else
      no "'${bad}' falls back to ${PANEL_DEFAULT_BYTES} (got: $(panel_cap_bytes "${bad}"))"
    fi
  done
else
  no "bun is available, so the panel module is imported directly"
fi
if grep -qF 'process.env.MAX_TESTCASE_UPLOAD_BYTES' "${PANEL_LIMITS}"; then
  ok "the panel cap reads MAX_TESTCASE_UPLOAD_BYTES from env"
else
  no "the panel cap reads MAX_TESTCASE_UPLOAD_BYTES from env"
fi
for export_name in MAX_BULK_TESTCASES MAX_TESTCASE_FILE_BYTES MULTIPART_OVERHEAD_BYTES formatByteLimit isRequestBodyTooLarge; do
  if grep -qE "export (const|function) ${export_name}\b" "${PANEL_LIMITS}"; then
    ok "${export_name} is still exported"
  else
    no "${export_name} is still exported"
  fi
done

echo "preflight compares the proxy limit against the panel cap"
# WHY the functions are lifted out and driven directly: __preflight.sh runs its whole check
# suite at source time, so the comparison logic is exercised here instead of being read.
# record_result is replaced by a recording stub, and the WARN_COUNT it maintains is declared
# here, because the real one is part of the script's global state that this harness does
# not run.
awk '
  /^(nginx_size_to_bytes|check_proxy_body_size)\(\) \{/ { grab = 1 }
  grab { print }
  grab && /^}$/ { grab = 0; print "" }
' "${PREFLIGHT}" > "${WORK}/preflight-fns.sh"
{
  printf 'WARN_COUNT=0\n'
  printf 'record_result() { printf "%%s | %%s | %%s\\n" "$1" "$2" "$3"; [[ "$2" == "WARN" ]] && WARN_COUNT=$((WARN_COUNT+1)); return 0; }\n'
  cat "${WORK}/preflight-fns.sh"
} > "${WORK}/preflight-fns.sh.tmp" && mv "${WORK}/preflight-fns.sh.tmp" "${WORK}/preflight-fns.sh"
if grep -qF 'check_proxy_body_size()' "${WORK}/preflight-fns.sh"; then
  ok "preflight defines check_proxy_body_size"
else
  no "preflight defines check_proxy_body_size"
fi
if grep -qE '^check_proxy_body_size$' "${PREFLIGHT}"; then
  ok "check_proxy_body_size is registered in the call list"
else
  no "check_proxy_body_size is registered in the call list"
fi

drive_preflight() {
  local proxy="$1" panel="$2" out="$3"
  (
    # shellcheck disable=SC1090
    . "${WORK}/preflight-fns.sh"
    REPO_ROOT="${REPO_ROOT}"
    PROXY_MAX_BODY_SIZE="${proxy}"
    MAX_TESTCASE_UPLOAD_BYTES="${panel}"
    check_proxy_body_size
  ) > "${out}" 2>&1
}
drive_preflight '100M' "${PANEL_DEFAULT_BYTES}" "${WORK}/preflight-pass.txt"
if grep -q 'proxy body size.*PASS' "${WORK}/preflight-pass.txt"; then
  ok "a proxy limit above the panel cap passes"
else
  no "a proxy limit above the panel cap passes (got: $(tr '\n' ' ' < "${WORK}/preflight-pass.txt"))"
fi
if grep -q 'proxy body size.*WARN' "${WORK}/preflight-pass.txt"; then
  no "a proxy limit above the panel cap does not warn"
else
  ok "a proxy limit above the panel cap does not warn"
fi
drive_preflight '10M' "${PANEL_DEFAULT_BYTES}" "${WORK}/preflight-warn.txt"
if grep -q 'proxy body size.*WARN' "${WORK}/preflight-warn.txt"; then
  ok "a proxy limit below the panel cap warns — this is the bare-413 state"
else
  no "a proxy limit below the panel cap warns (got: $(tr '\n' ' ' < "${WORK}/preflight-warn.txt"))"
fi
drive_preflight '10M' "${PANEL_DEFAULT_BYTES}" "${WORK}/preflight-fail.txt"
if grep -q 'proxy body size.*FAIL' "${WORK}/preflight-fail.txt"; then
  no "a proxy limit below the panel cap warns instead of failing"
else
  ok "a proxy limit below the panel cap warns instead of failing"
fi
drive_preflight 'garbage' "${PANEL_DEFAULT_BYTES}" "${WORK}/preflight-garbage.txt"
if grep -qE 'proxy body size.*(PASS|WARN)' "${WORK}/preflight-garbage.txt"; then
  ok "an unparseable proxy limit is reported rather than aborting the run"
else
  no "an unparseable proxy limit is reported rather than aborting the run (got: $(tr '\n' ' ' < "${WORK}/preflight-garbage.txt"))"
fi
drive_preflight '' '' "${WORK}/preflight-empty.txt"
if grep -qE 'proxy body size.*(PASS|WARN)' "${WORK}/preflight-empty.txt"; then
  ok "an absent config falls back to the declared defaults"
else
  no "an absent config falls back to the declared defaults (got: $(tr '\n' ' ' < "${WORK}/preflight-empty.txt"))"
fi

echo "every setting the panel reads is one an operator can actually set"
# WHY this assertion exists: MAX_TESTCASE_UPLOAD_BYTES was read from process.env by the
# panel while nothing put it in the container, so the cap was not configurable at all and
# the unit test above still passed — it exercised the resolver, not the delivery. Three
# more settings were in the same state (BACKUP_LOCATIONS, BACKUP_DEFAULT_LOCATION
# unregistered, MONITOR_ENHANCED registered but never passed through). The failure mode is
# silent in both directions: a value the operator sets that the panel never sees, and a
# setting the panel advertises that no config.toml key fills.
#
# WHY NODE_ENV is exempt: the panel Dockerfile sets it (ENV NODE_ENV=production) and
# compose has no business overriding a value the image already fixes.
panel_env_vars="$(grep -rhoE 'process\.env\.[A-Z_][A-Z0-9_]*' "${REPO_ROOT}/admin-panel/src" \
  | sed 's/process\.env\.//' | sort -u)"
for var in ${panel_env_vars}; do
  [[ "${var}" == "NODE_ENV" ]] && continue
  if grep -qE "^[[:space:]]*${var}:" "${REPO_ROOT}/docker-compose.yml"; then
    ok "${var} reaches the panel container"
  else
    no "${var} is read by the panel but never put in the container"
  fi
done

# WHY registered as well as delivered: a value compose passes through but no config.toml
# key writes can only be set by hand-editing .env, which the next config sync discards.
#
# WHY the section is not named here: BACKUP_LOCATIONS and BACKUP_DEFAULT_LOCATION already
# lived in [backup] with working defaults, and asserting [admin] here would have demanded
# a second registration of a key that already had one — which is a duplicate key in
# config.toml and the exact failure the TOML write gate was added to catch. Any section is
# correct so long as there is exactly one.
for var in MAX_TESTCASE_UPLOAD_BYTES BACKUP_LOCATIONS BACKUP_DEFAULT_LOCATION; do
  if grep -qE "\|\[[a-z_]+\]\|${var}\|" "${UPDATE_ENGINE}"; then
    ok "${var} is registered under some section"
  else
    no "${var} is delivered to the panel but no [admin] key writes it"
  fi
  if grep -qE "^[[:space:]]*${var}[[:space:]]*=" "${REPO_ROOT}/config.toml.example"; then
    ok "${var} is documented in config.toml.example"
  else
    no "${var} is registered but not documented in config.toml.example"
  fi
done

# WHY BACKUP_DIR is checked for the volume, not just the env: the panel reading a path it
# cannot resolve reports an empty archive tree rather than an error, so a missing mount is
# indistinguishable from a machine with no backups.
panel_block="$(awk '/^  admin-panel-next:/,/^  admin-web-server:/' "${REPO_ROOT}/docker-compose.yml")"
for var in BACKUP_DIR BACKUP_LOCATIONS BACKUP_DEFAULT_LOCATION MAX_TESTCASE_UPLOAD_BYTES; do
  # WHY the block is captured once rather than piped per variable: grep -q closes the pipe
  # on its first match, which kills awk with SIGPIPE, and the pipeline status then reflects
  # awk rather than grep — so a variable that IS set reports as absent depending on where
  # it falls in the block.
  if grep -qE "^[[:space:]]*${var}:" <<<"${panel_block}"; then
    ok "${var} is set on the admin-panel-next service"
  else
    no "${var} is not set on admin-panel-next"
  fi
done
if grep -qE '^[[:space:]]*- \./backups:/app/backups' "${REPO_ROOT}/docker-compose.yml"; then
  ok "the panel mounts the archive tree at the path BACKUP_DIR names"
else
  no "the panel has no ./backups:/app/backups mount, so BACKUP_DIR resolves to nothing"
fi

printf '\n%d passed, %d failed\n' "${pass}" "${fail}"
(( fail == 0 ))