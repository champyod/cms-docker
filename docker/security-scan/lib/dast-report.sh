#!/bin/sh
# dast-report.sh — which ZAP report the feed reads, and whether it may claim completeness.
#
# Sourced by scan.sh after feed.sh (it logs through feed_log). The ZAP container writes into the
# cache volume; everything that decides what those files mean lives here, so scan.sh's dast mode is
# only "map it, post it, record it".
set -eu

# Where the ZAP container writes: a subdirectory of the scanner's cache volume, mounted read-only
# there, so the only writer of a report is the container that produced it.
DAST_REPORT_DIR="${DAST_REPORT_DIR:-/var/cache/security-scan/dast}"

# dast_newest_report DIR — the newest *.json under DIR, empty when there is none.
# WHY by mtime and not a fixed name: a run that died mid-write leaves a truncated file behind it,
# and choosing by name would keep reading it.
dast_newest_report() {
    _newest=""
    [ -n "${1:-}" ] || { printf ''; return 0; }
    for _f in "$1"/*.json; do
        [ -f "$_f" ] || continue
        if [ -z "$_newest" ] || [ "$_f" -nt "$_newest" ]; then _newest="$_f"; fi
    done
    printf '%s' "$_newest"
}

# dast_complete REPORT MAX_AGE_HOURS — true|false, and the reason goes to the log.
dast_complete() {
    if [ -z "${1:-}" ]; then
        feed_log "dast: no report — complete:false, nothing is resolved"
        printf 'false'
        return 0
    fi
    _age="${2:-26}"
    case "$_age" in '' | *[!0-9]*) _age=26 ;; esac
    # Age is a truth claim, not a nicety: a stopped ZAP would otherwise leave a month-old report
    # looking like a site that is still clean today.
    if [ -n "$(find "$1" -mmin "+$((_age * 60))" 2>/dev/null)" ]; then
        feed_log "dast: $1 is older than ${_age}h — complete:false, nothing is resolved"
        printf 'false'
        return 0
    fi
    # WHY the site guard: an empty site list is a scan that never reached the target, and
    # complete:true there would mark every finding the feed already holds as resolved.
    if jq -e '(.site // []) | length > 0' "$1" >/dev/null 2>&1; then
        printf 'true'
    else
        feed_log "dast: $1 names no site — the scan could not read the target. complete:false"
        printf 'false'
    fi
}

# dast_site_host REPORT — the host the report scanned, empty when it cannot say.
dast_site_host() {
    [ -n "${1:-}" ] || { printf ''; return 0; }
    jq -r '(.site[0]["@host"] // .site[0].host // "") | tostring' "$1" 2>/dev/null || printf ''
}

# The mode lives here, not in scan.sh, so the dispatcher stays under the file-size ceiling.
scan_dast() {
    mkdir -p "$WORK_DIR"
    findings="$WORK_DIR/dast-findings.json"
    report=$(dast_newest_report "$DAST_REPORT_DIR")
    complete=$(dast_complete "$report" "${DAST_MAX_AGE_HOURS:-26}")
    if [ -z "$report" ] || ! jq -f "$LIB_DIR/zap.jq" "$report" > "$findings" 2>/dev/null; then
        printf '[]\n' > "$findings"
        complete=false
    fi
    count=$(jq 'length' "$findings")

    # The scanned site, not this box: resolution is host-scoped, so a push labelled with the
    # scanner's own name could never close the rows its findings carry. Restored before the status
    # write, so the digest still names the box that ran it.
    dast_host=$(dast_site_host "$report")
    prev_host="${SECURITY_HOST:-}"
    log "dast: $count findings from ${report:-no report} (complete=$complete, site=${dast_host:-unknown})"
    [ -z "$dast_host" ] || SECURITY_HOST="$dast_host"
    push_rc=0
    feed_post dast "$findings" "$complete" || push_rc=$?
    SECURITY_HOST="$prev_host"
    scan_status_record dast "$count"
    if [ "$push_rc" -ne 0 ]; then return "$push_rc"; fi
    # complete:false resolved nothing, so a manual run exits non-zero, exactly as osv and rootfs do.
    [ "$complete" = "true" ]
}
