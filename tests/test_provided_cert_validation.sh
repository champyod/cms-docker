#!/usr/bin/env bash
# The `provided` path: an externally-issued certificate must be checked before it becomes
# the one nginx serves, and must land in the single layout the proxy reads.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
DOMAIN="${REPO_ROOT}/scripts/__domain.sh"
# shellcheck source=__lib/domain_sandbox.sh
source "${SCRIPT_DIR}/__lib/domain_sandbox.sh"

pass=0
fail=0

ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

trap domain_sandbox_cleanup EXIT

# The shared sandbox plus a material directory, and a docker stub that records each call
# whole so `nginx -t` and `nginx -s reload` stay told apart.
sandbox() {
  local dir
  dir="$(domain_sandbox)"
  mkdir -p "${dir}/material"
  cat > "${dir}/bin/docker" <<'STUB'
#!/usr/bin/env bash
case "${1:-}" in
  ps) printf '%s\n' 'grader-nginx-proxy' ;;
  *) printf '%s\n' "$*" >> "${DOCKER_LOG}" ;;
esac
exit 0
STUB
  chmod +x "${dir}/bin/docker"
  printf '%s' "${dir}"
}

# A self-signed certificate and its key. `covers` is the name in the SAN, so a
# certificate that verifies perfectly can still be asked to cover a name it never had.
material() {
  local dir="$1" covers="$2" label="${3:-cert}"
  local cert="${dir}/material/${label}.pem" key="${dir}/material/${label}-key.pem"
  openssl req -x509 -nodes -days 30 -newkey rsa:2048 \
    -keyout "$key" -out "$cert" \
    -subj "/CN=${covers}" -addext "subjectAltName=DNS:${covers}" 2>/dev/null
  chmod 600 "$key"
  printf '%s %s' "$cert" "$key"
}

run_setup() {
  local dir="$1"
  shift
  export DOCKER_LOG="${dir}/docker.log"
  : > "$DOCKER_LOG"
  PATH="${dir}/bin:${PATH}" bash "${dir}/scripts/__domain.sh" setup \
    --domain example.org --email ops@example.org "$@" 2>&1
}

docker_log() {
  cat "${1}/docker.log" 2>/dev/null
}

echo "a certificate that checks out is installed where the proxy looks"
dir="$(sandbox)"
read -r CERT_KEY <<<"$(material "$dir" example.org good)"
CERT="${CERT_KEY% *}"; KEY="${CERT_KEY#* }"
out="$(run_setup "$dir" --cert provided --cert-path "$CERT" --key-path "$KEY" --apply)"
status=$?
if [[ "$status" -eq 0 ]] && grep -qF -- "provided certificates installed" <<<"$out"; then
  ok "the import succeeds"
else
  no "the import succeeds (status $status: $out)"
fi
dest="${dir}/config/letsencrypt/live/example.org"
if [[ -f "${dest}/fullchain.pem" && -f "${dest}/privkey.pem" ]]; then
  ok "both files land in live/<lineage>/"
else
  no "both files land in live/<lineage>/"
fi
if [[ "$(cat "${dest}/fullchain.pem" 2>/dev/null)" == "$(cat "$CERT")" ]]; then
  ok "the installed certificate is the one supplied"
else
  no "the installed certificate is the one supplied"
fi
if grep -qF -- "private key matches the certificate" <<<"$out"; then
  ok "the key match is checked and reported"
else
  no "the key match is checked and reported"
fi
if grep -qF -- "certificate covers every configured domain" <<<"$out"; then
  ok "hostname coverage is checked and reported"
else
  no "hostname coverage is checked and reported"
fi

echo "a key that belongs to another certificate is refused"
dir="$(sandbox)"
read -r CERT_KEY <<<"$(material "$dir" example.org good)"
CERT="${CERT_KEY% *}"; KEY="${CERT_KEY#* }"
read -r OTHER_KEY <<<"$(material "$dir" example.org other)"
OTHER="${OTHER_KEY#* }"
out="$(run_setup "$dir" --cert provided --cert-path "$CERT" --key-path "$OTHER" --apply)"
status=$?
if [[ "$status" -ne 0 ]] && grep -qF -- "is not the private key for" <<<"$out"; then
  ok "a mismatched key fails the run"
else
  no "a mismatched key fails the run (status $status)"
fi
if [[ -f "${dir}/config/letsencrypt/live/example.org/fullchain.pem" ]]; then
  no "nothing is installed"
else
  ok "nothing is installed"
fi

echo "a certificate that does not cover a configured name says which"
dir="$(sandbox)"
read -r CERT_KEY <<<"$(material "$dir" other.example.org lone)"
CERT="${CERT_KEY% *}"; KEY="${CERT_KEY#* }"
out="$(run_setup "$dir" --cert provided --cert-path "$CERT" --key-path "$KEY" --apply)"
if grep -qF -- "certificate does not cover: example.org" <<<"$out"; then
  ok "the uncovered name is named"
else
  no "the uncovered name is named (got: $out)"
fi

echo "the legacy flat store is moved into the lineage rather than left beside it"
dir="$(sandbox)"
mkdir -p "${dir}/config/letsencrypt/live"
printf 'FLAT CERT\n' > "${dir}/config/letsencrypt/live/fullchain.pem"
printf 'FLAT KEY\n' > "${dir}/config/letsencrypt/live/privkey.pem"
read -r CERT_KEY <<<"$(material "$dir" example.org good)"
CERT="${CERT_KEY% *}"; KEY="${CERT_KEY#* }"
out="$(run_setup "$dir" --cert provided --cert-path "$CERT" --key-path "$KEY" --apply)"
if [[ -e "${dir}/config/letsencrypt/live/fullchain.pem" ]]; then
  no "the flat copy is removed"
else
  ok "the flat copy is removed"
fi
if [[ -f "${dir}/config/letsencrypt/live/example.org/fullchain.pem" ]]; then
  ok "the lineage holds the certificate"
else
  no "the lineage holds the certificate"
fi
if grep -qF -- "moved the legacy flat certificate into" <<<"$out"; then
  ok "the migration is reported"
else
  no "the migration is reported"
fi

echo "reload follows the verb that owns nginx"
dir="$(sandbox)"
read -r CERT_KEY <<<"$(material "$dir" example.org good)"
CERT="${CERT_KEY% *}"; KEY="${CERT_KEY#* }"
out="$(run_setup "$dir" --cert provided --cert-path "$CERT" --key-path "$KEY" --apply)"
if docker_log "$dir" | grep -qF -- "nginx -s reload"; then
  ok "setup reloads so the new certificate is served"
else
  no "setup reloads so the new certificate is served"
fi

dir="$(sandbox)"
read -r CERT_KEY <<<"$(material "$dir" example.org good)"
CERT="${CERT_KEY% *}"; KEY="${CERT_KEY#* }"
export DOCKER_LOG="${dir}/docker.log"
: > "$DOCKER_LOG"
out="$(PATH="${dir}/bin:${PATH}" bash "${dir}/scripts/__domain.sh" cert \
  --domain example.org --email ops@example.org \
  --cert provided --cert-path "$CERT" --key-path "$KEY" --apply 2>&1)"
if docker_log "$dir" | grep -qF -- "nginx -s reload"; then
  no "cert leaves nginx alone as it promises"
else
  ok "cert leaves nginx alone as it promises"
fi

printf '\n%s passed, %s failed\n' "$pass" "$fail"
(( fail == 0 ))
