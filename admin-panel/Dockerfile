# Use Node.js for deterministic Next.js builds (avoids Bun runtime crashes in buildx)
FROM node:20-bookworm-slim AS base
WORKDIR /app

# Install pnpm and dependencies
# WHY: Prisma picks its engine binaries by probing the platform's OpenSSL. Slim
# images ship none, so the install would fetch the wrong engine set and the
# runtime would then look for (and download) an engine that was never installed.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY package.json ./
RUN pnpm install --no-frozen-lockfile

# WHY: the release stage has no host bind-mount and the standalone output only
# carries runtime-traced modules, so `prisma migrate deploy` needs a CLI that
# travels with the image. Build it as its own tree here, where the store is warm
# and registry access exists, in a hoisted (flat, real-directory) layout —
# pnpm's default virtual store is a symlink farm that COPY --from cannot resolve.
RUN mkdir -p /prisma-cli \
 && cd /prisma-cli \
 && echo '{"private":true}' > package.json \
 && echo 'node-linker=hoisted' > .npmrc \
 && pnpm add prisma@6

# Copy source code
COPY . .

# Generate Prisma client
RUN pnpm prisma generate --schema=./prisma/schema.prisma

# Build the application
# Provide dummy DATABASE_URL to avoid Prisma constructor error during static page generation
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" pnpm run build

# Production image, copy all the files and run next
FROM node:20-bookworm-slim AS release

# Install Docker CLI and make to allow managing containers and running make commands
RUN apt-get update && \
    apt-get install -y curl make && \
    curl -fsSL https://get.docker.com | sh && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production

# Copy built assets
COPY --from=base /app/public ./public
COPY --from=base /app/.next/standalone ./
COPY --from=base /app/.next/static ./.next/static

# Prisma CLI, its engines and the schema/migrations, so `migrate deploy` runs
# from this image alone — the host repo mount carries no node_modules on a
# deployment host. The CLI tree is merged into the standalone node_modules.
COPY --from=base /prisma-cli/node_modules ./node_modules
COPY --from=base /app/prisma ./prisma

# Fail the build, not the deployment, if the CLI or its engine cannot run here.
RUN CHECKPOINT_DISABLE=1 ./node_modules/.bin/prisma --version

# Expose port (Next.js defaults to 3000)
EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
