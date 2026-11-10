#!/usr/bin/env bash
# tests/test_security_scan_modes.sh — what each scan mode is allowed to look at.
#
# WHY this exists, from a real host: the first production run of the scanner produced no OSV
# findings at all (osv-scanner exited 127 while walking /src and hit a root-owned file it could not
# read) and 34,606 "host" findings (it had scanned /var/lib/docker, i.e. every image layer the box
# had ever pulled). Both failures were silent — the mode reported a count and pushed. These checks
# are static because they describe the arguments, which is exactly the part that drifted.

set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
SCAN="${REPO_ROOT}/docker/security-scan/scan.sh"

pass=0
fail=0
ok()  { printf '  ok   %s\n' "$1"; pass=$((pass + 1)); }
no()  { printf '  FAIL %s\n' "$1"; fail=$((fail + 1)); }

if [[ ! -f "$SCAN" ]]; then
  printf '  FAIL docker/security-scan/scan.sh is missing — nothing to check\n'
  printf '\nPASS: 0  FAIL: 1\n'
  exit 1
fi

printf '\nosv mode reads the lockfiles we ship, not the whole checkout\n'
if grep -q 'scan source -r "\$SRC_DIR"' "$SCAN"; then
  no "scan.sh still walks \$SRC_DIR — one unreadable file makes osv exit 127 with no report"
else
  ok "no recursive walk of \$SRC_DIR"
fi
if grep -q 'osv-scanner scan source "\$@"' "$SCAN"; then
  ok "osv is invoked with the lockfile list (-L …)"
else
  no "osv is not invoked with -L lockfiles — the dependency set is not being scanned"
fi
for lock in admin-panel/bun.lock ranking-web/Cargo.lock; do
  if grep -q "$lock" "$SCAN"; then ok "names $lock"; else no "does not name $lock"; fi
done

# A file osv has no extractor for is worse than useless: it aborts the whole scan.
for bad in 'src/constraints.txt' 'admin-panel/package.json'; do
  # Comments may name them (that is how the reason is recorded); what matters is the code.
  if grep -v '^[[:space:]]*#' "$SCAN" | grep -qF "$bad"; then
    no "names $bad, which osv-scanner has no extractor for (exit 127, no report)"
  else
    ok "does not name the unsupported $bad"
  fi
done

printf '\nrootfs mode scans the host OS, not the images stored on it\n'
for dir in var/lib/docker var/lib/containers proc sys dev run; do
  if grep -q -- "--skip-dirs \"\$ROOTFS_DIR/$dir\"" "$SCAN"; then
    ok "skips \$ROOTFS_DIR/$dir"
  else
    no "does not skip \$ROOTFS_DIR/$dir — its packages are reported as host CVEs"
  fi
done
if grep -q -- '--pkg-types os' "$SCAN"; then
  ok "stays on OS packages (language manifests are the osv mode's job)"
else
  no "--pkg-types os is gone: the rootfs scan would report application dependencies as host CVEs"
fi

printf '\nrootfs mode does not report CVEs for packages dpkg has removed\n'
DPKG_LIB="${REPO_ROOT}/docker/security-scan/lib/dpkg-state.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/rootfs/var/lib/dpkg"
# The shapes that matter: installed, removed-with-conffiles (`rc`, the state that produced
# findings for packages the host does not have) and unpacked-but-not-configured (files are on disk,
# so its findings must survive).
cat > "$WORK/rootfs/var/lib/dpkg/status" <<'STATUS'
Package: keep-me
Status: install ok installed
Version: 1.0

Package: removed-rc
Status: deinstall ok config-files
Version: 2.1

Package: half-there
Status: install ok unpacked
Version: 3.0

Package: never-installed
Status: purge ok not-installed
Version: 4.0
STATUS

if [[ ! -f "$DPKG_LIB" ]]; then
  no "docker/security-scan/lib/dpkg-state.sh is missing — nothing decides which packages are installed"
else
  absent=$(sh -c ". '$DPKG_LIB'; dpkg_not_installed '$WORK/rootfs'")
  if [[ "$(printf '%s' "$absent" | jq -r 'sort | join(",")')" == "never-installed,removed-rc" ]]; then
    ok "dpkg_not_installed names exactly the rc and purged packages"
  else
    no "dpkg_not_installed returned '$absent' — the state map is wrong"
  fi

  # A host with no dpkg database (apk, RPM, a mount that failed) must keep every finding: an empty
  # answer here would look like "every package was removed" and clear the source.
  empty=$(sh -c ". '$DPKG_LIB'; dpkg_not_installed '$WORK/nothing-here'")
  [[ "$empty" == "[]" ]] && ok "a rootfs with no dpkg database yields [] (no filters)" \
                        || no "a rootfs with no dpkg database yielded '$empty'"

  jq -n '[
    {key: "CVE-1|keep-me|1.0", subject: "keep-me"},
    {key: "CVE-2|removed-rc|2.1", subject: "removed-rc"},
    {key: "CVE-3|half-there|3.0", subject: "half-there"},
    {key: "CVE-4|never-installed|4.0", subject: "never-installed"},
    {key: "CVE-5|no-stanza|1.0", subject: "no-stanza"}
  ]' > "$WORK/findings.json"

  dropped=$(sh -c ". '$DPKG_LIB'; dpkg_drop_not_installed '$WORK/findings.json' '$WORK/rootfs'")
  kept=$(jq -r '[.[].subject] | sort | join(",")' "$WORK/findings.json")
  [[ "$dropped" == "2" ]] && ok "two findings for removed packages are dropped" \
                          || no "the filter dropped $dropped findings, expected 2"
  [[ "$kept" == "half-there,keep-me,no-stanza" ]] \
    && ok "installed, unpacked and unknown packages keep their findings" \
    || no "the filter left '$kept' — it removed more than dpkg said was gone"

  if grep -v '^[[:space:]]*#' "$SCAN" | grep -q 'dpkg_drop_not_installed "\$findings" "\$ROOTFS_DIR"'; then
    ok "rootfs mode applies the filter to the findings it is about to push"
  else
    no "scan.sh does not filter removed packages — their CVEs reach the panel"
  fi
  if grep -q 'dpkg-state.sh' "${REPO_ROOT}/docker/security-scan/Dockerfile"; then
    ok "the image copies dpkg-state.sh to the lib directory scan.sh sources"
  else
    no "dpkg-state.sh is not in the image — the source line would fail at runtime"
  fi
fi

printf '\nPASS: %d  FAIL: %d\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
