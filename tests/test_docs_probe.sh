#!/usr/bin/env bash
# Exercises the real check_docs_assets() out of __preflight.sh: /docs is a
# SharedDataMiddleware mount whose entry page can answer while the files it
# references 404, so the check asserts the page and one referenced asset. The
# functions are extracted, not re-declared, so a dropped arm fails here.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
PREFLIGHT="${REPO_ROOT}/scripts/__preflight.sh"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

# Pull one function body out of __preflight.sh by its `name() {` line.
extract_fn() {
  awk -v fn="$1" '$0 == fn "() {" { keep = 1 } keep { print } keep && $0 == "}" { keep = 0 }' "$PREFLIGHT"
}

SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT
DOCS_ROOT="${SANDBOX}/docs"
ENTRY_DIR="${DOCS_ROOT}/cpp"
mkdir -p "$ENTRY_DIR" "${SANDBOX}/config"

# record_result and the stack gate come from __preflight.sh; stub both so only the
# docs logic under test runs.
declare -a RECORDED=()
record_result() { RECORDED+=("$1|$2|$3"); }
stack_includes() { return 0; }
REPO_ROOT="$SANDBOX"

missing=0
for fn in docs_path_from_toml docs_referenced_asset docs_asset_abspath check_docs_assets; do
  body="$(extract_fn "$fn")"
  if [[ -z "$body" ]]; then
    no "${fn}() extracted from __preflight.sh"
    missing=1
    continue
  fi
  # shellcheck disable=SC1090
  eval "$body"
done
[[ $missing -eq 0 ]] || exit 1
ok "docs check functions extracted from __preflight.sh"

write_toml() {
  printf '[contest_web_server]\ndocs_path = "%s"\n' "$1" > "${SANDBOX}/config/cms.toml"
}
write_entry() {
  printf '%s\n' "$1" > "${ENTRY_DIR}/index.html"
}
last_status() {
  local got="${RECORDED[0]:-}"
  got="${got#*|}"
  printf '%s' "${got%%|*}"
}

# 1. entry page + referenced asset present -> PASS
write_toml "$DOCS_ROOT"
write_entry '<link rel="stylesheet" href="book.css">'
: > "${ENTRY_DIR}/book.css"
RECORDED=()
check_docs_assets
if [[ "$(last_status)" == "PASS" ]]; then ok "entry + asset -> PASS"; else no "entry + asset -> PASS (got: ${RECORDED[*]:-<none>})"; fi

# 2. referenced asset removed -> FAIL
rm -f "${ENTRY_DIR}/book.css"
RECORDED=()
check_docs_assets
if [[ "$(last_status)" == "FAIL" ]]; then ok "missing referenced asset -> FAIL"; else no "missing referenced asset -> FAIL (got: ${RECORDED[*]:-<none>})"; fi

# 3. entry page removed -> FAIL
rm -f "${ENTRY_DIR}/index.html"
RECORDED=()
check_docs_assets
if [[ "$(last_status)" == "FAIL" ]]; then ok "missing entry page -> FAIL"; else no "missing entry page -> FAIL (got: ${RECORDED[*]:-<none>})"; fi

# 4. docs_path omitted from the config -> PASS (nothing to serve)
printf '[contest_web_server]\n' > "${SANDBOX}/config/cms.toml"
RECORDED=()
check_docs_assets
if [[ "$(last_status)" == "PASS" ]]; then ok "docs_path unset -> PASS"; else no "docs_path unset -> PASS (got: ${RECORDED[*]:-<none>})"; fi

# 5. root-absolute asset ref resolves from the docs root
write_toml "$DOCS_ROOT"
write_entry '<link rel="stylesheet" href="/cpp/book.css">'
: > "${ENTRY_DIR}/book.css"
RECORDED=()
check_docs_assets
if [[ "$(last_status)" == "PASS" ]]; then ok "root-absolute asset -> PASS"; else no "root-absolute asset -> PASS (got: ${RECORDED[*]:-<none>})"; fi

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
