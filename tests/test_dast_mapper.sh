#!/usr/bin/env bash
# tests/test_dast_mapper.sh — a ZAP baseline report becomes the feed's findings, and a rescan of
# the same site rewrites the same rows instead of minting new ones.
#
# WHY the mapper is tested here and not in the panel: lib/zap.jq is the only place ZAP's shape is
# read, so a wrong severity word or a key carrying a timestamp is invisible in the panel — it just
# silently doubles the page every night. This suite feeds a report in and compares findings out.
#
# WHY the second half: a correct mapper behind a mode that never pushes, or that pushes with the
# scanner's own hostname, is still broken. The mode runs through the real scan.sh and a stubbed
# curl, so "one POST path" and the completeness claim are asserted, not assumed.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
SCAN="${REPO_ROOT}/docker/security-scan/scan.sh"
MAPPER="${REPO_ROOT}/docker/security-scan/lib/zap.jq"

pass=0
fail=0
ok() { printf '  ok   %s\n' "$1"; pass=$((pass + 1)); }
no() { printf '  FAIL %s\n' "$1"; fail=$((fail + 1)); }
is() { if [[ "$2" == "$3" ]]; then ok "$1"; else no "$1 (expected '$2', got '$3')"; fi; }

command -v jq >/dev/null 2>&1 || { printf '  FAIL jq is required\n\nPASS: 0  FAIL: 1\n'; exit 1; }
[[ -f "$MAPPER" ]] || { printf '  FAIL docker/security-scan/lib/zap.jq is missing\n\nPASS: 0  FAIL: 1\n'; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/fresh" "$WORK/stale" "$WORK/empty" "$WORK/calls" "$WORK/bin"

# A report shaped like the one the pinned image writes: site[].alerts[] with instances[], riskdesc
# derived from riskcode, and the same alert seen on two URLs of the same page.
write_report() { # <file> <generated-at> — the second argument proves it does not reach a key
  cat > "$1" <<JSON
{
  "@version": "2.15.0",
  "@generated": "$2",
  "created": "$2",
  "site": [
    {
      "@name": "https://contest.example.com",
      "@host": "contest.example.com",
      "@port": "443",
      "alerts": [
        {"pluginid": "10020", "alertRef": "10020-1", "alert": "Missing Anti-clickjacking Header",
         "riskcode": "2", "riskdesc": "Medium (Medium)",
         "instances": [{"uri": "https://contest.example.com/login?a=1", "method": "GET"},
                       {"uri": "https://contest.example.com/login?a=2#frag", "method": "GET"},
                       {"uri": "https://CONTEST.Example.com/admin/", "method": "GET"}],
         "count": "3", "cweid": "1021"},
        {"pluginid": "10038", "alertRef": "10038", "alert": "Content Security Policy (CSP) Header Not Set",
         "riskcode": "2", "riskdesc": "Medium (High)",
         "instances": [{"uri": "https://contest.example.com/", "method": "GET"}]},
        {"pluginid": "10099", "alertRef": "10099", "alert": "Cookie without SameSite Attribute",
         "riskcode": "1", "riskdesc": "Low (Medium)",
         "instances": [{"uri": "https://contest.example.com/login", "method": "GET"}]},
        {"pluginid": "90004", "alertRef": "90004", "alert": "Server Leaks Version Information",
         "riskcode": "0", "riskdesc": "Informational (Medium)",
         "instances": [{"uri": "https://contest.example.com/", "method": "GET"}]},
        {"pluginid": "12345", "alertRef": "12345", "alert": "A rule ZAP started reporting last week",
         "riskcode": "9", "riskdesc": "Suspicious (Low)",
         "instances": [{"uri": "https://contest.example.com/", "method": "GET"}]},
        {"pluginid": "10063", "alertRef": "10063", "alert": "Permissions Policy Header Not Set",
         "riskcode": "3",
         "instances": [{"uri": "https://contest.example.com/static/app.js", "method": "GET"}]}
      ]
    }
  ]
}
JSON
}

write_report "$WORK/fresh/zap-baseline-1.json" "2026-11-20T02:20:11Z"
write_report "$WORK/stale/zap-baseline-1.json" "2026-11-18T02:20:11Z"
touch -d '3 days ago' "$WORK/stale/zap-baseline-1.json"

map_it() { jq -f "$MAPPER" "$1"; }
FRESH="$WORK/fresh/zap-baseline-1.json"

printf '\n== 1. every alert becomes a finding, nothing is dropped ==\n'
mapped="$WORK/mapped.json"
map_it "$FRESH" > "$mapped"
is "one row per alert and URL, after collapsing the duplicate /login" "7" "$(jq 'length' "$mapped")"
is "every plugin in the report is represented" \
  "10020 10038 10063 10099 12345 90004" \
  "$(jq -r '[.[].key | split("|")[0]] | unique | join(" ")' "$mapped")"
is "the contract fields are the only ones emitted" \
  "available detail host installed key kind severity subject title url" \
  "$(jq -r '.[0] | keys | join(" ")' "$mapped")"
is "installed and available are null — a header rule has no version" \
  "true" \
  "$(jq -r 'all(.[]; (.installed == null) and (.available == null))' "$mapped")"
is "the host is the scanned site, on every row" \
  "contest.example.com" \
  "$(jq -r '[.[].host] | unique | join(",")' "$mapped")"

printf '\n== 2. severities: ZAP words map to the contract, an unknown word becomes UNKNOWN ==\n'
sev() { jq -r --arg p "$1" --arg u "$2" '.[] | select(.key == ($p + "|" + $u)) | .severity' "$mapped"; }
S="https://contest.example.com"
is "Medium -> MEDIUM" "MEDIUM" "$(sev 10020 "$S/login")"
is "Informational -> LOW" "LOW" "$(sev 90004 "$S")"
is "Low -> LOW" "LOW" "$(sev 10099 "$S/login")"
is "a riskcode with no riskdesc (3) -> HIGH" "HIGH" "$(sev 10063 "$S/static/app.js")"
is "a word the contract does not have -> UNKNOWN, never dropped" "UNKNOWN" "$(sev 12345 "$S")"
is "no row carries a null severity (a null would read as 'no severity' in the panel)" \
  "0" "$(jq '[.[] | select(.severity == null)] | length' "$mapped")"
is "every severity is one of the panel's five" \
  "" "$(jq -r '.[] | select(.severity | IN("CRITICAL","HIGH","MEDIUM","LOW","UNKNOWN") | not) | .key' "$mapped")"

printf '\n== 3. the key is stable: query, fragment, case and a new run change nothing ==\n'
is "keys are pluginid|normalised url, sorted and deduplicated" \
  '10020|https://contest.example.com/admin
10020|https://contest.example.com/login
10038|https://contest.example.com
10063|https://contest.example.com/static/app.js
10099|https://contest.example.com/login
12345|https://contest.example.com
90004|https://contest.example.com' \
  "$(jq -r '[.[].key] | sort | join("\n")' "$mapped")"
# The same report regenerated: ZAP stamps @generated and created on every run.
write_report "$WORK/fresh/zap-baseline-2.json" "2026-11-21T02:20:44Z"
is "the same site scanned tomorrow produces the same keys" \
  "$(jq -r '[.[].key] | sort | join("\n")' "$mapped")" \
  "$(map_it "$WORK/fresh/zap-baseline-2.json" | jq -r '[.[].key] | sort | join("\n")')"
is "the duplicate /login instance is one row, not two" \
  "1" "$(jq '[.[] | select(.key == "10020|https://contest.example.com/login")] | length' "$mapped")"

printf '\n== 4. scan.sh dast reads the newest report and POSTs through feed_post ==\n'
cat > "$WORK/bin/curl" <<'STUB'
#!/bin/sh
data=""
while [ $# -gt 0 ]; do
  case "$1" in
    --data-binary) data="$2"; shift 2 ;;
    -o|-H|-w|-X|--max-time|--retry) shift 2 ;;
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
printf '%s' "${CURL_STUB_CODE:-201}"
STUB
chmod +x "$WORK/bin/curl"

