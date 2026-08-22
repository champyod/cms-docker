FROM alpine:3.22

# Install dependencies:
# bash: for the script.
# curl: for discord webhook.
# docker-cli: to check docker status.
# procps: for free, uptime, etc.
# postgresql-client: for CSV exports.
# bc: for calculations in backup script.
# jq: for JSON parsing of container config.
RUN apk add --no-cache bash curl docker-cli procps postgresql-client bc jq

# We copy the script from the context (repo root)
COPY scripts/monitor.sh /usr/local/bin/monitor.sh
COPY scripts/cms-backup.sh /usr/local/bin/cms-backup.sh

RUN chmod +x /usr/local/bin/monitor.sh /usr/local/bin/cms-backup.sh

# Non-root runtime (uid/gid 1000). Read-only mounts stay readable (/host:ro is
# world-readable), but the Docker socket is owned by the host "docker" group,
# so the compose file (owned elsewhere) must grant that GID to this container:
#   group_add:
#     - "999"  # host docker GID: stat -c %g /var/run/docker.sock
# Backup targets under ${REPO_ROOT}/backups must also be writable by uid 1000.
RUN addgroup -g 1000 monitor \
    && adduser -D -u 1000 -G monitor monitor

WORKDIR /app

RUN chown -R monitor:monitor /app

USER monitor

# Run in daemon mode
CMD ["/usr/local/bin/monitor.sh", "-d"]
