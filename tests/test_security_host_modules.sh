#!/usr/bin/env bash
# tests/test_security_host_modules.sh — the host module state the rootfs scan reports.
#
# WHY this exists: the panel can only judge a kernel CVE's reachability from two facts about the
# box — what is loaded and what a modprobe rule refuses. The expensive mistake is a scanner that
# "helpfully" decides between them: on both production hosts ksmbd is blacklisted AND loaded, so a
# producer that subtracts blacklisted names from the loaded list makes a running subsystem look
# absent, and that suppression then has no owner. This suite pins the producer to reporting both
# lists, unmodified, and pins the envelope that carries them.

set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
LIB="${REPO_ROOT}/docker/security-scan/lib/host-modules.sh"
FEED_LIB="${REPO_ROOT}/docker/security-scan/lib/feed.sh"
SCAN="${REPO_ROOT}/docker/security-scan/scan.sh"

pass=0
fail=0
ok()  { printf '  ok   %s\n' "$1"; pass=$((pass + 1)); }
no()  { printf '  FAIL %s\n' "$1"; fail=$((fail + 1)); }

for dep in "$LIB" "$FEED_LIB" "$SCAN"; do
  if [[ ! -f "$dep" ]]; then
    printf '  FAIL %s is missing — nothing to check\n' "${dep#"$REPO_ROOT"/}"
    printf '\nPASS: 0  FAIL: 1\n'
    exit 1
  fi
done
for cmd in jq python3; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    printf '  FAIL %s is required\n' "$cmd"
    printf '\nPASS: 0  FAIL: 1\n'
    exit 1
  fi
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

RELEASE="6.12.9-1-cachyos"
ROOTFS="$WORK/rootfs"
mkdir -p "$ROOTFS/etc/modprobe.d" \
         "$ROOTFS/lib/modules/$RELEASE/kernel/fs/ksmbd" \
         "$ROOTFS/lib/modules/$RELEASE/kernel/fs/ceph" \
         "$ROOTFS/lib/modules/$RELEASE/kernel/net/wireless"
: > "$ROOTFS/lib/modules/$RELEASE/kernel/fs/ksmbd/ksmbd.ko"
: > "$ROOTFS/lib/modules/$RELEASE/kernel/fs/ceph/ceph.ko.zst"
: > "$ROOTFS/lib/modules/$RELEASE/kernel/net/wireless/cfg80211.ko"

# The production shape: ksmbd is blacklisted and loaded at the same time.
cat > "$ROOTFS/etc/modprobe.d/cms-blacklist.conf" <<'CONF'
# ksmbd is blacklisted here AND currently loaded on both hosts
blacklist ksmbd
blacklist ceph
install tipc /bin/true
# blacklist nfsd
install amdgpu /sbin/modprobe --ignore-install amdgpu
options f2fs checkpoint=disable
CONF
# Only *.conf files are modprobe configuration; this one must be read by nothing.
printf 'blacklist not-a-conf-file\n' > "$ROOTFS/etc/modprobe.d/legacy.rules"

# A /proc/modules fixture: the second field is the size, the last is the state.
cat > "$WORK/proc-modules" <<'PROC'
ksmbd 331776 0 - Live 0x0000000000000000
cifs 1234567 1 ksmbd, Live 0x0000000000000000
amdgpu 99999 2 - Live 0x0000000000000000
ksmbd 331776 0 - Live 0x0000000000000000
PROC

# hm CALL — run one lib function against the fixtures, in a shell with the lib's own `set -eu`.
hm() {
  PROC_MODULES="$WORK/proc-modules" HOST_MODULES_RELEASE="$RELEASE" \
    sh -c ". '$FEED_LIB'; . '$LIB'; $1"
}

printf '\nthe loaded set is /proc/modules, not the rootfs\n'
loaded="$(hm 'host_modules_loaded' | tr '\n' ' ')"
[[ "$loaded" == "amdgpu cifs ksmbd " ]] && ok "reads exactly the loaded names, sorted and deduplicated" \
                                        || no "host_modules_loaded returned '$loaded'"
