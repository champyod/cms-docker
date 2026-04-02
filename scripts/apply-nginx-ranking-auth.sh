#!/usr/bin/env bash
set -euo pipefail

# apply-nginx-ranking-auth.sh
# Create or update an htpasswd for the ranking UI and enable nginx basic auth
# by writing a docker-compose.override.yml and restarting the nginx-proxy service.
# Usage: ./scripts/apply-nginx-ranking-auth.sh [username]

USERNAME=${1:-rankingadmin}
HTPASS_PATH=./config/htpasswd_rws
OVERRIDE_FILE=docker-compose.override.yml

echo "Apply Nginx ranking auth: user=${USERNAME}"

mkdir -p ./config

if ! command -v htpasswd >/dev/null 2>&1; then
  echo "Error: htpasswd not found. Install apache2-utils (Debian/Ubuntu) or httpd-tools (RHEL/CentOS)." >&2
  exit 1
fi

if [ -f "$HTPASS_PATH" ]; then
  echo "Updating existing htpasswd: $HTPASS_PATH"
  htpasswd "$HTPASS_PATH" "$USERNAME"
else
  echo "Creating new htpasswd: $HTPASS_PATH"
  htpasswd -c "$HTPASS_PATH" "$USERNAME"
fi

cat > "$OVERRIDE_FILE" <<'YAML'
services:
  nginx-proxy:
    environment:
      RANKING_AUTH_DIRECTIVES: 'auth_basic "Restricted"; auth_basic_user_file /etc/nginx/htpasswd_RWS;'
    volumes:
      - ./config/htpasswd_rws:/etc/nginx/htpasswd_RWS:ro
YAML

echo "Wrote $OVERRIDE_FILE (docker-compose override)."

echo "Bringing up nginx-proxy with override (profile: nginx)..."

# Prefer the contest compose file if present
COMPOSE_FILE=docker-compose.contest.yml
if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Warning: $COMPOSE_FILE not found in $(pwd). Trying default docker-compose.yml"
  if [ ! -f docker-compose.yml ]; then
    echo "Error: no docker-compose file found (looked for $COMPOSE_FILE and docker-compose.yml)." >&2
    exit 2
  else
    COMPOSE_FILE=docker-compose.yml
  fi
fi

# Use the override if present
OVERRIDE_FILE=docker-compose.override.yml
if [ -f "$OVERRIDE_FILE" ]; then
  docker compose -f "$COMPOSE_FILE" -f "$OVERRIDE_FILE" --profile nginx up -d nginx-proxy
else
  docker compose -f "$COMPOSE_FILE" --profile nginx up -d nginx-proxy
fi

echo "Done. Test with: curl -i -u ${USERNAME} https://<host>/ranking/"
