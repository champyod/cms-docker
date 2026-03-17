#!/bin/bash
set -e

# Define files
ENV_FILE=".env.core"
CONFIG_FILE="config/cms.toml"
RANKING_CONFIG_FILE="config/cms_ranking.toml"

echo "Running configuration injection script..."

if [ ! -f "$ENV_FILE" ]; then
    echo "Error: $ENV_FILE not found."
    exit 1
fi

if [ ! -f "$CONFIG_FILE" ]; then
    echo "Error: $CONFIG_FILE not found."
    exit 1
fi

if [ ! -f "$RANKING_CONFIG_FILE" ]; then
    echo "Error: $RANKING_CONFIG_FILE not found."
    exit 1
fi

# Function to get value from env file
get_env_val() {
    grep "^$1=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '\r'
}

# Read variables
DB_USER=$(get_env_val "POSTGRES_USER")
DB_PASS=$(get_env_val "POSTGRES_PASSWORD")
DB_NAME=$(get_env_val "POSTGRES_DB")
DB_HOST=$(get_env_val "POSTGRES_HOST")
DB_PORT=$(get_env_val "POSTGRES_PORT")
CMS_SECRET=$(get_env_val "CMS_SECRET_KEY")
TAILSCALE_IP=$(get_env_val "TAILSCALE_IP")
CORE_SERVICES_IP=$(get_env_val "CORE_SERVICES_IP")

# Default values if missing
DB_USER=${DB_USER:-cmsuser}
DB_PASS=${DB_PASS:-your_password_here}
DB_NAME=${DB_NAME:-cmsdb}
DB_HOST=${DB_HOST:-database}
DB_PORT=${DB_PORT:-5432}

# Safely escape special characters for sed: | & \ /
# We use | as delimiter, so we escape | and \
SAFE_PASS=$(echo "$DB_PASS" | sed 's/\\/\\\\/g' | sed 's/|/\\|/g' | sed 's/&/\\&/g')
echo "Injecting configuration:"
echo "  - DB Host: $DB_HOST:$DB_PORT"
echo "  - DB User: $DB_USER"
echo "  - DB Name: $DB_NAME"

# Perform replacements using | as delimiter
sed -i "s|your_password_here|$SAFE_PASS|g" "$CONFIG_FILE"
sed -i "s|cmsuser|$DB_USER|g" "$CONFIG_FILE"
sed -i "s|cmsdb|$DB_NAME|g" "$CONFIG_FILE"
sed -i "s|database:5432|$DB_HOST:$DB_PORT|g" "$CONFIG_FILE"

if [ -n "$CMS_SECRET" ]; then
    echo "  - Injecting CMS config secret_key..."
    sed -i "s/secret_key = \".*\"/secret_key = \"$CMS_SECRET\"/g" "$CONFIG_FILE"
fi

# Ensure all web servers listen on all interfaces inside the container
# NOTE: We do NOT replace container service names with Tailscale IP here;
# extra_hosts in docker-compose files handles routing to CORE_SERVICES_IP.
sed -i 's/"127.0.0.1"/"0.0.0.0"/g' "$CONFIG_FILE"
sed -i 's/\["127.0.0.1"\]/\["0.0.0.0"\]/g' "$CONFIG_FILE"

# Handle Ranking Scoreboard Auth
# We check environment variables which are populated by 'make env'
R_USER=${RANKING_USERNAME:-usern4me}
R_PASS=${RANKING_PASSWORD:-passw0rd}
# Escape username/password for sed
SAFE_R_USER=$(echo "$R_USER" | sed 's/\\/\\\\/g' | sed 's/|/\\|/g' | sed 's/&/\\&/g')
# Escape password for sed
SAFE_R_PASS=$(echo "$R_PASS" | sed 's/\\/\\\\/g' | sed 's/|/\\|/g' | sed 's/&/\\&/g')