if hm 'host_modules_loaded' | grep -qx 'ksmbd'; then
  ok "a blacklisted-but-loaded module is still in the loaded set (nothing subtracted it)"
else
  no "ksmbd is missing from the loaded set — a producer decided what the panel should decide"
fi
PROC_MODULES="$WORK/no-such-proc" sh -c ". '$FEED_LIB'; . '$LIB'; host_modules_loaded" >/dev/null 2>&1 \
  && no "an unreadable /proc/modules returned success — an empty list would claim 'nothing loaded'" \
  || ok "an unreadable /proc/modules is a failure, not an empty list"

printf '\nthe blocked set is the modprobe rules that refuse a load\n'
blocked="$(hm "host_modules_blocked '$ROOTFS'" | tr '\n' ' ')"
[[ "$blocked" == "ceph ksmbd tipc " ]] && ok "reads blacklist + install … /bin/true, and nothing else" \
                                       || no "host_modules_blocked returned '$blocked'"
if hm "host_modules_blocked '$ROOTFS'" | grep -qx 'ksmbd'; then
  ok "a blacklisted-but-loaded module is also in the blocked set (the panel decides, not the scanner)"
else
  no "ksmbd vanished from the blocked set — the record no longer describes the config file"
fi
for absent in nfsd f2fs amdgpu not-a-conf-file; do
  if hm "host_modules_blocked '$ROOTFS'" | grep -qx "$absent"; then
    no "$absent was read as blocked although its rule is not a blacklist/install /bin/true line"
  else
    ok "$absent is not in the blocked set"
  fi
done

printf '\na module on disk that is neither loaded nor blocked is absent, not blacklisted\n'
if hm "host_modules_present '$ROOTFS' '$RELEASE'" | grep -qx 'cfg80211'; then
  ok "the release tree names the modules it ships (.ko and .ko.zst)"
else
  no "host_modules_present did not see cfg80211 — the existence question is unanswered"
fi
if hm "host_modules_present '$ROOTFS' '9.9.9-none'" >/dev/null 2>&1; then
  no "a missing release directory answered success — 'no modules' is not the answer to 'unknown'"
else
  ok "a missing release directory is a failure"
fi
for list in loaded blocked; do
  if hm "host_modules_$list" 2>/dev/null | grep -qx 'cfg80211'; then
    no "cfg80211 reached the $list list; an unloaded, unruled module must be absent"
  fi
done
ok "an unloaded, unruled module appears in neither list (the panel reads it as absent)"

printf '\nthe pushed record is one object with both lists\n'
out="$WORK/host-modules.json"
if hm "host_modules_write '$ROOTFS' '$out'"; then
  ok "host_modules_write succeeds against a readable host"
else
  no "host_modules_write failed against a readable host"
fi
if [[ -f "$out" ]] && jq -e . "$out" >/dev/null 2>&1; then
  ok "the record is valid JSON"
else
  no "the record is missing or unparsable"
fi
[[ "$(jq -r '.kernel_release' "$out")" == "$RELEASE" ]] && ok "names the running release" \
                                                       || no "kernel_release is '$(jq -r '.kernel_release' "$out")'"
[[ "$(jq -c '.loaded' "$out")" == '["amdgpu","cifs","ksmbd"]' ]] && ok "carries the loaded list verbatim" \
                                                                 || no "loaded is $(jq -c '.loaded' "$out")"
[[ "$(jq -c '.blocked' "$out")" == '["ceph","ksmbd","tipc"]' ]] && ok "carries the blocked list" \
                                                               || no "blocked is $(jq -c '.blocked' "$out")"

missing_out="$WORK/host-modules-missing.json"
if PROC_MODULES="$WORK/no-such-proc" sh -c ". '$FEED_LIB'; . '$LIB'; host_modules_write '$ROOTFS' '$missing_out'" >/dev/null 2>&1; then
  no "host_modules_write succeeded without /proc/modules — an empty record would claim no modules"