run_dast() { # <log> <report-dir> — the real scan.sh, mode dast
  rm -f "$WORK/calls/calls" "$WORK/calls"/body-*.json
  ( set +e
    env PATH="$WORK/bin:$PATH" \
      SECURITY_SCAN_LIB="$REPO_ROOT/docker/security-scan/lib" \
      SECURITY_RUN_STARTED_AT="2026-11-20T03:00:00Z" \
      SECURITY_HOST="test-host" SECURITY_FEED_TOKEN="test-token" \
      PANEL_URL="http://127.0.0.1:9" WORK_DIR="$WORK/work" \
      DAST_REPORT_DIR="$2" CURL_STUB_DIR="$WORK/calls" CURL_STUB_CODE=201 \
      SCAN_STATUS_FILE="$WORK/status/scan-status.json" SCAN_STATUS_ROWS="$WORK/status/rows.jsonl" \
      sh "$SCAN" dast > "$WORK/$1.log" 2>&1
    echo $? > "$WORK/$1.rc" )
}

mkdir -p "$WORK/status"
run_dast fresh "$WORK/fresh"
body="$WORK/calls/body-1.json"
is "the run exits 0 on a fresh report" "0" "$(cat "$WORK/fresh.rc")"
is "one body was sent" "1" "$(cat "$WORK/calls/calls")"
is "the push names the dast source" "dast" "$(jq -r '.source' "$body")"
is "the push names the scanned site, not the box (resolution is host-scoped)" \
  "contest.example.com" "$(jq -r '.host' "$body")"
is "the push carries every mapped finding" "7" "$(jq -r '.findings | length' "$body")"
is "a fresh report is a complete run" "true" "$(jq -r '.complete' "$body")"
is "it claims nothing about kernel modules" "false" "$(jq -r 'has("host_modules")' "$body")"
is "the status row records the source and the acceptance" \
  "dast 7 true" "$(jq -r '"\(.sources[0].source) \(.sources[0].findings) \(.sources[0].complete)"' "$WORK/status/scan-status.json")"
is "the digest still names the box that ran the scan" \
  "test-host" "$(jq -r '.host' "$WORK/status/scan-status.json")"

printf '\n== 5. a report that is stale, empty or absent resolves nothing ==\n'
run_dast stale "$WORK/stale"
is "a report older than the window is not complete" "false" "$(jq -r '.complete' "$WORK/calls/body-1.json")"
is "a stale run exits non-zero for a manual operator" "1" "$(cat "$WORK/stale.rc")"
is "a stale run still records the fact" "dast" "$(jq -r '.sources[0].source' "$WORK/status/scan-status.json")"

run_dast empty "$WORK/empty"
is "with no report the push is empty and incomplete" \
  "0 false" "$(jq -r '"\(.findings | length) \(.complete)"' "$WORK/calls/body-1.json")"

printf '%s' '{"@version":"2.15.0","site":[]}' > "$WORK/empty/zap-baseline-1.json"
run_dast nohost "$WORK/empty"
is "a site list with no sites is a scan that never reached the target" \
  "false" "$(jq -r '.complete' "$WORK/calls/body-1.json")"

printf '\nPASS: %d  FAIL: %d\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
