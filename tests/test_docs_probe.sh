#!/usr/bin/env bash
# Exercises the real docs arm of __preflight.sh, extracted rather than re-declared so a
# dropped arm fails here. /docs is a SharedDataMiddleware mount whose entry page can
# answer while the files it references 404, docs_path is container-internal so the host
# often cannot read the tree at all, and a root-absolute ref resolves against the SITE
# root rather than the docs root. Missing docs must never be a hard failure: an update
# that aborts over them is the regression this locks out.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
PREFLIGHT="${REPO_ROOT}/scripts/__preflight.sh"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

# Pull one function body out of a script by its `name() {` line.
extract_fn() {
  awk -v fn="$1" '$0 == fn "() {" { keep = 1 } keep { print } keep && $0 == "}" { keep = 0 }' "$2"
}

SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT
DOCS_ROOT="${SANDBOX}/docs"
CONFIG="${SANDBOX}/config/cms.toml"
mkdir -p "${DOCS_ROOT}/cpp" "${SANDBOX}/config"

# record_result and the stack gate come from __preflight.sh; stub both so only the docs
# logic under test runs. FAIL is counted exactly as the real script counts it.
declare -a RECORDED=()
HARD_FAILS=0
record_result() {
  RECORDED+=("$1|$2|$3")
  [[ "$2" == "FAIL" ]] && HARD_FAILS=$((HARD_FAILS + 1))
  return 0
}
stack_includes() { return 0; }
REPO_ROOT="$SANDBOX"
STACK="contest"
CONTEST_PORT_EXTERNAL=1

missing=0
for fn in docs_path_from_toml docs_language_from_toml docs_language docs_referenced_asset \
          docs_asset_url_path check_docs_served check_docs_on_disk check_docs_assets; do
  body="$(extract_fn "$fn" "$PREFLIGHT")"
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

# Drive the served arm deterministically: "down" is an unreachable contest server, the
# normal case for preflight. The probe URLs land in a file because a command
# substitution would otherwise drop every variable the probe sets.
HTTP_MODE="down"
SERVED_ENTRY=""
PROBED_LOG="${SANDBOX}/probed-urls"
: > "$PROBED_LOG"
docs_http_code() {
  printf '%s\n' "$1" >> "$PROBED_LOG"
  case "$HTTP_MODE" in
    serving)   printf '200' ;;
    entry-404) printf '404' ;;
    *)         printf '000' ;;
  esac
}
docs_http_body() { printf '%s\n' "$SERVED_ENTRY"; }
probed_url() { sed -n "${1}p" "$PROBED_LOG"; }
probed_all() { tr '\n' ' ' < "$PROBED_LOG"; }

write_toml() {
  printf '[contest_web_server]\ndocs_path = "%s"\n' "$DOCS_ROOT" > "$CONFIG"
  if [[ -n "${1:-}" ]]; then
    printf 'docs_language = "%s"\n' "$1" >> "$CONFIG"
  fi
}
write_entry() { printf '%s\n' "$2" > "${DOCS_ROOT}/${1}/index.html"; }
last_status() {
  local got="${RECORDED[0]:-}"
  got="${got#*|}"
  printf '%s' "${got%%|*}"
}
reset() { HTTP_MODE="$1"; : > "$PROBED_LOG"; RECORDED=(); HARD_FAILS=0; }

# 1. entry page + relative asset on disk -> PASS
write_toml
write_entry cpp '<link rel="stylesheet" href="book.css">'
: > "${DOCS_ROOT}/cpp/book.css"
reset down
check_docs_assets
if [[ "$(last_status)" == "PASS" ]]; then ok "entry + asset on disk -> PASS"; else no "entry + asset on disk -> PASS (got: ${RECORDED[*]:-<none>})"; fi

