# Use the official Bun image
FROM oven/bun:latest as base
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Generate Prisma client
RUN bunx prisma generate

# Build the application
# Provide dummy DATABASE_URL to avoid Prisma constructor error during static page generation
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" bun run build

# Production image, copy all the files and run next
FROM oven/bun:latest as release

# Install Docker CLI to allow managing containers
RUN apt-get update && \
    apt-get install -y curl && \
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

CMD ["bun", "server.js"]
