#!/bin/bash
set -e

# Create user and database if they don't exist
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "postgres" <<-EOSQL
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${POSTGRES_USER}') THEN
            CREATE ROLE ${POSTGRES_USER} WITH LOGIN PASSWORD '${POSTGRES_PASSWORD}';
        END IF;
    END
    \$\$;

    -- Check if the database exists before trying to create it
    -- Note: This is a workaround since CREATE DATABASE IF NOT EXISTS is not available in all versions
    SELECT 'CREATE DATABASE ${POSTGRES_DB}'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${POSTGRES_DB}');

    -- Run the create database command (it will be empty if the DB exists)
    \gexec

    GRANT ALL PRIVILEGES ON DATABASE ${POSTGRES_DB} TO ${POSTGRES_USER};
EOSQL

# Set specific permissions required by CMS
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    ALTER SCHEMA public OWNER TO ${POSTGRES_USER};
    GRANT SELECT ON pg_largeobject TO ${POSTGRES_USER};
EOSQL

echo "Database and user configured for CMS"
