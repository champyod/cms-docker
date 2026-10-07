# Use Node.js for deterministic Next.js builds (avoids Bun runtime crashes in buildx)
FROM node:20-bookworm-slim AS base
WORKDIR /app

# WHY bun + frozen lockfile: the committed bun.lock is the tree `bun audit`
# verifies — a pnpm --no-frozen-lockfile install could silently drift from it.
# Prisma picks its engine binaries by probing the platform's OpenSSL, so slim
# images need openssl at install time; bun's installer needs curl/unzip/certs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl curl ca-certificates unzip \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL https://bun.com/install | bash
ENV BUN_INSTALL="/root/.bun"
ENV PATH="${BUN_INSTALL}/bin:${PATH}"

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# WHY: the release stage has no host bind-mount and the standalone output only
# carries runtime-traced modules, so migrations and the TypeScript permission
# seed need tooling that travels with the image. Build it as its own tree here,
# where the store is warm and registry access exists — bun installs flat, so
# COPY --from resolves without a symlink farm. prisma is pinned to the app's
# version so the CLI and the generated client cannot skew.
RUN mkdir -p /prisma-cli \
 && cd /prisma-cli \
 && echo '{"private":true}' > package.json \
 && bun add prisma@6.19.3 tsx@4

# Copy source code
COPY . .

# Generate Prisma client — invoke the bin directly so it runs under node via
# its shebang, not under the Bun runtime.
RUN ./node_modules/.bin/prisma generate --schema=./prisma/schema.prisma

# Build the application
# Provide dummy DATABASE_URL to avoid Prisma constructor error during static page generation
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" bun run build

# Production image, copy all the files and run next
FROM node:20-bookworm-slim AS release

# Install Docker CLI, make and python3 to allow managing containers, running make
# commands, and running `make env` (./cms config sync) from inside the container.
# WHY --no-install-recommends would otherwise drop curl's ca-certificates recommend,
# which the docker install below needs for HTTPS, so list it explicitly.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl make python3 && \
    curl -fsSL https://get.docker.com | sh && \
    rm -rf /var/lib/apt/lists/*

# WHY: the panel runs `make env` (./cms config sync) inside this container, and
# scripts/__inject_config.sh shells out to python3 via a heredoc. A missing
# interpreter or stdlib module would otherwise only surface as a failed monitor
# restart on a live deployment. Emulate the heredoc (python3 reading its program
# from stdin) and resolve the exact stdlib imports the script uses.
RUN python3 --version \
 && printf 'import os, re, json\nimport urllib.parse\nfrom pathlib import Path\nPath("/tmp/cms-python-guard").write_text("ok")\nassert Path("/tmp/cms-python-guard").read_text() == "ok"\n' | python3 \
 && rm -f /tmp/cms-python-guard

WORKDIR /app

ENV NODE_ENV=production

# Copy built assets
COPY --from=base /app/public ./public
COPY --from=base /app/.next/standalone ./
COPY --from=base /app/.next/static ./.next/static

# WHY: migrations and seeding must run from this image alone — the host repo
# mount carries no node_modules on a deployment host. Merge the tooling tree
# into standalone node_modules, reusing its generated Prisma client.
COPY --from=base /prisma-cli/node_modules ./node_modules
COPY --from=base /app/prisma ./prisma
# WHY: standalone tracing does not guarantee the seed's imports or alias config;
# explicitly include only its two source dependencies and config, not all of src.
COPY --from=base /app/src/lib/prisma.ts /app/src/lib/permission-registry.ts ./src/lib/
COPY --from=base /app/tsconfig.json ./tsconfig.json

# WHY: missing tooling or seed imports should fail the build, not a deployment;
# loading the imports constructs the client without connecting or seeding.
RUN CHECKPOINT_DISABLE=1 ./node_modules/.bin/prisma --version \
 && ./node_modules/.bin/tsx --version \
 && ./node_modules/.bin/tsx -e 'require("@/lib/prisma"); require("@/lib/permission-registry");'

# Unprivileged runtime: compose grants the host docker group (group_add) so the
# node user can still reach the mounted socket, and the cache dir must be
# writable for Next's lazy cache writes.
RUN mkdir -p /app/.next/cache \
 && chown -R node:node /app/.next
USER node

# Expose port (Next.js defaults to 3000)
EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
