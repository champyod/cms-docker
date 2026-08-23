#!/bin/sh
# Renders nginx contest-proxy config from nginx-contest.conf template.
# ENABLE_TLS=true  -> port 80 redirect + TLS :443 server (certs expected at
#                     /etc/nginx/ssl/cert.pem|key.pem or a traefik resolver)
# otherwise        -> plain HTTP :80 server proxying to CWS.
set -eu

PROXY_COMMON='
    client_max_body_size 10M;
    client_body_buffer_size 128k;
    proxy_connect_timeout 90;
    proxy_send_timeout 90;
    proxy_read_timeout 90;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;'

RANKING_AUTH="${RANKING_AUTH_DIRECTIVES:-}"

if [ "${ENABLE_TLS:-false}" = "true" ]; then
  HTTP_SERVER="
server {
    listen 80;
    server_name ${NGINX_HOST};
    return 301 https://\$host\$request_uri;
}
server {
    listen 443 ssl http2;
    server_name ${NGINX_HOST};
    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
$PROXY_COMMON
    location / {
        proxy_pass http://cms_contest;
        proxy_redirect off;
    }
    location /ranking/ {
        $RANKING_AUTH
        proxy_pass http://cms-proxy-service:28600/;
        proxy_redirect off;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \"upgrade\";
        proxy_buffering off;
    }
    location /ws {
        proxy_pass http://cms_contest;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \"upgrade\";
    }
    location ~* \.(jpg|jpeg|png|gif|ico|css|js)\$ {
        proxy_pass http://cms_contest;
        expires 1d;
        add_header Cache-Control \"public, immutable\";
    }
    access_log /var/log/nginx/cms_contest_access.log;
    error_log /var/log/nginx/cms_contest_error.log;
}"
else
  HTTP_SERVER="
server {
    listen 80 default_server;
    server_name ${NGINX_HOST};
$PROXY_COMMON
    location / {
        proxy_pass http://cms_contest;
        proxy_redirect off;
    }
    location /ranking/ {
        $RANKING_AUTH
        proxy_pass http://cms-proxy-service:28600/;
        proxy_redirect off;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \"upgrade\";
        proxy_buffering off;
    }
    location /ws {
        proxy_pass http://cms_contest;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \"upgrade\";
    }
    location ~* \.(jpg|jpeg|png|gif|ico|css|js)\$ {
        proxy_pass http://cms_contest;
        expires 1d;
        add_header Cache-Control \"public, immutable\";
    }
    access_log /var/log/nginx/cms_contest_access.log;
    error_log /var/log/nginx/cms_contest_error.log;
}"
fi

export PROXY_COMMON HTTP_SERVER
envsubst '${CONTEST_LISTEN_PORT} ${PROXY_COMMON} ${HTTP_SERVER}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
