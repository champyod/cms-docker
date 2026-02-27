#!/bin/bash
set -e

# Usage: ./scripts/select_contest.sh [build|img]

MODE=$1
COMPOSE_CMD=$(docker compose version >/dev/null 2>&1 && echo "docker compose" || echo "docker-compose")

# Check if database is running
if ! docker ps | grep -q cms-database; then
    echo "Error: cms-database container is not running."
    echo "Please start core services first with: make core"
    exit 1
fi

echo "Querying available contests from the database..."
echo "------------------------------------------------"

# Fetch contests from database
# We handle the case where the table might not exist if CMS isn't initialized yet
docker exec -i cms-database psql -U cmsuser -d cmsdb -c "SELECT id, name FROM contests;" 2>/dev/null || {
    echo "No contests found or database not initialized."
    echo "Please ensure you have run 'make cms-init' and created a contest in the Admin Panel."
    exit 1
}

echo "------------------------------------------------"
read -p "Enter the ID of the contest you want to start: " SELECTED_ID

if [[ ! "$SELECTED_ID" =~ ^[0-9]+$ ]]; then
    echo "Error: Invalid ID. Must be a number."
    exit 1
fi

echo "Starting Contest Web Server for Contest ID: $SELECTED_ID"

if [ "$MODE" = "img" ]; then
    CONTEST_ID=$SELECTED_ID $COMPOSE_CMD -f docker-compose.contest.yml -f docker-compose.contest.img.yml up -d --no-build
else
    CONTEST_ID=$SELECTED_ID $COMPOSE_CMD -f docker-compose.contest.yml up -d --build
fi

echo "Contest $SELECTED_ID is now running!"
