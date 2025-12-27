#!/bin/bash

# Admin Bootstrapping Script for CMS
# Creates a full Superadmin directly in the database

set -e

if [ -z "$1" ] || [ -z "$2" ]; then
    echo "Usage: $0 <username> <password>"
    exit 1
fi

USERNAME=$1
PASSWORD=$2
NAME=${3:-"System Administrator"}

echo "Creating Superadmin user: $USERNAME..."

# Use npx prisma to create the user inside the admin-panel context
# We use a temporary JS file to run via ts-node or similar if available, 
# but since we have the server actions, we'll use a direct prisma script.

cat <<EOP > /tmp/bootstrap.ts
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

# Run the script using the environment inside the container
# We assume the container is named 'cms-admin-panel' or similar.
# In dev mode locally, we can run it directly if prisma is available.

if [ -f "admin-panel/package.json" ]; then
    cd admin-panel
    # Try running via npx
    npx ts-node --compiler-options '{"module": "commonjs"}' /tmp/bootstrap.ts
else
    # Try running inside docker
    docker exec -it cms-admin-panel sh -c "npx ts-node --compiler-options '{\"module\": \"commonjs\"}' /tmp/bootstrap.ts"
fi

rm /tmp/bootstrap.ts
