#!/usr/bin/env bash
# tests/test_security_scan_status.sh — a run publishes what it did, and the file a digest reads is one atomic fact.
#
# WHY this exists: the digest could see a count from the log line and nothing else, so a scan whose
# last batch the panel refused read exactly like a clean nightly run. These checks drive the real
# scan.sh with a stub trivy and a stub curl, so the fact is asserted end to end and not from its parts.

set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
SCAN="${REPO_ROOT}/docker/security-scan/scan.sh"
STATUS_LIB="${REPO_ROOT}/docker/security-scan/lib/scan-status.sh"
FEED_LIB="${REPO_ROOT}/docker/security-scan/lib/feed.sh"

pass=0
fail=0
ok()  { printf '  ok   %s\n' "$1"; pass=$((pass + 1)); }
no()  { printf '  FAIL %s\n' "$1"; fail=$((fail + 1)); }

if [[ ! -f "$STATUS_LIB" ]]; then
  printf '  FAIL docker/security-scan/lib/scan-status.sh is missing — nothing publishes the run\n'
  printf '\nPASS: 0  FAIL: 1\n'
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  printf '  FAIL jq is required to read the published fact\n\nPASS: 0  FAIL: 1\n'
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- stubs -------------------------------------------------------------------------------------
# trivy writes the report this suite controls; the real one downloads a DB and reads the host.
mkdir -p "$WORK/bin"
cat > "$WORK/bin/trivy" <<'STUB'
#!/bin/sh
out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --output) out="$2"; shift 2 ;;
    --skip-dirs|--cache-dir|--timeout|--format|--scanners|--pkg-types) shift 2 ;;
    *) shift ;;
  esac
done
cp "$TRIVY_REPORT" "$out"
STUB

# curl answers the feed's POST: code from CURL_STUB_CODE, refusal from CURL_STUB_FAIL_AT (1-based).
cat > "$WORK/bin/curl" <<'STUB'
#!/bin/sh
data=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o|-H|-w|-X|--max-time|--retry) shift 2 ;;
    --data-binary) data="$2"; shift 2 ;;
    *) shift ;;
  esac
done
n=0
[ -f "$CURL_STUB_DIR/calls" ] && n="$(cat "$CURL_STUB_DIR/calls")"
n=$((n + 1))
printf '%s' "$n" > "$CURL_STUB_DIR/calls"
case "$data" in
  @-) cat > "$CURL_STUB_DIR/body-$n.json" ;;
  @*) cp "${data#@}" "$CURL_STUB_DIR/body-$n.json" ;;
esac
if [ -n "${CURL_STUB_FAIL_AT:-}" ] && [ "$n" -ge "${CURL_STUB_FAIL_AT}" ]; then
  printf '500'
  exit 0
fi
printf '%s' "${CURL_STUB_CODE:-201}"
STUB
chmod +x "$WORK/bin/trivy" "$WORK/bin/curl"

# Two OS findings, the shape trivy.jq reads (trivy emits an object with a Results array).
two_findings() {
  jq -n '{SchemaVersion: 2, Results: [{Target: "debian 12", Class: "os-pkgs", Type: "debian", Vulnerabilities: [
          {VulnerabilityID: "CVE-2026-0001", PkgName: "libssl3", InstalledVersion: "3.0.1", FixedVersion: "3.0.2", Severity: "HIGH", Title: "one"},
          {VulnerabilityID: "CVE-2026-0002", PkgName: "bash", InstalledVersion: "5.2", FixedVersion: "", Severity: "LOW", Title: "two"}]}]}' \
    > "$WORK/trivy-report.json"
}

# 900 findings: more than one batch at the feed's 250-record limit.
many_findings() {
  jq -n '{SchemaVersion: 2, Results: [{Target: "debian 12", Class: "os-pkgs", Type: "debian",
          Vulnerabilities: [range(900) | {VulnerabilityID: ("CVE-2026-" + (. | tostring)), PkgName: "pkg",
                                           InstalledVersion: "1.0", FixedVersion: "1.1", Severity: "HIGH"}]}]}' \
    > "$WORK/trivy-report.json"
}

two_findings
mkdir -p "$WORK/rootfs" "$WORK/status" "$WORK/calls"