echo "Injecting Ranking credentials..."
sed -i "s|usern4me:passw0rd|$R_USER:$SAFE_R_PASS|g" "$CONFIG_FILE"
sed -i "s|^username = \".*\"|username = \"$SAFE_R_USER\"|g" "$RANKING_CONFIG_FILE"
sed -i "s|^password = \".*\"|password = \"$SAFE_R_PASS\"|g" "$RANKING_CONFIG_FILE"

# Build Worker array from WORKER_N environment variables
echo "Building worker configuration..."
WORKER_ARRAY=""
WORKER_COUNT=0

while IFS='=' read -r key value; do
    case "$key" in
        WORKER_[0-9]*)
            worker_index=$(echo "$key" | sed 's/WORKER_//')
            worker_host=$(echo "$value" | cut -d ':' -f1)
            worker_port=$(echo "$value" | cut -d ':' -f2)

            if [ -z "$worker_host" ] || [ -z "$worker_port" ]; then
                echo "  - Skipping invalid $key=$value"
                continue
            fi

            case "$worker_port" in
                ''|*[!0-9]*)
                    echo "  - Skipping invalid port in $key=$value"
                    continue
                    ;;
            esac

            if [ -z "$WORKER_ARRAY" ]; then
                WORKER_ARRAY="[\"$worker_host\", $worker_port]"
            else
                WORKER_ARRAY=$(printf "%s,\n    [\"%s\", %s]" "$WORKER_ARRAY" "$worker_host" "$worker_port")
            fi

            WORKER_COUNT=$((WORKER_COUNT + 1))
            echo "  - Worker $worker_index: $worker_host:$worker_port"
            ;;
    esac
done < <(grep '^WORKER_[0-9]\+=' "$ENV_FILE" | sort -t '_' -k2,2n)

# Use Python to surgically remove any existing Worker block and provide a clean insertion point
python3 - << 'PY'
from pathlib import Path
import re

config_path = Path("config/cms.toml")
if not config_path.exists():
    exit(0)

text = config_path.read_text()

# Pattern to match Worker block: 
# It can be 'Worker = [...]' or '# Worker = [...]' spanning multiple lines.
# We look for 'Worker = [' and then find the matching ']'
lines = text.splitlines()
new_lines = []
skip_until = -1
found_worker = False

for i, line in enumerate(lines):
    if i <= skip_until:
        continue
    
    stripped = line.strip()
    # Match both uncommented and commented Worker starts
    if (stripped.startswith("Worker = [") or stripped.startswith("# Worker = [") or stripped == "# Worker ="):
        # Found a worker block, let's find where it ends
        depth = 0
        j = i
        while j < len(lines):
            depth += lines[j].count("[")
            depth -= lines[j].count("]")
            if depth <= 0 and (j > i or "]" in lines[j]):
                skip_until = j
                break
            j += 1
        continue
    
    new_lines.append(line)

config_path.write_text("\n".join(new_lines) + "\n")
PY

# Inject workers into cms.toml
if [ $WORKER_COUNT -gt 0 ]; then
    # Create the formatted worker array with actual newlines
    WORKER_SECTION=$(printf "Worker = [\n    %s\n]" "$WORKER_ARRAY")
    
    # Use a more robust way to insert after EvaluationService
    # We'll use python again to ensure it's placed correctly in the [services] section
    export WORKER_SECTION
    python3 - << 'PY'
import os
from pathlib import Path

config_path = Path("config/cms.toml")
worker_section = os.environ.get("WORKER_SECTION", "")

if config_path.exists() and worker_section:
    text = config_path.read_text()
    if "EvaluationService =" in text:
        # Insert after the line containing EvaluationService
        lines = text.splitlines()
        new_lines = []
        for line in lines:
            new_lines.append(line)
            if line.strip().startswith("EvaluationService ="):
                new_lines.append(worker_section)
        config_path.write_text("\n".join(new_lines) + "\n")
PY
    echo "Injected $WORKER_COUNT worker(s) into configuration."
else
    echo "No workers configured. Existing Worker block removed if present."
fi

echo "Configuration injection complete."
