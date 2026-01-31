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
    grep "^$1=" "$ENV_FILE" | cut -d '=' -f2-
}

# Read variables
DB_USER=$(get_env_val "POSTGRES_USER")
DB_PASS=$(get_env_val "POSTGRES_PASSWORD")
DB_NAME=$(get_env_val "POSTGRES_DB")
DB_HOST=$(get_env_val "POSTGRES_HOST")
DB_PORT=$(get_env_val "POSTGRES_PORT")

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

# Handle Listen IP and Tailscale
TAILSCALE_IP=$(get_env_val "TAILSCALE_IP")
if [ -n "$TAILSCALE_IP" ]; then
    echo "Setting service addresses to Tailscale IP: $TAILSCALE_IP"
    # Update internal service discovery to use Tailscale IP instead of container names
    # This allows remote workers to connect to these addresses
    sed -i "s/\"cms-log-service\"/\"$TAILSCALE_IP\"/g" "$CONFIG_FILE"
    sed -i "s/\"cms-resource-service\"/\"$TAILSCALE_IP\"/g" "$CONFIG_FILE"
    sed -i "s/\"cms-scoring-service\"/\"$TAILSCALE_IP\"/g" "$CONFIG_FILE"
    sed -i "s/\"cms-checker-service\"/\"$TAILSCALE_IP\"/g" "$CONFIG_FILE"
    sed -i "s/\"cms-evaluation-service\"/\"$TAILSCALE_IP\"/g" "$CONFIG_FILE"
    sed -i "s/\"cms-proxy-service\"/\"$TAILSCALE_IP\"/g" "$CONFIG_FILE"
    sed -i "s/\"cms-contest-web-server-1\"/\"$TAILSCALE_IP\"/g" "$CONFIG_FILE"
    sed -i "s/\"cms-admin-web-server\"/\"$TAILSCALE_IP\"/g" "$CONFIG_FILE"
fi

# Ensure all web servers listen on all interfaces inside the container
sed -i 's/"127.0.0.1"/"0.0.0.0"/g' "$CONFIG_FILE"
sed -i 's/\["127.0.0.1"\]/\["0.0.0.0"\]/g' "$CONFIG_FILE"

# Build Worker array from WORKER_N environment variables
echo "Building worker configuration..."
WORKER_ARRAY=""
WORKER_COUNT=0

# Read all WORKER_N variables from .env.core
for i in {0..99}; do
    WORKER_VAR="WORKER_$i"
    WORKER_VALUE=$(get_env_val "$WORKER_VAR")
    
    if [ -n "$WORKER_VALUE" ]; then
        # Parse hostname:port
        WORKER_HOST=$(echo "$WORKER_VALUE" | cut -d ':' -f1)
        WORKER_PORT=$(echo "$WORKER_VALUE" | cut -d ':' -f2)
        
        # Add to array
        if [ -z "$WORKER_ARRAY" ]; then
            WORKER_ARRAY="[\"$WORKER_HOST\", $WORKER_PORT]"
        else
            WORKER_ARRAY="$WORKER_ARRAY,\n    [\"$WORKER_HOST\", $WORKER_PORT]"
        fi
        
        WORKER_COUNT=$((WORKER_COUNT + 1))
        echo "  - Worker $i: $WORKER_HOST:$WORKER_PORT"
    fi
done

# Inject workers into cms.toml
if [ $WORKER_COUNT -gt 0 ]; then
    # Find the commented Worker section and uncomment/replace it
    # The pattern matches the commented worker block in cms.sample.toml
    sed -i "/^# Worker definitions are now managed/,/^# \]/d" "$CONFIG_FILE"
    
    # Insert the Worker array after EvaluationService
    WORKER_SECTION="Worker = [\n    $WORKER_ARRAY\n]"
    sed -i "/^EvaluationService = /a\\$WORKER_SECTION" "$CONFIG_FILE"
    
    echo "Injected $WORKER_COUNT worker(s) into configuration."
else
    echo "No workers configured. Skipping worker injection."
fi

echo "Configuration injection complete."