# run_scan LOGNAME OUTCODE FAIL_AT STATUS_FILE MODE — the real scan.sh against the stubs.
run_scan() {
  local code="${2:-201}" fail_at="${3:-}" status_file="${4:-$WORK/status/scan-status.json}" mode="${5:-rootfs}" rows="${6:-$WORK/status/rows.jsonl}"
  rm -f "$WORK/calls/calls"
  ( set +e
    env PATH="$WORK/bin:$PATH" \
      SECURITY_SCAN_LIB="$REPO_ROOT/docker/security-scan/lib" \
      SECURITY_RUN_STARTED_AT="2026-11-12T03:00:00Z" \
      SECURITY_HOST="test-host" SECURITY_FEED_TOKEN="test-token" \
      PANEL_URL="http://127.0.0.1:9" \
      ROOTFS_DIR="$WORK/rootfs" WORK_DIR="$WORK/work" \
      SCAN_STATUS_FILE="$status_file" SCAN_STATUS_ROWS="$rows" \
      TRIVY_REPORT="$WORK/trivy-report.json" CURL_STUB_DIR="$WORK/calls" \
      CURL_STUB_CODE="$code" CURL_STUB_FAIL_AT="$fail_at" \
      SRC_DIR="$WORK/src" \
      sh "$SCAN" "$mode" > "$WORK/$1.log" 2>&1
    echo $? > "$WORK/$1.rc" )
}

printf '\nscan.sh publishes the fact, on the volume the digest reads\n'
if grep -q 'scan-status.sh' "$SCAN"; then ok "scan.sh sources the status lib"; else no "scan.sh does not source scan-status.sh"; fi
if grep -q 'scan-status.sh' "${REPO_ROOT}/docker/security-scan/Dockerfile"; then
  ok "the image copies scan-status.sh to the lib directory"
else
  no "scan-status.sh is not in the image — the source line would fail at runtime"
fi
if grep -q 'scan_status_publish || true' "$SCAN"; then
  ok "a failed status write cannot fail the scan (published with || true)"
else
  no "scan_status_publish is not guarded — a full or read-only cache volume would fail the scan"
fi
if grep -v '^[[:space:]]*#' "$STATUS_LIB" | grep -q 'mv -f "$_tmp" "$SCAN_STATUS_FILE"'; then
  ok "the published file is replaced by rename (one writer, no half a file)"
else
  no "the status file is not replaced atomically"
fi
if grep -q 'var/cache/security-scan/scan-status.json' "$STATUS_LIB"; then
  ok "the default path is the scanner's only writable mount"
else
  no "the default path is not under /var/cache/security-scan"
fi

printf '\na completed run is a full fact\n'
run_scan scan1
rc="$(cat "$WORK/scan1.rc")"
status="$WORK/status/scan-status.json"
[[ "$rc" == "0" ]] && ok "scan.sh rootfs exits 0" || no "scan.sh rootfs exited $rc"
if [[ -f "$status" ]]; then
  ok "the status file exists after the run"
  [[ "$(jq -r '.at' "$status")" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
    && ok "at is a UTC ISO instant" || no ".at is $(jq -r '.at' "$status")"
  [[ "$(jq -r '.findings' "$status")" == "2" ]] \
    && ok "findings is what was accepted (2)" || no ".findings is $(jq -r '.findings' "$status")"
  [[ "$(jq -r '.batches_sent' "$status")/$(jq -r '.batches_total' "$status")" == "1/1" ]] \
    && ok "batches reads 1/1" || no "batches read $(jq -c '[.batches_sent,.batches_total]' "$status")"
  [[ "$(jq -r '.batches_rejected' "$status")" == "0" ]] \
    && ok "0 batches rejected" || no ".batches_rejected is $(jq -r '.batches_rejected' "$status")"
  [[ "$(jq -r '.complete' "$status")" == "true" ]] \
    && ok "the run is complete" || no "the run is not complete"
  [[ "$(jq -r '.sources | length' "$status")" == "1" && "$(jq -r '.sources[0].source' "$status")" == "rootfs" ]] \
    && ok "the per-source row names rootfs" || no "sources are $(jq -c '.sources' "$status")"
  [[ "$(jq -r '.host' "$status")" == "test-host" ]] \
    && ok "the fact names the host" || no ".host is $(jq -r '.host' "$status")"
  left=$(find "$WORK/status" -name '*.tmp.*' | wc -l | tr -d ' ')
  [[ "$left" == "0" ]] && ok "no temporary file was left behind" || no "$left temp file(s) survived the publish"
else
  no "no status file was written: $(tail -3 "$WORK/scan1.log" | tr '\n' ' ')"
fi

printf '\na run the panel refused is not a complete run\n'
run_scan scan2 201 1
status2="$WORK/status/scan-status.json"
  [[ "$(jq -r '.batches_rejected' "$status2")" == "1" ]] \
    && ok "the refused batch is counted (1 rejected)" || no ".batches_rejected is $(jq -r '.batches_rejected' "$status2")"
  [[ "$(jq -r '.batches_sent' "$status2")" == "0" ]] \
    && ok "0 batches were accepted" || no ".batches_sent is $(jq -r '.batches_sent' "$status2")"
  [[ "$(jq -r '.complete' "$status2")" == "false" ]] \
    && ok "the run is not complete" || no "a refused push still claimed complete"
  [[ "$(jq -r '.findings' "$status2")" == "0" ]] \
    && ok "findings counts what landed (0), not what was found" || no ".findings is $(jq -r '.findings' "$status2")"

printf '\nbatches are counted across a split set\n'
many_findings
run_scan scan3 201 3
status3="$WORK/status/scan-status.json"
read -r sent total < <(jq -r '"\(.batches_sent) \(.batches_total)"' "$status3")
[[ "${total:-0}" -ge 3 ]] && ok "900 findings planned $total batches" || no "900 findings planned $total batches — the split did not happen"
[[ "${sent:-0}" -lt "${total:-0}" && "${sent:-0}" -ge 1 ]] \
  && ok "the run stopped after $sent accepted batch(es) of $total" || no "$sent of $total batches were accepted before the refusal"
[[ "$(jq -r '.batches_rejected' "$status3")" == "1" ]] \
  && ok "exactly one refused body is counted" || no ".batches_rejected is $(jq -r '.batches_rejected' "$status3")"
landed=$(jq -r '.findings' "$status3")
[[ "$landed" -gt 0 && "$landed" -lt 900 ]] \
  && ok "findings is the $landed that landed, not the 900 that were found" || no ".findings is $landed of 900 produced"
[[ "$(jq -r '.complete' "$status3")" == "false" ]] && ok "a short run is not complete" || no "a short run claimed complete"

printf '\nboth sources land in one fact\n'
two_findings
mkdir -p "$WORK/src/admin-panel"
: > "$WORK/src/admin-panel/bun.lock"
cat > "$WORK/bin/osv-scanner" <<'STUB'
#!/bin/sh
out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --output-file) out="$2"; shift 2 ;;
    *) shift ;;
  esac
