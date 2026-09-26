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
COPY scripts/__monitor.sh /usr/local/bin/monitor.sh
COPY scripts/__backup.sh /usr/local/bin/cms-backup.sh
# WHY: cms-backup.sh sources ${SCRIPT_DIR}/__lib/common.sh and SCRIPT_DIR is
# /usr/local/bin here, so the lib has to land beside the scripts or the source
# fails and every backup cycle aborts.
COPY scripts/__lib /usr/local/bin/__lib

# a+rX grants the runtime user read access, and X only to directories, so
# the lib is traversable without depending on the build context's file modes.
RUN chmod +x /usr/local/bin/monitor.sh /usr/local/bin/cms-backup.sh \
    && chmod -R a+rX /usr/local/bin/__lib

# Non-root runtime. Read-only mounts stay readable (/host:ro is world-readable),
# but backups are written through the bind mount at /app/backups, so the uid has
# to equal the owner of the host backup tree or every write is denied. The Docker
# socket is owned by the host "docker" group, so the compose file (owned
# elsewhere) must grant that GID to this container:
#   group_add:
#     - "999"  # host docker GID: stat -c %g /var/run/docker.sock
# DOCKER_UID is a build arg so a box whose backups belong to another uid needs no
# source change; the default keeps hosts that already own uid 1000 unchanged.
ARG DOCKER_UID=1000
RUN addgroup -g ${DOCKER_UID} monitor \
    && adduser -D -u ${DOCKER_UID} -G monitor monitor

WORKDIR /app

RUN chown -R monitor:monitor /app

USER monitor

# Run in daemon mode
CMD ["/usr/local/bin/monitor.sh", "-d"]
