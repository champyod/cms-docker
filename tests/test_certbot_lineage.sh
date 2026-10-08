#!/usr/bin/env bash
# Exercises the certbot entrypoint's lineage out of the compose file. The lineage is
# the directory certbot writes and nginx reads, so it must fall back to
# CERT_LINEAGE_DOMAIN first and then to the same domain chain __domain.sh uses, and
# certbot must be told it explicitly with --cert-name.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
COMPOSE="${REPO_ROOT}/docker-compose.domain.yml"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

# The certbot entrypoint as one unescaped line ($$ -> $).
entrypoint="$(awk '
  /^  certbot:/ { svc = 1 }
  svc && /^    entrypoint: >/ { ep = 1; next }
  ep && /^      / { print; next }
  ep { exit }
' "$COMPOSE" | sed -e 's/^      //' | tr '\n' ' ' | sed 's/\$\$/\$/g')"

lineage_line="$(printf '%s' "$entrypoint" | grep -o 'LINEAGE="[^"]*"' | head -1)"

[[ -n "$lineage_line" ]] \
  && ok "lineage assignment extracted" \
  || { no "lineage assignment extracted"; exit 1; }

# Evaluate LINEAGE under one env combination and echo the result.
lineage_for() {
  env -i \
    CERT_LINEAGE_DOMAIN="${1:-}" DOMAIN_NAME="${2:-}" ADMIN_DOMAIN="${3:-}" \
    OJ_DOMAIN="${4:-}" RANKING_DOMAIN="${5:-}" \
    sh -c "${lineage_line}
printf '%s' \"\$LINEAGE\""
}

# The cases mirror scripts/__domain.sh: explicit lineage wins, else the first domain set.
while IFS='|' read -r want lineage domain admin oj ranking; do
  got="$(lineage_for "$lineage" "$domain" "$admin" "$oj" "$ranking")"
  if [[ "$got" == "$want" ]]; then
    ok "lineage: '${got}'"
  else
    no "lineage: want '${want}', got '${got}'"
  fi
done <<'CASES'
explicit.example.org|explicit.example.org|x.example.org||||
x.example.org||x.example.org||||
a.example.org|||a.example.org|||
r.example.org|||||r.example.org|
||||||
CASES

# certbot must be handed the lineage explicitly, or it names the directory after the
# first -d and a set CERT_LINEAGE_DOMAIN would be ignored.
if printf '%s' "$entrypoint" | grep -qF -- '--cert-name "$LINEAGE"'; then
  ok "certonly pins --cert-name to the lineage"
else
  no "certonly pins --cert-name to the lineage"
fi

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
