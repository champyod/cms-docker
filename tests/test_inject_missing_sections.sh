#!/usr/bin/env bash
# A value written into a table config/cms.toml does not have must not vanish without a warning.
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${REPO_ROOT}/scripts/__inject_config.sh"
# config/cms.toml is gitignored, so a fresh checkout has only the tracked sample.
SAMPLE="${REPO_ROOT}/config/cms.sample.toml"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

# The regression is a write into a table the config lacks, so the captcha tables are
# stripped; a copy that already had them would only exercise the update path.
new_sandbox() {
  mkdir -p "${1}/config"
  awk '
    /^\[(admin|contest)_web_server\.captcha\]$/ { skip = 1; next }
    /^\[/                                        { skip = 0 }
    !skip                                         { print }
  ' "$SAMPLE" > "${1}/config/cms.toml"
  printf 'POSTGRES_DB=cmsdb\n' > "${1}/.env"
}

parses() {
  python3 -c 'import sys, tomllib; tomllib.load(open(sys.argv[1], "rb"))' "$1" 2>/dev/null
}

new_sandbox "$SANDBOX"

echo "run the real injector with a flag an operator would set"
if ! (cd "$SANDBOX" \
      && CAPTCHA_ENABLED=1 CAPTCHA_PROVIDER=recaptcha \
         CAPTCHA_SITE_KEY=site CAPTCHA_SECRET_KEY=secret \
         LOGIN_RATE_LIMIT_REDIS_ENABLED=1 \
         bash "$SCRIPT" >/dev/null 2>&1); then
  no "the injector ran to completion"
  printf '\n%d passed, %d failed\n' "$pass" "$fail"
  exit 1
fi
ok "the injector ran to completion"

INJECTED="${SANDBOX}/config/cms.toml"

echo "the captcha table exists for both web servers"
for section in admin_web_server contest_web_server; do
  if grep -q "^\[${section}\.captcha\]" "$INJECTED"; then
    ok "[${section}.captcha] is present"
  else
    no "[${section}.captcha] is present"
  fi
done

echo "the values landed inside the table, not merely the header"
if grep -A6 '^\[admin_web_server\.captcha\]' "$INJECTED" | grep -q '^enabled = true'; then
  ok "CAPTCHA_ENABLED=1 reached admin_web_server.captcha"
else
  no "CAPTCHA_ENABLED=1 reached admin_web_server.captcha"
fi

if grep -A6 '^\[contest_web_server\.captcha\]' "$INJECTED" | grep -q '^redis_enabled = true'; then
  ok "LOGIN_RATE_LIMIT_REDIS_ENABLED=1 reached contest_web_server.captcha"
else
  no "LOGIN_RATE_LIMIT_REDIS_ENABLED=1 reached contest_web_server.captcha"
fi

echo "the injected strings are quoted and the file still loads"
for pair in "provider=recaptcha" "site_key=site" "secret_key=secret"; do
  key="${pair%%=*}"
  value="${pair#*=}"
  if grep -A6 '^\[admin_web_server\.captcha\]' "$INJECTED" | grep -qF "${key} = \"${value}\""; then
    ok "${key} is written as a TOML string"
  else
    no "${key} is written as a TOML string"
  fi
done
if parses "$INJECTED"; then
  ok "the injected config parses as TOML"
else
  no "the injected config parses as TOML"
fi

echo "creating a table never duplicated one that already existed"
for section in contest_web_server admin_web_server; do
  count="$(grep -c "^\[${section}\]$" "$INJECTED" || true)"
  if [[ "$count" -eq 1 ]]; then
    ok "[${section}] appears exactly once"
  else
    no "[${section}] appears exactly once (found $count)"
  fi
done

echo "a key that already exists is updated, not appended"
# num_proxies_used lives in two sections by design, so the count is taken inside one.
count="$(awk '/^\[contest_web_server\]$/{inside=1; next} /^\[/{inside=0} inside && /^num_proxies_used = /{n++} END{print n+0}' "$INJECTED")"
if [[ "$count" -eq 1 ]]; then
  ok "num_proxies_used is written once in [contest_web_server]"
else
  no "num_proxies_used is written once in [contest_web_server] (found $count)"
fi

echo "the injector checks the file it just wrote"
# Every case below runs the real injector in its own sandbox, so a fault in one
# cannot leak into the next and none of them can reach the repository's own
# config/cms.toml.
REAL_PYTHON="$(command -v python3)"

# A stand-in for the writer under test: the real interpreter runs first, and this
# then produces the defect a broken writer produces — a bare, unquoted value the
# loader refuses, or a file that is gone. Which writer is targeted is decided by
# the payload itself rather than by a line number, so the stub survives any edit
# to the injector that moves a write.
stub_python() {
  mkdir -p "${1}/bin"
  cat >"${1}/bin/python3" <<'SH'
#!/usr/bin/env bash
payload="$(cat)"
status=0
"${CMS_TEST_PYTHON}" "$@" <<<"${payload}" || status=$?
if [[ "${status}" -eq 0 && "${payload}" == *'p.write_text(t)'* && "${payload}" == *'Worker = '* ]]; then
  case "${CMS_TEST_FAULT}" in
    malformed) printf 'site_key = 0x4AAAA-broken\n' >> config/cms.toml ;;
    removed)   rm -f config/cms.toml ;;
  esac
