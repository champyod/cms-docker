#!/bin/bash
set -e

# Generate ranking configuration
echo "Generating ranking configuration..."
mkdir -p /opt/cms/config

cat > /opt/cms/config/cms_ranking.toml <<EOF
bind_address = "${CMS_RANKING_BIND_ADDRESS}"
http_port = ${CMS_RANKING_HTTP_PORT}

username = "${CMS_RANKING_USERNAME}"
password = "${CMS_RANKING_PASSWORD}"
realm_name = "${CMS_RANKING_REALM}"

buffer_size = ${CMS_RANKING_BUFFER_SIZE}

log_dir = "${CMS_RANKING_LOG_DIR}"
lib_dir = "${CMS_RANKING_LIB_DIR}"

[public]
show_id_column = false
EOF

# Create required directories
mkdir -p "${CMS_RANKING_LOG_DIR}" "${CMS_RANKING_LIB_DIR}"

# Start ranking server
echo "Starting CMS Ranking Web Server..."
exec cmsRankingWebServer --config /opt/cms/config/cms_ranking.toml
