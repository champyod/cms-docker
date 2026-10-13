#!/usr/bin/env bash
# Exercises the real __nginx-proxy-render.sh body so the ACME challenge location is
# proven present in BOTH vhost branches (:80 and the TLS redirect server), and the
# shared webroot mount is required in both compose files.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
RENDER="${REPO_ROOT}/scripts/__nginx-proxy-render.sh"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

# The render body before the envsubst/exec tail, which needs the container's nginx.
body="$(awk '/^export PROXY_COMMON/ { exit } { print }' "$RENDER")"

[[ -n "$body" ]] \
  && ok "render body extracted from __nginx-proxy-render.sh" \
  || { no "render body extracted from __nginx-proxy-render.sh"; exit 1; }

# Render HTTP_SERVER for both branches; the body reads NGINX_HOST/listen ports unescaped.
render() {
  local enable_tls="$1"
  env ENABLE_TLS="$enable_tls" \
      NGINX_HOST="contest.example.org" \
      CONTEST_LISTEN_PORT="8888" \
      RANKING_LISTEN_PORT="8890" \
      RANKING_AUTH_DIRECTIVES="" \
      FUNNEL_ENABLED="false" \
      SSE_SNIPPET="${REPO_ROOT}/scripts/__nginx_sse.sh" \
      bash -c "${body}
printf '%s' \"\$HTTP_SERVER\""
}

# The funnel gateway in front of the panel: it sources the shared SSE definition, so this
# exercises the real render body with funnel enabled and reads the admin gateway block back.
render_funnel() {
  env FUNNEL_ENABLED="true" \
      NGINX_HOST="contest.example.org" \
      CONTEST_LISTEN_PORT="8888" \
      FUNNEL_REALM="CMS restricted" \
      FUNNEL_PANEL_LISTEN="8892" \
      RANKING_LISTEN_PORT="8890" \
      RANKING_AUTH_DIRECTIVES="" \
      SSE_SNIPPET="${REPO_ROOT}/scripts/__nginx_sse.sh" \
      bash -c "${body}
printf '%s' \"\$FUNNEL_SERVERS\""
}

for enable_tls in true false; do
  out="$(render "$enable_tls")"
  label="ENABLE_TLS=${enable_tls}"

  if printf '%s' "$out" | grep -q 'location /.well-known/acme-challenge/'; then
    ok "${label}: acme-challenge location present"
  else
    no "${label}: acme-challenge location present"
  fi

  if printf '%s' "$out" | grep -q 'root /var/www/certbot'; then
    ok "${label}: serves the shared webroot"
  else
    no "${label}: serves the shared webroot"
  fi

  # The TLS :80 server only redirects, so the location must precede the redirect.
  if [[ "$enable_tls" == "true" ]]; then
    if printf '%s' "$out" | awk '/acme-challenge/{found=1} /return 301/{if(!found) exit 1} END{exit 0}'; then
      ok "${label}: challenge answered before the https redirect"
    else
      no "${label}: challenge answered before the https redirect"
    fi
  fi
done

# The webroot must be mounted into cms-nginx-contest, which lives in the unified
# compose model.
if grep -q -- '- \./config/letsencrypt/www:/var/www/certbot:ro' "${REPO_ROOT}/docker-compose.yml"; then
  ok "docker-compose.yml: webroot mounted into nginx-proxy"
else
  no "docker-compose.yml: webroot mounted into nginx-proxy"
fi

printf '\n== the funnel gateway keeps the panel streams alive ==\n'
# WHY this suite: it already runs the real render body, so the funnel admin gateway is read
# back from it rather than from a copy of the block.
funnel="$(render_funnel)"
if printf '%s' "$funnel" | grep -qF 'location ~ ^/api/((notifications|resources|containers)/stream$|deploy/status/) {'; then
  ok "the funnel gateway carries the SSE location"
else
  no "the funnel gateway carries the SSE location"
fi
if printf '%s' "$funnel" | grep -qF 'proxy_read_timeout 3600s;' \
  && printf '%s' "$funnel" | grep -qF 'proxy_buffering off;'; then
  ok "the SSE location carries the shared directives"
else
  no "the SSE location carries the shared directives"
fi
if grep -qF '${SSE_SNIPPET:-/usr/local/bin/nginx-sse.sh}' "${RENDER}"; then
  ok "the renderer sources the one shared SSE definition"
else
  no "the renderer sources the one shared SSE definition"
fi
if grep -qF -- '- ./scripts/__nginx_sse.sh:/usr/local/bin/nginx-sse.sh:ro' "${REPO_ROOT}/docker-compose.yml"; then
  ok "docker-compose.yml: the shared SSE definition mounted into nginx-proxy"
else
  no "docker-compose.yml: the shared SSE definition mounted into nginx-proxy"
fi

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
