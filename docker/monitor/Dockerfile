FROM alpine:3.18

# Install dependencies:
# bash: for the script.
# curl: for discord webhook.
# docker-cli: to check docker status.
# procps: for free, uptime, etc.
# postgresql-client: for CSV exports.
RUN apk add --no-cache bash curl docker-cli procps postgresql-client libstdc++ libgcc

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# We copy the script from the context (repo root)
COPY scripts/monitor.sh /usr/local/bin/monitor.sh
COPY scripts/cms-backup.ts /usr/local/bin/cms-backup.ts

RUN chmod +x /usr/local/bin/monitor.sh /usr/local/bin/cms-backup.ts

WORKDIR /app

# Run in daemon mode
CMD ["/usr/local/bin/monitor.sh", "-d"]