done
printf '{"results":[]}\n' > "$out"
STUB
chmod +x "$WORK/bin/osv-scanner"
run_scan scan5 201 "" "$WORK/status/scan-all.json" all
[[ "$(jq -r '.sources | map(.source) | join(",")' "$WORK/status/scan-all.json")" == "osv,rootfs" ]] \
  && ok "both sources have a row in the one fact" || no "sources are $(jq -c '.sources' "$WORK/status/scan-all.json")"
[[ "$(jq -r '.findings' "$WORK/status/scan-all.json")" == "2" ]] \
  && ok "findings adds both sources (2)" || no ".findings is $(jq -r '.findings' "$WORK/status/scan-all.json")"
[[ "$(jq -r '.batches_sent' "$WORK/status/scan-all.json")" == "$(jq -r '.batches_total' "$WORK/status/scan-all.json")" ]] \
  && ok "every body was accepted" || no "batches read $(jq -c '[.batches_sent,.batches_total]' "$WORK/status/scan-all.json")"
[[ "$(jq -r '.complete' "$WORK/status/scan-all.json")" == "true" ]] \
  && ok "a run with both sources complete is complete" || no "the all run is not complete"

printf '\na status write that fails leaves the scan alone\n'
: > "$WORK/blocked"     # a regular file where the directory should be: even root cannot mkdir there
run_scan scan4 201 "" "$WORK/blocked/scan-status.json"
rc="$(cat "$WORK/scan4.rc")"
[[ "$rc" == "0" ]] && ok "the scan still exits on its own verdict (0)" \
                  || no "the scan exited $rc because the status write failed"
if grep -q 'scan status:' "$WORK/scan4.log"; then
  ok "the failure is logged, not swallowed"
else
  no "the status write failed silently"
fi

printf '\na run with no rows directory of its own still publishes\n'
# The container starts with no WORK_DIR: the reset must create it, not assume a mode did.
rm -rf "$WORK/cold"
run_scan scan6 201 "" "$WORK/cold/status/scan-status.json" rootfs "$WORK/cold/work/rows.jsonl"
rc="$(cat "$WORK/scan6.rc")"
[[ "$rc" == "0" ]] && ok "the scan survives a cold rows directory (0)" \
                  || no "the scan exited $rc because the rows directory did not exist"
if jq -e '.findings >= 0' "$WORK/cold/status/scan-status.json" >/dev/null 2>&1; then
  ok "the fact is published to a directory this run had to create"
else
  no "no fact published when the rows directory was cold"
fi

printf '\nPASS: %d  FAIL: %d\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