else
  ok "no record is written when the loaded set cannot be read"
fi
[[ -f "$missing_out" ]] && no "a partial record was written anyway" || ok "no partial record was left behind"

no_tree_out="$WORK/host-modules-no-tree.json"
PROC_MODULES="$WORK/proc-modules" HOST_MODULES_RELEASE="9.9.9-none" \
  sh -c ". '$FEED_LIB'; . '$LIB'; host_modules_write '$ROOTFS' '$no_tree_out'" > "$WORK/no-tree.log" 2>&1
[[ "$(jq -r '.loaded | length' "$no_tree_out" 2>/dev/null)" == "3" ]] \
  && ok "a host with no module tree still reports its loaded set" \
  || no "a missing module tree dropped the loaded set — the two facts are independent"
grep -q 'absence is not verifiable' "$WORK/no-tree.log" \
  && ok "and says so, instead of implying nothing exists" \
  || no "the missing module tree was not reported"

printf '\nthe envelope carries it, and stays optional for every other producer\n'
cat > "$WORK/server.py" <<'PY'
import json, os, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

out_dir = sys.argv[1]
count = 0


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        global count
        count += 1
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        with open(os.path.join(out_dir, "req-%02d.json" % count), "wb") as fh:
            fh.write(body)
        payload = json.dumps({"success": True}).encode()
        self.send_response(201)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


HTTPServer(("127.0.0.1", int(sys.argv[2])), Handler).serve_forever()
PY

start_server() {
  mkdir -p "$WORK/req-$1"
  python3 "$WORK/server.py" "$WORK/req-$1" "$1" &
  SERVER_PID=$!
  for _ in $(seq 1 50); do
    if python3 - "$1" <<'PY'
import socket, sys
s = socket.socket()
s.settimeout(0.2)
try:
    s.connect(("127.0.0.1", int(sys.argv[1])))
    sys.exit(0)
except Exception:
    sys.exit(1)
PY
    then return 0; fi
    sleep 0.1
  done
  return 1
}

jq -n '[
  {key: "CVE-2026-1|ksmbd|6.12", kind: "os-package", subject: "ksmbd", severity: "HIGH"},
  {key: "CVE-2026-2|ceph|6.12", kind: "os-package", subject: "ceph", severity: "HIGH"},
  {key: "CVE-2026-3|f2fs|6.12", kind: "os-package", subject: "f2fs", severity: "MEDIUM"}
]' > "$WORK/findings.json"

run_feed() {
  local port="$1" modules="$2" budget="$3"
  ( set +e
    SECURITY_RUN_STARTED_AT="2026-11-10T10:00:00Z" PANEL_URL="http://127.0.0.1:$port" \
    SECURITY_FEED_TOKEN="test-token" SECURITY_HOST="box-a" \
    FEED_HOST_MODULES_FILE="$modules" FEED_BATCH_BYTES="$budget" \
      sh -c ". '$FEED_LIB'; feed_post rootfs '$WORK/findings.json' true" > "$WORK/feed-$port.log" 2>&1
    echo $? > "$WORK/feed-$port.rc" )
}

printf '\n  one batch\n'
if start_server 18811; then
  run_feed 18811 "$out" 900000
  kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null
  body="$(find "$WORK/req-18811" -name 'req-*.json' | head -1)"
  [[ "$(cat "$WORK/feed-18811.rc")" == "0" ]] && ok "the push is accepted" || no "feed_post exited $(cat "$WORK/feed-18811.rc")"
  [[ "$(jq -c '.host_modules.loaded' "$body")" == '["amdgpu","cifs","ksmbd"]' ]] \
    && ok "the body carries the loaded list" || no "the body carried $(jq -c '.host_modules' "$body")"
  [[ "$(jq -r '.host_modules.kernel_release' "$body")" == "$RELEASE" ]] \
    && ok "the body names the release the lists came from" || no "kernel_release is missing from the body"
  [[ "$(jq '.findings | length' "$body")" == "3" ]] && ok "the findings are still in the same body" \
                                                    || no "the findings were dropped from the body"
