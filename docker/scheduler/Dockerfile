# CMS Backup Schedule Poller
# Fires due backup_schedules rows by handing each dump to cms-monitor through
# the Docker CLI, the same argv the admin panel uses for a manual run.
#
# The build stage reuses the admin-panel toolchain (same node base, corepack
# pnpm, Prisma client generation) and compiles the poller with the project's own
# TypeScript, so the image and the admin panel cannot drift apart in how they
# build Prisma types.

FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS build
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
FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS release

RUN apt-get update && \
    apt-get install -y curl && \
    rm -rf /var/lib/apt/lists/*

# WHY the client is installed from the pinned apt source instead of `get.docker.com`:
# the convenience script installs whatever the channel serves that day, so the same
# commit builds a different Docker client (and Compose plugin, where it is installed)
# tomorrow, and an advisory fix is neither reliably present nor reliably absent. The
# poller needs the client only — it hands argv to the monitor over a mounted socket —
# so the engine the script would also install has no caller here.
ARG DOCKER_CLI_VERSION=5:29.9.3-1~debian.12~bookworm
ARG DOCKER_GPG_DIGEST=1500c1f56fa9e26b9b8f42452a553675796ade0807cdce11975eb98170b3a570
RUN install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc && \
    echo "${DOCKER_GPG_DIGEST}  /etc/apt/keyrings/docker.asc" | sha256sum -c - && \
    chmod a+r /etc/apt/keyrings/docker.asc && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
      > /etc/apt/sources.list.d/docker.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends "docker-ce-cli=${DOCKER_CLI_VERSION}" && \
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
