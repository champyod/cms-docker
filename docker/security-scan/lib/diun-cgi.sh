#!/bin/sh
# diun-cgi.sh — the endpoint Diun's webhook notifier POSTs to.
#
# WHY a translator at all: Diun's documented body is
# {status, provider, image, digest, created, platform, metadata} and the panel's ingest route
# accepts only {source, host, findings[], complete}. There is no way to make Diun emit the
# contract body, so this CGI is the translation layer — and it is the ONLY place in the repo
# that reads Diun's shape (see lib/diun.jq for the field mapping itself).
set -eu

LIB_DIR="${SECURITY_SCAN_LIB:-/usr/local/lib/security-feed}"
# shellcheck source=/dev/null
. "$LIB_DIR/feed.sh"

body=$(mktemp)
trap 'rm -f "$body"' EXIT
cat > "$body"

reply() {
    printf 'Content-Type: application/json\r\nStatus: %s\r\n\r\n%s\n' "$1" "$2"
}

if [ ! -s "$body" ]; then
    reply "400 Bad Request" '{"error":"empty body"}'
    exit 0
fi

if [ "${SECURITY_ENABLED:-0}" != "1" ]; then
    feed_log "SECURITY_ENABLED=0 — Diun notification accepted and dropped"
    reply "200 OK" '{"skipped":"SECURITY_ENABLED=0"}'
    exit 0
fi

findings=$(mktemp)
trap 'rm -f "$body" "$findings"' EXIT

if ! jq -e -f "$LIB_DIR/diun.jq" "$body" > "$findings" 2>/dev/null; then
    feed_log "Diun body was not parsable — rejected"
    reply "400 Bad Request" '{"error":"unparsable diun body"}'
    exit 0
fi

# complete is FALSE on purpose: Diun notifies one image at a time, so this is a partial set
# for source=diun. complete:true would license the route to resolve every OTHER image's
# finding on every single notification.
if feed_post diun "$findings" false; then
    reply "202 Accepted" '{"accepted":true}'
else
    # Non-2xx so Diun's own logs and retries show the feed is broken.
    reply "502 Bad Gateway" '{"accepted":false}'
fi
