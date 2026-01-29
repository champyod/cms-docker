FROM alpine:3.18

# Install dependencies:
# bash: for the script.
# curl: for discord webhook.
# docker-cli: to check docker status.
# procps: for free, uptime, etc. (though script parses /proc, standard tools are good backup).
# jq: optional, but good for JSON if we used it.
RUN apk add --no-cache bash curl docker-cli procps

# We copy the script from the context (repo root)
COPY scripts/monitor.sh /usr/local/bin/monitor.sh

RUN chmod +x /usr/local/bin/monitor.sh

WORKDIR /app

# Run in daemon mode
CMD ["/usr/local/bin/monitor.sh", "-d"]
