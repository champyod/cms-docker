#!/bin/sh
# feed.sh — the ONE place the security feed envelope is built and POSTed.
#
# WHY this is a library and not three curl lines: docs/SECURITY-FEED.md fixes the body as
# {source, host, findings[], complete} for every producer. Duplicating that envelope in the
# trivy path, the osv path and the Diun translator is how one of them silently drifts from
# the contract. Every producer in this image ends here.
#
# Contract fields owned by this file: source, host, complete, the auth header, the 2000-item
# cap. Per-source shapes live in *.jq beside it and nowhere else.
set -eu

feed_log() { printf '%s security-feed: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }

# The panel shows this in the findings' host column. SECURITY_HOST is set per deployment
# (.env.security); the container hostname is only a fallback so a hand-run never sends "".
feed_host() {
    if [ -n "${SECURITY_HOST:-}" ]; then
        printf '%s' "$SECURITY_HOST"
    else
        hostname 2>/dev/null || printf 'unknown'
    fi
}

# feed_post SOURCE FINDINGS_FILE COMPLETE
#   SOURCE   diun | rootfs | osv (the contract's enum — never anything else)
#   FINDINGS a JSON array produced by one of the *.jq mappers
#   COMPLETE "true" only when the producer knows it reported its full current set
feed_post() {
    _source="$1"
    _file="$2"
    _complete="$3"
    _url="${PANEL_URL:-http://admin-panel-next:3000}/api/security/findings"
    _token="${SECURITY_FEED_TOKEN:-}"

    # WHY refuse instead of sending: the route answers 401, and a silent 401 in a nightly
    # container looks exactly like a healthy feed. Fail loudly at the producer.
    if [ -z "$_token" ]; then
        feed_log "SECURITY_FEED_TOKEN is empty — not POSTing $_source (the route would answer 401)"
        return 1
    fi

    _count=$(jq 'length' "$_file")

    # The ingest route rejects arrays over 2000. Sending the first 2000 of a bigger set and
    # still claiming complete would license the route to resolve the rows we left out, so a
    # capped push is downgraded to complete:false — it never resolves anything.
    if [ "$_count" -gt 2000 ]; then
        feed_log "$_source produced $_count findings; capping at 2000 and sending complete:false (no resolution)"
        jq '.[0:2000]' "$_file" > "${_file}.capped"
        _file="${_file}.capped"
        _count=2000
        _complete=false
    fi

    _body=$(jq -c \
        --arg source "$_source" \
        --arg host "$(feed_host)" \
        --argjson complete "$_complete" \
        '{source: $source, host: $host, findings: ., complete: $complete}' "$_file")

    _resp=$(mktemp)
    _code=$(printf '%s' "$_body" | curl -sS --max-time 60 --retry 3 --retry-connrefused \
        -o "$_resp" -w '%{http_code}' \
        -X POST \
        -H "Authorization: Bearer ${_token}" \
        -H 'Content-Type: application/json' \
        --data-binary @- "$_url") || _code=000

    case "$_code" in
        2*)
            feed_log "POST $_url accepted $_count findings (source=$_source, complete=$_complete) → HTTP $_code"
            rm -f "$_resp"
            return 0
            ;;
        *)
            feed_log "POST $_url FAILED → HTTP $_code: $(head -c 400 "$_resp" 2>/dev/null || true)"
            rm -f "$_resp"
            return 1
            ;;
    esac
}