# 2. referenced asset removed -> WARN, no hard failure
rm -f "${DOCS_ROOT}/cpp/book.css"
reset down
check_docs_assets
if [[ "$(last_status)" == "WARN" && $HARD_FAILS -eq 0 ]]; then ok "missing asset -> WARN, run not aborted"; else no "missing asset -> WARN (got: ${RECORDED[*]:-<none>}, hard=${HARD_FAILS})"; fi

# 3. entry page removed while the language is configured -> WARN, no hard failure
rm -f "${DOCS_ROOT}/cpp/index.html"
write_toml cpp
reset down
check_docs_assets
if [[ "$(last_status)" == "WARN" && $HARD_FAILS -eq 0 ]]; then ok "missing entry -> WARN, run not aborted"; else no "missing entry -> WARN (got: ${RECORDED[*]:-<none>}, hard=${HARD_FAILS})"; fi

# 4. docs_path omitted from the config -> PASS (nothing to serve)
printf '[contest_web_server]\n' > "$CONFIG"
reset down
check_docs_assets
if [[ "$(last_status)" == "PASS" ]]; then ok "docs_path unset -> PASS"; else no "docs_path unset -> PASS (got: ${RECORDED[*]:-<none>})"; fi

# 5. served entry + relative ref -> PASS, probed under the /docs base path
write_toml
write_entry cpp '<link rel="stylesheet" href="book.css">'
SERVED_ENTRY='<link rel="stylesheet" href="book.css">'
reset serving
check_docs_assets
if [[ "$(last_status)" == "PASS" && "$(probed_url 1)" == "http://127.0.0.1:1/docs/cpp/index.html" \
      && "$(probed_url 2)" == "http://127.0.0.1:1/docs/cpp/book.css" ]]; then
  ok "served entry + relative ref -> PASS at the /docs base path"
else
  no "served entry + relative ref (status: $(last_status), probed: $(probed_all))"
fi

# 6. served entry with a root-absolute ref -> PASS, probed at the SITE root
SERVED_ENTRY='<link rel="stylesheet" href="/cpp/book.css">'
reset serving
check_docs_assets
if [[ "$(last_status)" == "PASS" && "$(probed_url 2)" == "http://127.0.0.1:1/cpp/book.css" ]]; then
  ok "root-absolute ref resolves against the site root"
else
  no "root-absolute ref resolution (status: $(last_status), probed: $(probed_all))"
fi

# 7. docs_language from config wins over the folder name, and no other language is probed
mkdir -p "${DOCS_ROOT}/java"
write_entry java '<link rel="stylesheet" href="book.css">'
write_toml java
SERVED_ENTRY='<link rel="stylesheet" href="book.css">'
reset serving
check_docs_assets
if [[ "$(probed_url 1)" == "http://127.0.0.1:1/docs/java/index.html" && "$(probed_all)" != *"/docs/cpp/"* ]]; then
  ok "language folder comes from config"
else
  no "language folder from config (probed: $(probed_all))"
fi

# 8. no docs_language in config -> the tree's own folder is followed, not a literal
rm -rf "${DOCS_ROOT}/cpp"
write_toml
reset serving
check_docs_assets
if [[ "$(probed_url 1)" == "http://127.0.0.1:1/docs/java/index.html" ]]; then
  ok "language folder discovered from the docs tree"
else
  no "language folder from the docs tree (probed: $(probed_all))"
fi

# 9. served, but the entry page 404s -> WARN, no hard failure
write_toml cpp
reset entry-404
check_docs_assets
if [[ "$(last_status)" == "WARN" && $HARD_FAILS -eq 0 ]]; then ok "served 404 -> WARN, run not aborted"; else no "served 404 -> WARN (got: ${RECORDED[*]:-<none>}, hard=${HARD_FAILS})"; fi

# 10. the resolution rule itself
if [[ "$(docs_asset_url_path java book.css)" == "/docs/java/book.css" \
      && "$(docs_asset_url_path java /cpp/book.css)" == "/cpp/book.css" ]]; then
  ok "docs_asset_url_path: relative -> docs base, absolute -> site root"
else
  no "docs_asset_url_path branches"
fi

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
