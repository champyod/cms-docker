#!/bin/bash

# Admin Bootstrapping Script for CMS
# Creates a full Superadmin directly in the database using Bun or Node.js

set -e

if [ -z "$1" ] || [ -z "$2" ]; then
    echo "Usage: $0 <username> <password> [\"Display Name\"]"
    exit 1
fi

USERNAME=$1
PASSWORD=$2
NAME=${3:-"System Administrator"}

echo "Creating Superadmin user: $USERNAME..."

# JavaScript payload for Prisma execution
# Note: Native .ts execution if Bun is used
PAYLOAD=$(cat <<EOP
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const hashedPassword = await bcrypt.hash('$PASSWORD', 10);
  const admin = await prisma.admins.upsert({
    where: { username: '$USERNAME' },
    update: {
      name: '$NAME',
      authentication: 'bcrypt:' + hashedPassword,
      enabled: true,
      permission_all: true,
      permission_messaging: true,
      permission_tasks: true,
      permission_users: true,
      permission_contests: true,
    },
    create: {
      name: '$NAME',
      username: '$USERNAME',
      authentication: 'bcrypt:' + hashedPassword,
      enabled: true,
      permission_all: true,
      permission_messaging: true,
      permission_tasks: true,
      permission_users: true,
      permission_contests: true,
    },
  });
  console.log('Successfully bootstrapped/updated admin:', admin.username);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.\$disconnect();
  });
EOP
)

echo "$PAYLOAD" > /tmp/bootstrap.ts

# Detect Local Runtime
LOCAL_RUNTIME=""
if command -v bun >/dev/null 2>&1; then
    LOCAL_RUNTIME="bun"
elif command -v npx >/dev/null 2>&1; then
    LOCAL_RUNTIME="npx"
fi

# Try local execution if in dev environment
if [ -n "$LOCAL_RUNTIME" ] && [ -d "admin-panel" ]; then
    echo "Detected local $LOCAL_RUNTIME environment. Running..."
    cd admin-panel
    if [ "$LOCAL_RUNTIME" = "bun" ]; then
        bun /tmp/bootstrap.ts
    else
        npx ts-node --compiler-options '{"module": "commonjs"}' /tmp/bootstrap.ts
    fi
    rm /tmp/bootstrap.ts
    exit 0
fi

# Try Docker execution
if command -v docker >/dev/null 2>&1; then
    # Find active admin-web-server container
    CONTAINER_NAME=$(docker ps --format '{{.Names}}' | grep "admin-web-server" | head -n 1)
    
    if [ -n "$CONTAINER_NAME" ]; then
        echo "Detected running container: $CONTAINER_NAME. Running via Docker..."
        docker cp /tmp/bootstrap.ts "$CONTAINER_NAME":/tmp/bootstrap.ts
        
        # Check if Bun is in the container
        if docker exec "$CONTAINER_NAME" command -v bun >/dev/null 2>&1; then
            docker exec -it "$CONTAINER_NAME" bun /tmp/bootstrap.ts
        else
            docker exec -it "$CONTAINER_NAME" npx ts-node --compiler-options '{"module": "commonjs"}' /tmp/bootstrap.ts
        fi
        rm /tmp/bootstrap.ts
        exit 0
    fi
fi

echo "----------------------------------------------------------------"
echo "ERROR: Could not find local runtime (bun/npx) or a running admin container."
echo "----------------------------------------------------------------"
echo "Ensure the admin-panel container is running (make admin-img)."
echo "You can check running containers with: docker ps"
echo ""

rm /tmp/bootstrap.ts
exit 1