fi
exit "${status}"
SH
  chmod +x "${1}/bin/python3"
}

run_injector() {
  CASE_OUT="$(cd "$1" && PATH="${1}/bin:${PATH}" \
    CMS_TEST_PYTHON="${REAL_PYTHON}" CMS_TEST_FAULT="${2:-none}" \
    bash "$SCRIPT" 2>&1)"
  CASE_RC=$?
  printf '%s\n' "$CASE_OUT" > "${1}/injector.out"
}

CLEAN="${SANDBOX}/clean"
new_sandbox "$CLEAN"
run_injector "$CLEAN"
if [[ "$CASE_RC" -eq 0 ]] && parses "${CLEAN}/config/cms.toml"; then
  ok "a clean run ends with a config that still parses"
else
  no "a clean run ends with a config that still parses (exit ${CASE_RC})"
fi
if [[ "$CASE_OUT" != *"[FAIL]"* ]]; then
  ok "a clean run reports no failure"
else
  no "a clean run reports no failure"
fi

MALFORMED="${SANDBOX}/malformed-write"
new_sandbox "$MALFORMED"
# WORKER_N makes the injector reach its final writer, which is the one stubbed.
printf 'WORKER_1=10.0.0.9:2222\n' >> "${MALFORMED}/.env"
stub_python "$MALFORMED"
run_injector "$MALFORMED" malformed
if [[ "$CASE_RC" -ne 0 ]]; then
  ok "a writer that emits malformed TOML ends the injector non-zero"
else
  no "a writer that emits malformed TOML ends the injector non-zero"
fi
if [[ "$CASE_OUT" == *"[FAIL]"* && "$CASE_OUT" =~ [Ll]ine\ [0-9]+ ]]; then
  ok "the failure names the parse error and the line it is on"
else
  no "the failure names the parse error and the line it is on"
fi
if [[ "$CASE_OUT" == *"Configuration injection complete."* ]]; then
  no "an aborted run does not claim completion"
else
  ok "an aborted run does not claim completion"
fi

PRE_BROKEN="${SANDBOX}/already-broken"
new_sandbox "$PRE_BROKEN"
printf 'broken = [1, 2\n' >> "${PRE_BROKEN}/config/cms.toml"
run_injector "$PRE_BROKEN"
if [[ "$CASE_RC" -eq 0 ]]; then
  ok "a config that already failed to parse does not abort the run"
else
  no "a config that already failed to parse does not abort the run (exit ${CASE_RC})"
fi
if [[ "$CASE_OUT" == *"[WARN]"* && "$CASE_OUT" == *"already did not parse"* ]]; then
  ok "pre-existing breakage is reported as a warning"
else
  no "pre-existing breakage is reported as a warning"
fi

GONE="${SANDBOX}/removed"
new_sandbox "$GONE"
printf 'WORKER_1=10.0.0.9:2222\n' >> "${GONE}/.env"
stub_python "$GONE"
run_injector "$GONE" removed
if [[ "$CASE_RC" -eq 0 ]]; then
  ok "a run whose config is gone at the end exits 0"
else
  no "a run whose config is gone at the end exits 0 (exit ${CASE_RC})"
fi
if [[ "$CASE_OUT" != *"[WARN]"* && "$CASE_OUT" != *"[FAIL]"* ]]; then
  ok "an absent config raises no warning"
else
  no "an absent config raises no warning"
fi

# --- the testcase-copy switch, which CMS read but no config key could set ----

