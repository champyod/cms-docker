#!/bin/bash

# Admin Bootstrapping Script for CMS
# Creates a full Superadmin directly in the database

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
PAYLOAD=$(cat <<EOP
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

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
    await prisma.$disconnect();
  });
EOP
)

echo "$PAYLOAD" > /tmp/bootstrap.ts

# Execution Strategy
# 1. Try local npx if in dev environment
# 2. Try docker exec if container is running
# 3. Fail with clear instructions

if command -v npx >/dev/null 2>&1 && [ -d "admin-panel" ]; then
    echo "Detected local Node.js environment. Running via npx..."
    cd admin-panel
    npx ts-node --compiler-options '{"module": "commonjs"}' /tmp/bootstrap.ts
    exit 0
fi

if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -q "cms-admin-panel"; then
    echo "Detected running 'cms-admin-panel' container. Running via Docker..."
    docker cp /tmp/bootstrap.ts cms-admin-panel:/tmp/bootstrap.ts
    docker exec -it cms-admin-panel sh -c "npx ts-node --compiler-options '{\"module\": \"commonjs\"}' /tmp/bootstrap.ts"
    exit 0
fi

echo "----------------------------------------------------------------"
echo "ERROR: Could not find local 'npx' or a running 'cms-admin-panel' container."
echo "----------------------------------------------------------------"
echo "To bootstrap the admin on your remote server, please run:"
echo ""
echo "  1. Copy this script to the remote server."
echo "  2. Ensure the admin-panel container is running (make admin-img)."
echo "  3. Run: ./scripts/bootstrap-admin.sh $USERNAME $PASSWORD \"$NAME\""
echo ""
echo "If you are running manually inside the container:"
echo "  docker exec -it cms-admin-panel npx ts-node --eval \"... (js code) ...\""

rm /tmp/bootstrap.ts
exit 1
