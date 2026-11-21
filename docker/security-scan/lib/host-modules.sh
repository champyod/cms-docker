#!/bin/sh
# host-modules.sh — what this host's kernel runs; /proc/modules is the host's set because modules are not namespaced.
# Two lists, never a verdict: loaded wins over blacklisted, and that call belongs to the panel's reader.
set -eu

# A module directory belongs to a release, and the running release is the one that matters.
PROC_MODULES="${PROC_MODULES:-/proc/modules}"
MODPROBE_DIR_REL="etc/modprobe.d"
KERNEL_MODULES_DIR_REL="lib/modules"

# One name per line in, one JSON array out — the shape both lists are pushed in.
host_modules_json() {
    jq -R -s 'split("\n") | map(select(length > 0))'
}

# Overridable so a test can pin a release it has a fixture for.
host_modules_release() {
    printf '%s' "${HOST_MODULES_RELEASE:-$(uname -r)}"
}

# The loaded set: field 1 of /proc/modules, one name per line, sorted and deduplicated.
host_modules_loaded() {
    if [ ! -r "$PROC_MODULES" ]; then
        return 1
    fi
    awk '{ print $1 }' "$PROC_MODULES" | LC_ALL=C sort -u
}

# The blocked set: `blacklist <name>` or `install <name> /bin/true`; an `install … /sbin/modprobe` line is not a block.
host_modules_blocked() {
    _rootfs="${1:-/rootfs}"
    _conf_dir="$_rootfs/$MODPROBE_DIR_REL"
    [ -d "$_conf_dir" ] || return 0
    for _conf in "$_conf_dir"/*.conf; do
        [ -f "$_conf" ] || continue
        sed 's/#.*//' "$_conf"
    done | awk '
        $1 == "blacklist" && NF >= 2 { print $2 }
        $1 == "install" && NF >= 3 && $3 == "/bin/true" { print $2 }
    ' | LC_ALL=C sort -u
}

# The modules the release ships (.ko and .ko.zst): the existence question, which is never pushed because absence is derived.
host_modules_present() {
    _rootfs="${1:-/rootfs}"
    _release="${2:-$(host_modules_release)}"
    _dir="$_rootfs/$KERNEL_MODULES_DIR_REL/$_release"
    [ -d "$_dir" ] || return 1
    find "$_dir" -type f -name '*.ko*' 2>/dev/null \
        | sed 's#.*/##; s#\.ko\(\..*\)\{0,1\}$##' \
        | LC_ALL=C sort -u
}

# host_modules_write ROOTFS OUTFILE — the one record the rootfs mode pushes, or a refusal.
host_modules_write() {
    _rootfs="${1:-/rootfs}"
    _out="$2"
    _release="$(host_modules_release)"

    # Refusal, not an empty record: "this host has no modules" is a claim, and unknown is left unsaid.
    if ! _loaded="$(host_modules_loaded)"; then
        feed_log "host modules: $PROC_MODULES is not readable — the push claims nothing about modules"
        return 1
    fi
    _blocked="$(host_modules_blocked "$_rootfs")"

    # Not fatal: both lists stand alone, and a host with a cleaned-out /lib/modules still has them.
    if ! _present="$(host_modules_present "$_rootfs" "$_release")"; then
        feed_log "host modules: no $KERNEL_MODULES_DIR_REL/$_release under $_rootfs — absence is not verifiable"
        _present=""
    fi
    feed_log "host modules: $(printf '%s\n' "$_loaded" | awk 'NF' | wc -l | tr -d ' ') loaded, $(printf '%s\n' "$_blocked" | awk 'NF' | wc -l | tr -d ' ') blocked, $(printf '%s\n' "$_present" | awk 'NF' | wc -l | tr -d ' ') on disk ($_release)"

    jq -n \
        --arg release "$_release" \
        --argjson loaded "$(printf '%s\n' "$_loaded" | host_modules_json)" \
        --argjson blocked "$(printf '%s\n' "$_blocked" | host_modules_json)" \
        '{kernel_release: $release, loaded: $loaded, blocked: $blocked}' > "$_out"
}

