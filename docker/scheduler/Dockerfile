# CMS Backup Schedule Poller
# Fires due backup_schedules rows by handing each dump to cms-monitor through
# the Docker CLI, the same argv the admin panel uses for a manual run.
#
# The build stage reuses the admin-panel toolchain (same node base, corepack
# pnpm, Prisma client generation) and compiles the poller with the project's own
# TypeScript, so the image and the admin panel cannot drift apart in how they
# build Prisma types.

FROM node:20-bookworm-slim AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate
COPY admin-panel/package.json ./
RUN pnpm install --no-frozen-lockfile

COPY admin-panel/prisma ./prisma
RUN pnpm prisma generate --schema=./prisma/schema.prisma

COPY admin-panel/tsconfig.json ./
COPY admin-panel/src/lib ./src/lib
COPY admin-panel/src/scheduler ./src/scheduler
RUN pnpm exec tsc -p src/scheduler/tsconfig.build.json

# The runtime carries the compiled poller, the Prisma client it queries with and
# the Docker CLI it launches backups through. The socket is mounted at run time,
# never baked in. `make` is not installed: the poller runs no compose targets.
FROM node:20-bookworm-slim AS release

RUN apt-get update && \
    apt-get install -y curl && \
    curl -fsSL https://get.docker.com | sh && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY admin-panel/src/scheduler/bootstrap.mjs ./bootstrap.mjs

# The Docker socket is owned by the host "docker" group, so docker-compose.yml
# grants that GID to this container, the same way it does for cms-monitor.
RUN chown -R node:node /app
USER node

CMD ["node", "bootstrap.mjs"]