# contest_web_server holds both copy switches, so a bare grep cannot tell them
# apart; this reads a key out of that one section and nowhere else.
contest_value() {
  awk -v key="$1" '
    /^\[contest_web_server\]$/ { inside=1; next }
    /^\[/                      { inside=0 }
    inside && $0 ~ "^" key " = " { sub("^" key " = ", ""); print; exit }
  ' "$2"
}

echo "TESTS_LOCAL_COPY reaches cms.toml as contest_web_server.tests_local_copy"
COPY_SANDBOX="${SANDBOX}/local-copy"
new_sandbox "$COPY_SANDBOX"
if (cd "$COPY_SANDBOX" && TESTS_LOCAL_COPY=false bash "$SCRIPT" >/dev/null 2>&1); then
  ok "the injector ran with TESTS_LOCAL_COPY set"
else
  no "the injector ran with TESTS_LOCAL_COPY set"
fi
COPY_TOML="${COPY_SANDBOX}/config/cms.toml"
if [[ "$(contest_value tests_local_copy "$COPY_TOML")" == "false" ]]; then
  ok "an operator-set false reached contest_web_server.tests_local_copy"
else
  no "an operator-set false reached contest_web_server.tests_local_copy (found '$(contest_value tests_local_copy "$COPY_TOML")')"
fi

echo "the submission-copy switch still resolves as it did"
if [[ "$(contest_value submit_local_copy "$COPY_TOML")" == "true" ]]; then
  ok "submit_local_copy keeps its shipped default when unset"
else
  no "submit_local_copy keeps its shipped default when unset (found '$(contest_value submit_local_copy "$COPY_TOML")')"
fi

echo "the two copy switches do not collide"
if [[ "$(contest_value tests_local_copy "$COPY_TOML")" != "$(contest_value submit_local_copy "$COPY_TOML")" ]]; then
  ok "setting one copy switch leaves the other alone"
else
  no "setting one copy switch leaves the other alone (both '$(contest_value submit_local_copy "$COPY_TOML")')"
fi
for key in submit_local_copy tests_local_copy; do
  count="$(awk -v key="$key" '/^\[contest_web_server\]$/{inside=1; next} /^\[/{inside=0} inside && $0 ~ "^" key " = "{n++} END{print n+0}' "$COPY_TOML")"
  if [[ "$count" -eq 1 ]]; then
    ok "${key} is written once in [contest_web_server]"
  else
    no "${key} is written once in [contest_web_server] (found $count)"
  fi
done

echo "an unset TESTS_LOCAL_COPY leaves the shipped default alone"
DEFAULT_SANDBOX="${SANDBOX}/local-copy-default"
new_sandbox "$DEFAULT_SANDBOX"
if (cd "$DEFAULT_SANDBOX" && bash "$SCRIPT" >/dev/null 2>&1) \
   && [[ "$(contest_value tests_local_copy "${DEFAULT_SANDBOX}/config/cms.toml")" == "true" ]]; then
  ok "tests_local_copy stays true when the operator configures nothing"
else
  no "tests_local_copy stays true when the operator configures nothing"
fi

# --- propagate_generated: make env and the injector must share one process ---

# Pull a function out of the engine by name rather than by line number, so an
# edit that moves it does not silently reduce this to a test of nothing.
extract_function() {
  awk -v fn="$1" '
    $0 ~ "^" fn "\\(\\) \\{" { inside=1 }
    inside                   { print }
    inside && /^}$/          { exit }
  ' "$REPO_ROOT/scripts/__update_engine.sh"
}

echo "propagate_generated carries a .env value into cms.toml"
PROP="${SANDBOX}/propagate"
new_sandbox "$PROP"
mkdir -p "${PROP}/scripts"
cp "$SCRIPT" "${PROP}/scripts/__inject_config.sh"
# The injector sources its logger out of scripts/__lib; without it the run dies
# on a missing file and the propagation is never reached.
cp -R "${REPO_ROOT}/scripts/__lib" "${PROP}/scripts/__lib"
# Stands in for `make env`: rewriting .env is the whole contract, and the value
# differs from the shipped default so only a real propagation can produce it.
cat >"${PROP}/Makefile" <<'MK'
env:
	@printf 'SUBMIT_LOCAL_COPY=false\n' > .env
MK
{
  printf 'set -eu\nDRY_RUN=false\nprint_warning(){ echo "[!] $1"; }\n'
  extract_function run_or_print
  extract_function propagate_generated
  printf 'propagate_generated\n'
} >"${PROP}/engine_excerpt.sh"

if (cd "$PROP" && bash engine_excerpt.sh >"${PROP}/propagate.out" 2>&1); then
  ok "propagate_generated ran to completion"
else
  no "propagate_generated ran to completion"
fi
if [[ "$(contest_value submit_local_copy "${PROP}/config/cms.toml")" == "false" ]]; then
  ok "a value written by make env reached cms.toml through the engine"
else
  no "a value written by make env reached cms.toml through the engine (found '$(contest_value submit_local_copy "${PROP}/config/cms.toml")')"
fi
if grep -qi "warn\|error\|fail" "${PROP}/propagate.out"; then
  no "propagate_generated neither warned nor failed on the happy path"
else
  ok "propagate_generated neither warned nor failed on the happy path"
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
