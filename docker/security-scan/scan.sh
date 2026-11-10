#!/bin/sh
# security-scan — every findings producer of the CMS security feed, one entry point.
set -eu

# The instant this invocation began, shared by every mode it runs.
SECURITY_RUN_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export SECURITY_RUN_STARTED_AT

MODE="${1:-help}"
# Set by the rootfs mode once it has read the host's module state; empty means "no claim".
FEED_HOST_MODULES_FILE=""
export FEED_HOST_MODULES_FILE
LIB_DIR="${SECURITY_SCAN_LIB:-/usr/local/lib/security-feed}"
SRC_DIR="${SRC_DIR:-/src}"
ROOTFS_DIR="${ROOTFS_DIR:-/rootfs}"
WORK_DIR="${WORK_DIR:-/tmp/security-scan}"

# shellcheck source=/dev/null
. "$LIB_DIR/feed.sh"
# shellcheck source=/dev/null
. "$LIB_DIR/dpkg-state.sh"
# shellcheck source=/dev/null
. "$LIB_DIR/host-modules.sh"

log() { printf '%s security-scan[%s]: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$MODE" "$*" >&2; }

usage() {
    sed -n '3,12p' "$0" >&2
}

# --------------------------------------------------------------------------- osv
scan_osv() {
    mkdir -p "$WORK_DIR"
    out="$WORK_DIR/osv.json"
    findings="$WORK_DIR/osv-findings.json"
    rm -f "$out"

    # WHY the lockfiles are named instead of walking the tree: `scan source -r /src` recurses through everything under
    set --
    # Only extractors osv-scanner actually has: `src/constraints.txt` is a pip constraints file and package.json is not
    for lock in \
        "$SRC_DIR"/admin-panel/bun.lock \
        "$SRC_DIR"/admin-panel/package-lock.json \
        "$SRC_DIR"/ranking-web/Cargo.lock \
        "$SRC_DIR"/requirements.txt \
        "$SRC_DIR"/uv.lock; do
        [ -f "$lock" ] && set -- "$@" -L "$lock"
    done
    if [ "$#" -eq 0 ]; then
        log "osv: no lockfile found under $SRC_DIR — complete:false, nothing is resolved"
        printf '[]\n' > "$findings"
        feed_post osv "$findings" false || true
        return 1
    fi

    rc=0
    osv-scanner scan source "$@" --format json --output-file "$out" \
        --verbosity warn || rc=$?

    # osv-scanner exits 1 when it FOUND vulnerabilities — that is a completed scan, not a failure, and requiring exit 0
    complete=false
    case "$rc" in
        0|1)
            if [ -s "$out" ] && jq -e . "$out" >/dev/null 2>&1; then
                complete=true
            else
                log "osv-scanner exited $rc but wrote no parsable report — complete:false"
            fi
            ;;
        *)
            log "osv-scanner exited $rc — complete:false, nothing is resolved"
            ;;
    esac

    if [ -s "$out" ] && jq -f "$LIB_DIR/osv.jq" "$out" > "$findings" 2>/dev/null; then
        :
    else
        printf '[]\n' > "$findings"
        complete=false
    fi

    log "osv: $(jq 'length' "$findings") findings under $SRC_DIR (complete=$complete)"
    feed_post osv "$findings" "$complete"
    # A push that could not claim completeness still happened, but a manual run must exit non-zero: an operator who
    [ "$complete" = "true" ]
}

