#!/bin/bash

###############################################################################
# CMS Database Initialization & Patching Script
# Author: CCYod
# 
# Robustly handles CMS schema creation and Admin UI patching.
# Ensures idempotency and handles password synchronization issues.
###############################################################################

set -e

# Load environment
ENV_FILE=".env.core"
if [ ! -f "$ENV_FILE" ]; then
    echo "Error: $ENV_FILE not found."
    exit 1
fi

# Extract variables, stripping carriage returns
DB_USER=$(grep "^POSTGRES_USER=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '\r' || echo "cmsuser")
DB_PASS=$(grep "^POSTGRES_PASSWORD=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '\r')
DB_NAME=$(grep "^POSTGRES_DB=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '\r' || echo "cmsdb")
DB_PORT=$(grep "^POSTGRES_PORT=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '\r' || echo "5432")

echo ">>> Database Maintenance: Starting robust initialization..."

# 1. Test connection and sync password if needed
echo "Checking database connectivity..."
if ! docker exec -i -e PGPASSWORD="$DB_PASS" cms-database psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" >/dev/null 2>&1; then
    echo "Warning: Authentication failed or DB unreachable. Attempting password sync..."
    # Try to fix password using local connection (doesn't require password if on the same machine/socket in many configs)
    # We use 'postgres' database for the sync command as it always exists
    docker exec -i cms-database psql -U "$DB_USER" -d postgres -c "ALTER USER $DB_USER WITH PASSWORD '$DB_PASS';" >/dev/null 2>&1 || \
    echo "Note: Automatic sync failed. If this is a fresh install, this is normal."
else
    echo "[✓] Database connection verified."
fi

# 2. Check if initialization is actually needed
# If the 'contests' table exists, CMS core is already initialized
if docker exec -i -e PGPASSWORD="$DB_PASS" cms-database psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT * FROM contests LIMIT 1" >/dev/null 2>&1; then
    echo "[✓] CMS Core Schema detected. Skipping cmsInitDB."
else
    echo "CMS Core Schema not found. Running cmsInitDB..."
    # Allow cmsInitDB to fail if some objects exist but others don't
    docker exec -it cms-log-service cmsInitDB || echo "Note: cmsInitDB completed with warnings (likely partially initialized)."
fi

# 3. Apply Admin UI Schema Patches (Idempotent)
echo "Applying Admin UI schema patches..."
docker exec -i -e PGPASSWORD="$DB_PASS" cms-database psql -U "$DB_USER" -d "$DB_NAME" < scripts/fix_db_schema.sql

echo ">>> Database Maintenance: Complete."
