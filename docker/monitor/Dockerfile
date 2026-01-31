FROM alpine:3.18

# Install dependencies:
# bash: for the script.
# curl: for discord webhook.
# docker-cli: to check docker status.
# procps: for free, uptime, etc.
# postgresql-client: for CSV exports.
# bc: for calculations in backup script.
RUN apk add --no-cache bash curl docker-cli procps postgresql-client bc

# We copy the script from the context (repo root)
COPY scripts/monitor.sh /usr/local/bin/monitor.sh
COPY scripts/cms-backup.sh /usr/local/bin/cms-backup.sh

RUN chmod +x /usr/local/bin/monitor.sh /usr/local/bin/cms-backup.sh

WORKDIR /app

# Run in daemon mode
CMD ["/usr/local/bin/monitor.sh", "-d"]