else
  no "the capture server did not start"
fi

printf '\n  a full module list\n'
if start_server 18814; then
  # 4000 names is the route's per-list cap: passed on the command line it would exceed the kernel's
  # per-argument limit and the batch would be lost with `jq: Argument list too long`, so the lib
  # hands the record to jq as a file.
  jq -n '{kernel_release: "6.12.9-1-cachyos",
          loaded: [range(4000) | "mod" + (. | tostring)],
          blocked: [range(200) | "blocked" + (. | tostring)]}' > "$WORK/big-modules.json"
  run_feed 18814 "$WORK/big-modules.json" 900000
  kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null
  body="$(find "$WORK/req-18814" -name 'req-*.json' | head -1)"
  [[ "$(cat "$WORK/feed-18814.rc")" == "0" ]] && ok "a 4000-name record is accepted" \
                                             || no "a 4000-name record failed (exit $(cat "$WORK/feed-18814.rc"))"
  [[ "$(jq '.host_modules.loaded | length' "$body" 2>/dev/null)" == "4000" ]] \
    && ok "all 4000 names arrived" || no "the body carried $(jq '.host_modules.loaded | length' "$body" 2>/dev/null) names"
else
  no "the capture server did not start"
fi

printf '\n  no module file\n'
if start_server 18812; then
  run_feed 18812 "" 900000
  kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null
  body="$(find "$WORK/req-18812" -name 'req-*.json' | head -1)"
  if [[ "$(jq 'has("host_modules")' "$body")" == "false" ]]; then
    ok "a producer with no module state sends no host_modules key at all"
  else
    no "the body invented a host_modules field: $(jq -c '.host_modules' "$body")"
  fi
else
  no "the capture server did not start"
fi

printf '\n  several batches\n'
if start_server 18813; then
  # A one-byte budget makes every finding its own body, which is the only way to see which batch
  # carries the record without inventing a 900 KB fixture.
  run_feed 18813 "$out" 1
  kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null
  reqs=$(find "$WORK/req-18813" -name 'req-*.json' | wc -l | tr -d ' ')
  [[ "$reqs" -ge 3 ]] && ok "the set was split into $reqs bodies" || no "only $reqs body was sent"
  carrying=$(find "$WORK/req-18813" -name 'req-*.json' -exec jq -r 'select(has("host_modules")) | 1' {} + | wc -l | tr -d ' ')
  [[ "$carrying" == "1" ]] && ok "exactly one body carries the module record" \
                           || no "$carrying bodies carry it — it is one snapshot per run"
  last="$(find "$WORK/req-18813" -name 'req-*.json' | sort | tail -1)"
  [[ "$(jq 'has("host_modules")' "$last")" == "true" ]] \
    && ok "the last body — the one claiming complete — is the one carrying it" \
    || no "an earlier body carried it and the completing one did not"
else
  no "the capture server did not start"
fi

printf '\nrootfs mode wires it into the push\n'
if grep -v '^[[:space:]]*#' "$SCAN" | grep -q 'host_modules_write "\$ROOTFS_DIR"'; then
  ok "rootfs mode writes the record before it pushes"
else
  no "scan.sh never calls host_modules_write — the field would never be sent"
fi
if grep -v '^[[:space:]]*#' "$SCAN" | grep -q 'FEED_HOST_MODULES_FILE="\$modules"'; then
  ok "rootfs mode hands the record to the envelope"
else
  no "scan.sh does not set FEED_HOST_MODULES_FILE — the record is written and dropped"
fi
if grep -q 'host-modules.sh' "${REPO_ROOT}/docker/security-scan/Dockerfile"; then
  ok "the image copies host-modules.sh to the lib directory scan.sh sources"
else
  no "host-modules.sh is not in the image — the source line would fail at runtime"
fi

printf '\nPASS: %d  FAIL: %d\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
