#!/bin/sh
# dpkg-state.sh — which of a rootfs's packages dpkg does NOT have installed.
#
# WHY this exists: /var/lib/dpkg/status keeps a stanza for a package that was removed while its
# conffiles stayed behind — `Status: deinstall ok config-files`, the state dpkg calls `rc`. Nothing
# of it is installed, so a CVE against it is not a risk on this host, but the package name still
# reaches the vulnerability report and the feed has no field that says "installed" or "removed".
# The host's own database does, and it is the only authority the scan can consult: the report is
# produced by a pinned trivy, and no flag of it asks "is this package actually installed?".
#
# The rule is deliberately one-sided: only a stanza dpkg itself marks `config-files` or
# `not-installed` is treated as gone. An `unpacked`, `half-configured`, `triggers-pending` package
# has files on disk, and a package with no `Status` line at all is unknown — both keep their
# findings, because clearing a finding the host cannot disprove is worse than keeping one too many.
set -eu

# dpkg_not_installed ROOTFS — prints a JSON array of package names, `[]` when the rootfs has no
# readable dpkg database (an apk or RPM host, or a mount that failed).
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

# dpkg_drop_not_installed FINDINGS ROOTFS — rewrites FINDINGS in place without the findings whose
# package dpkg reports as removed, and prints how many it dropped. A no-op (and `0`) when there is
# no dpkg database or when nothing matches, so an apk host keeps every finding it produced.
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
    # WHY `.subject`: trivy.jq maps PkgName there, and it is the same string dpkg prints on its
    # Package line. A finding whose subject is not in the removed set is copied unchanged.
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
