#!/bin/bash
set -e

# Define files
ENV_FILE=".env.core"
CONFIG_FILE="config/cms.toml"

echo "Running configuration injection script..."

if [ ! -f "$ENV_FILE" ]; then
    echo "Error: $ENV_FILE not found."
    exit 1
fi

if [ ! -f "$CONFIG_FILE" ]; then
    echo "Error: $CONFIG_FILE not found."
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

# Default values if missing
DB_USER=${DB_USER:-cmsuser}
DB_PASS=${DB_PASS:-your_password_here}
DB_NAME=${DB_NAME:-cmsdb}
DB_HOST=${DB_HOST:-database}
DB_PORT=$(get_env_val "POSTGRES_PORT")
CMS_SECRET=$(get_env_val "CMS_SECRET_KEY")
CORE_SERVICES_IP=$(get_env_val "CORE_SERVICES_IP")

# Default values if missing
DB_USER=${DB_USER:-cmsuser}
...
echo "Injecting configuration:"
echo "  - DB Host: $DB_HOST:$DB_PORT"
echo "  - DB User: $DB_USER"
echo "  - DB Name: $DB_NAME"

# Handle Service Discovery IP
# We now use extra_hosts in docker-compose files to route service names
# to the correct CORE_SERVICES_IP. We no longer need to modify hostnames here.
# This keeps the config cleaner and relies on Docker's networking.

# Ensure all web servers listen on all interfaces inside the container
sed -i 's/"127.0.0.1"/"0.0.0.0"/g' "$CONFIG_FILE"
sed -i 's/\["127.0.0.1"\]/\["0.0.0.0"\]/g' "$CONFIG_FILE"

# Perform replacements using | as delimiter
sed -i "s|your_password_here|$SAFE_PASS|g" "$CONFIG_FILE"
sed -i "s|cmsuser|$DB_USER|g" "$CONFIG_FILE"
sed -i "s|cmsdb|$DB_NAME|g" "$CONFIG_FILE"
sed -i "s|database:5432|$DB_HOST:$DB_PORT|g" "$CONFIG_FILE"

if [ -n "$CMS_SECRET" ]; then
    echo "  - Injecting CMS config secret_key..."
    sed -i "s/secret_key = \".*\"/secret_key = \"$CMS_SECRET\"/g" "$CONFIG_FILE"
fi

# Handle Listen IP and Tailscale
# NOTE: We NO LONGER replace container names with Tailscale IP here.
# Services must bind to hostnames they actually own (like cms-log-service).
# Port mapping in docker-compose.core.yml handles the external VPN visibility.

# Ensure all web servers listen on all interfaces inside the container
sed -i 's/"127.0.0.1"/"0.0.0.0"/g' "$CONFIG_FILE"
sed -i 's/\["127.0.0.1"\]/\["0.0.0.0"\]/g' "$CONFIG_FILE"

# Handle Ranking Scoreboard Auth
# We check environment variables which are populated by 'make env'
R_USER=${RANKING_USERNAME:-usern4me}
R_PASS=${RANKING_PASSWORD:-passw0rd}
# Escape password for sed
SAFE_R_PASS=$(echo "$R_PASS" | sed 's/\\/\\\\/g' | sed 's/|/\\|/g' | sed 's/&/\\&/g')

echo "Injecting Ranking credentials..."
sed -i "s|usern4me:passw0rd|$R_USER:$SAFE_R_PASS|g" "$CONFIG_FILE"

# Build Worker array from WORKER_N environment variables
echo "Building worker configuration..."
WORKER_ARRAY=""
WORKER_COUNT=0

# Collect WORKER_N lines, sort by index numerically
WORKER_LINES=$(grep -E '^WORKER_[0-9]+=' "$ENV_FILE" 2>/dev/null || true)
if [ -n "$WORKER_LINES" ]; then
    # Transform WORKER_#=host:port into "# host port" and sort by #
    echo "$WORKER_LINES" | sed 's/^WORKER_//' | sort -t'=' -k1n | while IFS='=' read -r idx val; do
        WORKER_HOST=$(echo "$val" | cut -d':' -f1)
        WORKER_PORT=$(echo "$val" | cut -d':' -f2)
        if [ -z "$WORKER_HOST" ] || [ -z "$WORKER_PORT" ]; then
            continue
        fi
        if [ -z "$WORKER_ARRAY" ]; then
            WORKER_ARRAY="[\"$WORKER_HOST\", $WORKER_PORT]"
        else
            WORKER_ARRAY="$WORKER_ARRAY,\n    [\"$WORKER_HOST\", $WORKER_PORT]"
        fi
        WORKER_COUNT=$((WORKER_COUNT + 1))
        echo "  - Worker $idx: $WORKER_HOST:$WORKER_PORT"
    done
fi

# Inject workers into cms.toml
if [ $WORKER_COUNT -gt 0 ]; then
    # Remove any existing Worker = [ ... ] block
    awk 'BEGIN{skip=0} { if ($0 ~ /^Worker = \[/) {skip=1; next} if (skip==1 && $0 ~ /^\]/) {skip=0; next} if (skip==0) print }' "$CONFIG_FILE" > "$CONFIG_FILE.tmp" && mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"

    # Prepare the Worker section text
    WORKER_SECTION="Worker = [\n    $WORKER_ARRAY\n]"

    # Insert the Worker array after EvaluationService line, or append at end if not found
    if grep -q "^EvaluationService =" "$CONFIG_FILE"; then
        sed -i "/^EvaluationService =/a\\$WORKER_SECTION" "$CONFIG_FILE"
    else
        echo -e "\n$WORKER_SECTION" >> "$CONFIG_FILE"
    fi

    echo "Injected $WORKER_COUNT worker(s) into configuration."
else
    echo "No workers configured. Skipping worker injection."
fi

echo "Configuration injection complete."
