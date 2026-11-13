#!/bin/sh
# scan-status.sh — the run's result as one small JSON file the digest reads.
#
# Source after feed.sh: the batch counters this records are feed_post's, and its log line is feed_log.
set -eu

# The cache volume is the container's only writable mount (docker-compose.security.yml).
SCAN_STATUS_FILE="${SCAN_STATUS_FILE:-/var/cache/security-scan/scan-status.json}"
# One row per source, kept on tmpfs: the published file is the fact, these are the parts it is built from.
SCAN_STATUS_ROWS="${SCAN_STATUS_ROWS:-${WORK_DIR:-/tmp/security-scan}/scan-status.rows}"

# Start a run: counting a previous run's rows would invent batches that never happened.
scan_status_reset() {
    mkdir -p "$(dirname "$SCAN_STATUS_FILE")" 2>/dev/null || true
    # The rows dir is WORK_DIR, which the container does not have until a mode creates it.
    mkdir -p "$(dirname "$SCAN_STATUS_ROWS")" 2>/dev/null || true
    : > "$SCAN_STATUS_ROWS"
}

# scan_status_record SOURCE PRODUCED — one row; findings counts what the panel accepted, not what was found.
scan_status_record() {
    _produced="${2:-0}"
    case "$_produced" in '' | *[!0-9]*) _produced=0 ;; esac
    _findings="${FEED_LAST_ACCEPTED:-$_produced}"
    # An absent tally is not a zero: the row omits the key rather than claiming none were fixable.
    _fixable="${FEED_LAST_FIXABLE:-}"
    case "$_fixable" in '' | *[!0-9]*) _fixable="" ;; esac
    jq -cn \
        --arg source "$1" \
        --argjson findings "$_findings" \
        --argjson fixable "${_fixable:-null}" \
        --argjson sent "${FEED_LAST_BATCHES_SENT:-0}" \
        --argjson total "${FEED_LAST_BATCHES_TOTAL:-0}" \
        --argjson rejected "${FEED_LAST_BATCHES_REJECTED:-0}" \
        --argjson complete "${FEED_LAST_COMPLETE:-false}" \
        '{source: $source, findings: $findings, batches_sent: $sent,
          batches_total: $total, batches_rejected: $rejected, complete: $complete}
         + (if $fixable == null then {} else {fixable: $fixable} end)' \
        >> "$SCAN_STATUS_ROWS"
}

# scan_status_publish — replace the fact atomically; non-zero on failure, never fatal to the scan.
scan_status_publish() {
    if [ ! -s "$SCAN_STATUS_ROWS" ]; then
        feed_log "scan status: no source recorded — $SCAN_STATUS_FILE left as it was"
        return 1
    fi
    _at="${SECURITY_RUN_STARTED_AT:-$(LC_ALL=C date -u +%Y-%m-%dT%H:%M:%SZ)}"
    _tmp="${SCAN_STATUS_FILE}.tmp.$$"
    # fixable is published only when every row counted it: a partial sum would read as the run's total.
    if ! jq -cs --arg at "$_at" --arg host "$(feed_host)" '
        (map(.fixable) | if length > 0 and all(. != null) then add else null end) as $fixable
        | {at: $at, host: $host, findings: (map(.findings) | add // 0)}
          + (if $fixable == null then {} else {fixable: $fixable} end)
          + {batches_sent: (map(.batches_sent) | add // 0),
             batches_total: (map(.batches_total) | add // 0),
             batches_rejected: (map(.batches_rejected) | add // 0),
             complete: (length > 0 and all(.complete)),
             sources: .}' "$SCAN_STATUS_ROWS" > "$_tmp" 2>/dev/null; then
        rm -f "$_tmp"
        feed_log "scan status: could not render $SCAN_STATUS_FILE"
        return 1
    fi
    # rename, never a copy in place: a reader sees the old fact or the new one, never half a file.
    if ! mv -f "$_tmp" "$SCAN_STATUS_FILE" 2>/dev/null; then
        rm -f "$_tmp"
        feed_log "scan status: could not replace $SCAN_STATUS_FILE — the scan itself is unaffected"
        return 1
    fi
    feed_log "scan status: $SCAN_STATUS_FILE written"
    return 0
}
