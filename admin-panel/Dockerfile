# Use Node.js for deterministic Next.js builds (avoids Bun runtime crashes in buildx)
FROM node:20-bookworm-slim AS base
WORKDIR /app

# Install pnpm and dependencies
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY package.json ./
RUN pnpm install --no-frozen-lockfile

# Copy source code
COPY . .

# Generate Prisma client
RUN pnpm prisma generate

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

# Expose port (Next.js defaults to 3000)
EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
