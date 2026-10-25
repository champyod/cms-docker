# Use Node.js for deterministic Next.js builds (avoids Bun runtime crashes in buildx)
# WHY the digest: Node 20 went EOL on 2026-03-24 — the 2026-10-21 security release shipped
# fixes for 26.x/24.x/22.x only and EOL lines are affected by every one of them. 24 is the
# active LTS (fixes to 2028-04). The readable tag stays for humans; the digest is what fixes
# the bits, because a floating `node:20-bookworm-slim` can change under a build with no PR.
FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS base
WORKDIR /app

# WHY bun + frozen lockfile: the committed bun.lock is the tree `bun audit`
# verifies — a pnpm --no-frozen-lockfile install could silently drift from it.
# Prisma picks its engine binaries by probing the platform's OpenSSL, so slim
# images need openssl at install time; bun's installer needs curl/unzip/certs.
#
# WHY bun is installed at a pinned version: an unpinned `curl https://bun.com/install | bash`
# installs whatever bun is current at build time, so two builds of the same commit can carry
# different runtimes and a bun advisory is neither reliably fixed nor reliably absent. The
# version argument pins the release; the lockfile it installs from is already committed.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl curl ca-certificates unzip \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL https://bun.com/install | bash -s "bun-v1.4.2"
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
# WHY the override is repeated here: this tree's node_modules is what the release
# stage copies into the image, so a transitive dependency it resolves without the
# app's own overrides ships the version the app deliberately replaced. deepmerge-ts
# reaches prisma through @prisma/config > c12, where the range resolves to 7.1.5
# against the 8.0.0 the app pins over it.
RUN mkdir -p /prisma-cli \
 && cd /prisma-cli \
 && echo '{"private":true,"overrides":{"deepmerge-ts":"8.0.0"}}' > package.json \
# WHY jose is installed here as well: the tsx-run scripts (the permission seed, the audit-log
# verifier, the waiver export) resolve their imports with bare node, not through the Next bundler —
# and the actor chain reaches session-token.ts, which imports `jose`. Without it the seed died at
# run time with MODULE_NOT_FOUND, after the migrations had already committed.
 && bun add prisma@6.19.3 tsx@4 jose@6.1.3

# Copy source code
COPY . .

# Generate Prisma client — invoke the bin directly so it runs under node via
# its shebang, not under the Bun runtime.
RUN ./node_modules/.bin/prisma generate --schema=./prisma/schema.prisma

# Build the application
# Provide dummy DATABASE_URL to avoid Prisma constructor error during static page generation
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" bun run build

# Production image, copy all the files and run next
FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS release

