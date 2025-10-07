#!/bin/bash
set -e

# Set PostgreSQL user permissions for CMS
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    ALTER SCHEMA public OWNER TO $POSTGRES_USER;
    GRANT SELECT ON pg_largeobject TO $POSTGRES_USER;
EOSQL

echo "Database initialized with proper permissions for CMS"
