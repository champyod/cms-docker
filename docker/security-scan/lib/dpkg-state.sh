#!/bin/sh
# dpkg-state.sh — package names a rootfs's dpkg has not installed.
set -eu

# dpkg_not_installed ROOTFS — removed package names as JSON; empty when there is no dpkg database.
dpkg_not_installed() {
    _status="$1/var/lib/dpkg/status"
    if [ ! -r "$_status" ]; then
        printf '[]\n'
        return 0
    fi

    awk '
        function flush() {
            if (pkg != "" && (state == "config-files" || state == "not-installed")) print pkg
            pkg = ""
            state = ""
        }
        /^Package:/ {
            flush()
            sub(/^Package:[[:space:]]*/, "")
            pkg = $0
            next
        }
        /^Status:/ {
            sub(/^Status:[[:space:]]*/, "")
            n = split($0, field, /[[:space:]]+/)
            state = field[n]
            next
        }
        END { flush() }
    ' "$_status" | jq -R . | jq -sc .
}

# dpkg_drop_not_installed FINDINGS ROOTFS — drop findings for removed packages, print the count.
dpkg_drop_not_installed() {
    _findings="$1"
    _absent=$(dpkg_not_installed "$2")
    case "$_absent" in
        '' | '[]')
            printf '0\n'
            return 0
            ;;
    esac

    _before=$(jq 'length' "$_findings")
    _filtered="$_findings.dpkg-state.$$"
    # WHY `.subject`: trivy.jq maps PkgName there, and it is the same string dpkg prints on its Package line.
    if ! jq --argjson absent "$_absent" \
        '[ .[] | select((.subject // "") as $p | ($absent | index($p)) == null) ]' \
        "$_findings" > "$_filtered"; then
        rm -f "$_filtered"
        # A filter that cannot run must not become an empty report: keep what was there.
        printf 'dpkg state: could not filter %s — every finding is kept\n' "$_findings" >&2
        printf '0\n'
        return 0
    fi
    mv "$_filtered" "$_findings"

    _after=$(jq 'length' "$_findings")
    printf '%s\n' "$((_before - _after))"
}
