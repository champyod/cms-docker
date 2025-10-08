FROM postgres:15-alpine

# Copy the database initialization script into the entrypoint directory
COPY ./scripts/init-db.sh /docker-entrypoint-initdb.d/init-db.sh
