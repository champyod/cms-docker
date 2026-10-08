#!/usr/bin/env bash
# Exercises the real grader-nginx-proxy entrypoint out of docker-compose.domain.yml:
# it must sign a stand-in certificate into the lineage directory when none exists, and
# skip it when one does. The path prefix is sandboxed and openssl/nginx/apk are stubbed;
# the LINEAGE computation, the conditional and the exec are the real code.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
COMPOSE="${REPO_ROOT}/docker-compose.domain.yml"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT
LE_ROOT="${SANDBOX}/letsencrypt"
mkdir -p "${SANDBOX}/bin" "${LE_ROOT}"

OPENSSL_LOG="${SANDBOX}/openssl.log"
NGINX_LOG="${SANDBOX}/nginx.log"
APK_LOG="${SANDBOX}/apk.log"

# Stub openssl: record the call; for `req`, create the -keyout/-out files.
cat > "${SANDBOX}/bin/openssl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${OPENSSL_LOG:-/dev/null}"
keyout=""
out=""
prev=""
for arg in "$@"; do
  case "$prev" in
    -keyout) keyout="$arg" ;;
    -out) out="$arg" ;;
  esac
  prev="$arg"
done
if [[ "$1" == "req" ]]; then
  [[ -n "$keyout" ]] && : > "$keyout"
  [[ -n "$out" ]] && : > "$out"
fi
exit 0
STUB

# Stub nginx: record the invocation, succeed.
cat > "${SANDBOX}/bin/nginx" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${NGINX_LOG:-/dev/null}"
exit 0
STUB

# Stub apk: must never be reached while the openssl stub is on PATH.
cat > "${SANDBOX}/bin/apk" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${APK_LOG:-/dev/null}"
exit 0
STUB
chmod +x "${SANDBOX}/bin/openssl" "${SANDBOX}/bin/nginx" "${SANDBOX}/bin/apk"

# Fold and unescape the entrypoint, redirecting /etc/letsencrypt into the sandbox.
entrypoint="$(awk '
  /^  grader-nginx-proxy:/ { svc = 1 }
  svc && /^    entrypoint: >/ { ep = 1; next }
  ep && /^      / { print; next }
  ep { exit }
' "$COMPOSE" \
  | sed -e 's/^      //' \
  | tr '\n' ' ' \
  | sed -e 's/\$\$/\$/g' -e 's|/etc/letsencrypt|'"${LE_ROOT}"'/letsencrypt|g')"

[[ -n "$entrypoint" ]] \
  && ok "grader-nginx-proxy entrypoint extracted" \
  || { no "grader-nginx-proxy entrypoint extracted"; exit 1; }

run_entrypoint() {
  local cle="$1" dn="$2" ad="$3" od="$4" rd="$5"
  : > "$OPENSSL_LOG"
  : > "$NGINX_LOG"
  : > "$APK_LOG"
  env -i PATH="${SANDBOX}/bin:/usr/bin:/bin" \
    CERT_LINEAGE_DOMAIN="$cle" DOMAIN_NAME="$dn" ADMIN_DOMAIN="$ad" \
    OJ_DOMAIN="$od" RANKING_DOMAIN="$rd" \
    OPENSSL_LOG="$OPENSSL_LOG" NGINX_LOG="$NGINX_LOG" APK_LOG="$APK_LOG" \
    /bin/sh -c "$entrypoint"
}

# A: no cert yet -> sign the stand-in into the lineage, start nginx.
run_entrypoint "" "grader.example.org" "" "" ""
if grep -q -- "-keyout ${LE_ROOT}/letsencrypt/live/grader.example.org/privkey.pem" "$OPENSSL_LOG" \
   && grep -q -- "-out ${LE_ROOT}/letsencrypt/live/grader.example.org/fullchain.pem" "$OPENSSL_LOG"; then
  ok "no cert: stand-in signed into the lineage directory"
else
  no "no cert: stand-in signed into the lineage directory"
fi
if grep -q "daemon off" "$NGINX_LOG"; then
  ok "no cert: nginx started"
else
  no "no cert: nginx started"
fi
if [[ ! -s "$APK_LOG" ]]; then
  ok "no cert: apk not needed (openssl present)"
else
  no "no cert: apk not needed (openssl present)"
fi

# B: certificate already exists -> no openssl call, nginx starts.
run_entrypoint "" "grader.example.org" "" "" ""
if [[ ! -s "$OPENSSL_LOG" ]]; then
  ok "cert present: no stand-in attempt"
else
  no "cert present: no stand-in attempt (got: $(head -n1 "$OPENSSL_LOG"))"
fi
if grep -q "daemon off" "$NGINX_LOG"; then
  ok "cert present: nginx started"
else
  no "cert present: nginx started"
fi

# C: CERT_LINEAGE_DOMAIN wins, then DOMAIN_NAME, then ADMIN_DOMAIN.
run_entrypoint "explicit.example.org" "grader.example.org" "" "" ""
if grep -q -- "${LE_ROOT}/letsencrypt/live/explicit.example.org/" "$OPENSSL_LOG"; then
  ok "lineage: CERT_LINEAGE_DOMAIN wins"
else
  no "lineage: CERT_LINEAGE_DOMAIN wins"
fi
run_entrypoint "" "" "admin.example.org" "" ""
if grep -q -- "${LE_ROOT}/letsencrypt/live/admin.example.org/" "$OPENSSL_LOG"; then
  ok "lineage: falls back to ADMIN_DOMAIN"
else
  no "lineage: falls back to ADMIN_DOMAIN"
fi

# D: no domain configured -> nothing signed, nginx still starts.
run_entrypoint "" "" "" "" ""
if [[ ! -s "$OPENSSL_LOG" ]] && grep -q "daemon off" "$NGINX_LOG"; then
  ok "no domain: nothing signed, nginx started"
else
  no "no domain: nothing signed, nginx started"
fi

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