# Install Docker CLI, make and python3 to allow managing containers, running make
# commands, and running `make env` (./cms config sync) from inside the container.
# WHY --no-install-recommends would otherwise drop curl's ca-certificates recommend,
# which the docker install below needs for HTTPS, so list it explicitly.
# WHY the removals: the convenience script installs the whole plugin set, but this
# image only ever runs `docker` and `docker compose` — the Makefile resolves
# COMPOSE_CMD with `docker compose version` and nothing here calls buildx, the model
# plugin or rootless docker. They are attack surface with no caller, and they are
# what the image scan reports on, so they are removed rather than shipped.
# WHY the upgrade: the Debian slim base lags the point releases that are
# already published, and the image scan reads what ships — libcap2, libgnutls30 and
# libpcre2-8-0 all had fixes available that the base image had not picked up. Taking
# them here means the image carries today's security updates instead of waiting for
# upstream to rebuild, and it runs before the docker install so only base-image
# packages are in scope for it.
RUN apt-get update && \
    apt-get -y dist-upgrade && \
    apt-get install -y --no-install-recommends ca-certificates curl make python3 && \
    curl -fsSL https://get.docker.com | sh && \
    rm -f /usr/libexec/docker/cli-plugins/docker-buildx \
          /usr/libexec/docker/cli-plugins/docker-model \
          /usr/bin/rootlesskit \
          /usr/bin/dockerd-rootless.sh \
          /usr/bin/dockerd-rootless-setuptool.sh && \
    rm -rf /var/lib/apt/lists/*

# WHY: the panel runs `make env` (./cms config sync) inside this container, and
# scripts/__inject_config.sh shells out to python3 via a heredoc. A missing
# interpreter or stdlib module would otherwise only surface as a failed monitor
# restart on a live deployment. Emulate the heredoc (python3 reading its program
# from stdin) and resolve the exact stdlib imports the script uses.
RUN python3 --version \
 && printf 'import os, re, json\nimport urllib.parse\nfrom pathlib import Path\nPath("/tmp/cms-python-guard").write_text("ok")\nassert Path("/tmp/cms-python-guard").read_text() == "ok"\n' | python3 \
 && rm -f /tmp/cms-python-guard

# WHY npm goes: this stage installs its dependencies with bun and starts the server
# with `node server.js`, and nothing in the image invokes npm — not the Makefile, not
# `cms`, not the panel. It is here only because the Node base image carries it, and
# its bundled dependency tree is a large surface whose advisories are not ours to
# patch, so it is removed rather than scanned forever.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

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
# explicitly include only its source dependencies and config, not all of src.
# The audit-log entry (scripts/audit-log.ts) is the retention service's only command and the
# operator verifier; it needs the shared chain module beside the client, and nothing else.
COPY --from=base /app/src/lib/prisma.ts /app/src/lib/permission-registry.ts /app/src/lib/audit-chain.ts ./src/lib/
COPY --from=base /app/src/lib/db-actor.ts ./src/lib/
COPY --from=base /app/src/lib/db-actor-request.ts ./src/lib/
# The actor-resolution chain is prisma -> db-actor-request -> session-token; a file missing from
# this list fails the seed at run time, not at build time, so the module that reads the cookie is
# named explicitly rather than assumed to come along.
COPY --from=base /app/src/lib/session-token.ts ./src/lib/
COPY --from=base /app/scripts/audit-log.ts ./scripts/audit-log.ts
# The exposure reconciler's command and the modules it loads. WHY these and not all of src: it renders
# through the same writers the panel uses, so it needs those readers and nothing the panel owns.
COPY --from=base /app/scripts/reconcile-exposures.ts ./scripts/reconcile-exposures.ts
COPY --from=base \
     /app/src/lib/reconciler.ts \
     /app/src/lib/exposure-apply.ts \
     /app/src/lib/front-nginx.ts \
     /app/src/lib/front-vhosts.ts \
     /app/src/lib/repo-root.ts \
     /app/src/lib/with-timeout.ts \
     /app/src/lib/service-wiring.ts \
     /app/src/lib/service-wiring-apply.ts \
     /app/src/lib/service-wiring-artifacts.ts \
     /app/src/lib/service-wiring-contract.ts \
     /app/src/lib/service-wiring-front-vhosts.ts \
     /app/src/lib/service-wiring-render.ts \
     /app/src/lib/service-wiring-store.ts \
     ./src/lib/
COPY --from=base /app/tsconfig.json ./tsconfig.json

# WHY: missing tooling or seed imports should fail the build, not a deployment;
# loading the imports constructs the client without connecting or seeding.
# WHY the second import line: the client resolves its actor through db-actor-request, which reads
# the session cookie, which reaches next/headers. That chain is exactly what the permission seed
# loads outside a request, so importing only the client proved the wrong thing — the first
# production seed died with MODULE_NOT_FOUND after the migrations had already committed.
RUN CHECKPOINT_DISABLE=1 ./node_modules/.bin/prisma --version \
 && ./node_modules/.bin/tsx --version \
 && ./node_modules/.bin/tsx -e 'require("@/lib/prisma"); require("@/lib/permission-registry"); require("@/lib/audit-chain");' \
 && ./node_modules/.bin/tsx -e 'Promise.all([import("@/lib/db-actor-request"), import("@/lib/session-token"), import("@/lib/db-actor")]).then(() => console.log("ACTOR_IMPORT_OK"))' \
 && ./node_modules/.bin/tsx -e 'require("@/lib/reconciler"); require("@/lib/front-nginx");'

# Unprivileged runtime: compose grants the host docker group (group_add) so the
# node user can still reach the mounted socket, and the cache dir must be
# writable for Next's lazy cache writes.
# WHY the ranking dir: a fresh `cms-ranking-data` named volume is seeded from this
# image path, so declaring it node:node is what lets the unprivileged panel write
# the uploaded logo there instead of hitting EACCES.
RUN mkdir -p /app/.next/cache /var/local/lib/cms/ranking \
 && chown -R node:node /app/.next /var/local/lib/cms/ranking
USER node

# Expose port (Next.js defaults to 3000)
EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