# --------------------------------------------------------------------------- rootfs
scan_rootfs() {
    mkdir -p "$WORK_DIR"
    out="$WORK_DIR/trivy-rootfs.json"
    findings="$WORK_DIR/rootfs-findings.json"
    rm -f "$out"

    rc=0
    # WHAT these skips are for: /proc,/sys,/dev,/run are not filesystems, and /var/lib/docker holds every image layer
    trivy rootfs \
        --scanners vuln \
        --pkg-types os \
        --skip-dirs "$ROOTFS_DIR/var/lib/docker" \
        --skip-dirs "$ROOTFS_DIR/var/lib/containers" \
        --skip-dirs "$ROOTFS_DIR/proc" \
        --skip-dirs "$ROOTFS_DIR/sys" \
        --skip-dirs "$ROOTFS_DIR/dev" \
        --skip-dirs "$ROOTFS_DIR/run" \
        --format json \
        --output "$out" \
        --cache-dir "${TRIVY_CACHE_DIR:-$WORK_DIR/trivy-cache}" \
        --timeout "${TRIVY_TIMEOUT:-30m}" \
        --quiet \
        "$ROOTFS_DIR" || rc=$?

    # WHY this guard is not optional: complete:true licenses the panel to resolve every rootfs finding the body did not
    os_results=0
    if [ -s "$out" ]; then
        os_results=$(jq '[.Results[]? | select(.Class == "os-pkgs")] | length' "$out" 2>/dev/null || printf 0)
    fi

    complete=false
    if [ "$rc" -ne 0 ]; then
        log "trivy exited $rc — complete:false, nothing is resolved"
    elif [ "$os_results" -eq 0 ]; then
        log "trivy reported no os-pkgs result for $ROOTFS_DIR — no readable/supported package database. complete:false so existing rootfs findings stay unresolved."
    else
        complete=true
    fi

    if [ -s "$out" ] && jq -f "$LIB_DIR/trivy.jq" "$out" > "$findings" 2>/dev/null; then
        :
    else
        printf '[]\n' > "$findings"
        complete=false
    fi

    # WHY the filter runs before the push and after the mapper: dpkg keeps a stanza for a package it removed
    dropped=$(dpkg_drop_not_installed "$findings" "$ROOTFS_DIR")
    if [ "$dropped" -gt 0 ]; then
        log "rootfs: $dropped finding(s) dropped — dpkg has the package removed (state rc/not-installed), not installed"
    fi

    # The host kernel's module state rides this same envelope: the panel cannot judge a kernel CVE
    # without knowing whether its subsystem is present on this box, and a second feed source would
    # be a second place for the body shape to drift.
    modules="$WORK_DIR/host-modules.json"
    if host_modules_write "$ROOTFS_DIR" "$modules"; then
        FEED_HOST_MODULES_FILE="$modules"
    fi

    log "rootfs: $(jq 'length' "$findings") findings under $ROOTFS_DIR (complete=$complete)"
    feed_post rootfs "$findings" "$complete"
    # Same rule as osv: complete:false was pushed so nothing resolves, and the exit code says the scan is not
    [ "$complete" = "true" ]
}

scan_all() {
    rc=0
    scan_osv || rc=1
    scan_rootfs || rc=1
    return "$rc"
}

# --------------------------------------------------------------------------- schedule
run_schedule() {
    # The profile is the compose-level switch; this flag is the config-level one, so a stack that always passes
    if [ "${SECURITY_ENABLED:-0}" != "1" ]; then
        log "SECURITY_ENABLED=0 — no scans scheduled, exiting (restart policy on-failure keeps it down)"
        exit 0
    fi
    : "${SECURITY_SCAN_SCHEDULE:?SECURITY_SCAN_SCHEDULE is required in schedule mode}"

    # crond honours the operator's cron expression; the crontab lives on tmpfs (read-only root).
    mkdir -p /tmp/crontabs
    printf '%s /usr/local/bin/security-scan all >> /proc/1/fd/1 2>&1\n' "$SECURITY_SCAN_SCHEDULE" \
        > /tmp/crontabs/root
    chmod 600 /tmp/crontabs/root

    log "crontab '$SECURITY_SCAN_SCHEDULE' (container time, UTC by default); running one scan now"
    scan_all || log "initial scan reported a problem — crond continues on schedule"
    # -d 8 keeps crond's own errors on stderr (docker logs) instead of syslog, which nothing collects inside this
    exec crond -f -d 8 -c /tmp/crontabs
}

# --------------------------------------------------------------------------- diun bridge
run_bridge() {
    port="${SECURITY_BRIDGE_PORT:-8099}"
    # Deliberately listens even when SECURITY_ENABLED=0: Diun must not see connection failures it would retry forever.
    log "Diun translator listening on :$port (POST /cgi-bin/diun)"
    exec httpd -f -v -p "$port" -h "$LIB_DIR/www"
}

case "$MODE" in
    osv) scan_osv ;;
    rootfs) scan_rootfs ;;
    all) scan_all ;;
    schedule) run_schedule ;;
    diun-bridge) run_bridge ;;
    help | -h | --help) usage ;;
    *)
        log "unknown mode: $MODE"
        usage
        exit 2
        ;;
esac
