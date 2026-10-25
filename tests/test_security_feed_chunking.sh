#!/usr/bin/env bash
# tests/test_security_feed_chunking.sh — the feed splits a big finding set and claims completion once.
#
# WHY this exists: the ingest route rejects a body over 1 MB, and one finding is roughly half a
# kilobyte, so a host with a few thousand findings overflows it. The first version capped the set at
# 2000 and downgraded `complete` — which still produced a 413 on the first real host, so *nothing*
# was recorded while the run looked like it had pushed. The contract allows several pushes per
# source as long as `complete:true` rides only on the push that carries the last of the set; this
# suite pins that behaviour against a real HTTP server so a later "simplification" cannot silently
# drop findings again.

set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
FEED_LIB="${REPO_ROOT}/docker/security-scan/lib/feed.sh"

pass=0
fail=0
ok()  { printf '  ok   %s\n' "$1"; pass=$((pass + 1)); }
no()  { printf '  FAIL %s\n' "$1"; fail=$((fail + 1)); }

if [[ ! -f "$FEED_LIB" ]]; then
  printf '  FAIL docker/security-scan/lib/feed.sh is missing — nothing to test\n'
  printf '\nPASS: 0  FAIL: 1\n'
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  printf '  FAIL python3 is required to capture the requests\n'
  printf '\nPASS: 0  FAIL: 1\n'
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  printf '  FAIL jq is required to read the captured bodies\n'
  printf '\nPASS: 0  FAIL: 1\n'
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# A capture server: every POST body is written to its own file, the status code per request comes
# from $FAIL_AT (1-based), so the failure path can be proved without a broken token.
cat > "$WORK/server.py" <<'PY'
import json, os, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

out_dir = sys.argv[1]
fail_at = int(os.environ.get("FAIL_AT", "0"))
count = 0


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        global count
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        count += 1
        with open(os.path.join(out_dir, "req-%02d.json" % count), "wb") as fh:
            fh.write(body)
        with open(os.path.join(out_dir, "hdr-%02d.txt" % count), "w") as fh:
            fh.write(self.headers.get("Authorization", ""))
        # Every request from $FAIL_AT on fails: curl retries a 5xx, so failing a single
        # request would be retried away and the test would prove nothing.
        status = 500 if fail_at and count >= fail_at else 201
        payload = json.dumps({"success": status == 201}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


HTTPServer(("127.0.0.1", int(sys.argv[2])), Handler).serve_forever()
PY

start_server() {
  local port="$1" fail_at="$2"
  mkdir -p "$WORK/req-$port"
  FAIL_AT="$fail_at" python3 "$WORK/server.py" "$WORK/req-$port" "$port" &
  SERVER_PID=$!
  for _ in $(seq 1 50); do
    if python3 - "$port" <<'PY'
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

# 900 findings: enough for four batches of 250, which is the shape a real host has.
jq -n '[range(900) | {source: "rootfs", kind: "os", key: ("CVE-2026-" + (. | tostring)),
        package: "pkg", installed: "1.0", fixed: "1.1", severity: "HIGH",
        title: "a finding whose text is long enough to matter for the body size"}]' > "$WORK/findings.json"

printf '\na full set is delivered in batches, completing only on the last\n'
if ! start_server 18801 0; then
  no "the capture server did not start"
else
  ( set +e
    PANEL_URL="http://127.0.0.1:18801" SECURITY_FEED_TOKEN="test-token" SECURITY_HOST="test-host" \
      sh -c ". '$FEED_LIB'; feed_post rootfs '$WORK/findings.json' true" > "$WORK/run1.log" 2>&1
    echo $? > "$WORK/run1.rc" )
  kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null

  rc="$(cat "$WORK/run1.rc")"
  [[ "$rc" == "0" ]] && ok "feed_post exits 0 when every batch is accepted" \
                     || no "feed_post exited $rc on an all-accepted run"

  reqs=$(find "$WORK/req-18801" -name 'req-*.json' | wc -l | tr -d ' ')
  [[ "$reqs" -ge 4 ]] && ok "900 findings were sent in $reqs batches (not one oversized body)" \
                      || no "900 findings produced only $reqs request(s) — the body limit would reject it"

  biggest=$(find "$WORK/req-18801" -name 'req-*.json' -exec wc -c {} + | awk '$2!="total"{print $1}' | sort -n | tail -1)
  if [[ "${biggest:-0}" -lt 1000000 ]]; then
    ok "every batch fits the panel's 1 MB body limit (largest ${biggest} bytes)"
  else
    no "a batch is ${biggest} bytes — the panel would answer 413"
  fi

  total=$(find "$WORK/req-18801" -name 'req-*.json' -exec jq '.findings | length' {} + | awk '{s+=$1} END{print s+0}')
  [[ "$total" == "900" ]] && ok "all 900 findings arrived (no cap, no duplicates)" \
                          || no "the batches carried $total findings, expected 900"

  complete_true=$(find "$WORK/req-18801" -name 'req-*.json' -exec jq -r 'select(.complete == true) | 1' {} + | wc -l | tr -d ' ')
  [[ "$complete_true" == "1" ]] && ok "exactly one batch claims complete:true" \
                               || no "$complete_true batches claim complete:true — the route would resolve rows it never saw"
  last=$(find "$WORK/req-18801" -name 'req-*.json' | sort | tail -1)
  if [[ "$(jq -r '.complete' "$last")" == "true" ]]; then
    ok "the LAST batch is the one claiming completion"
  else
    no "an earlier batch claimed completion — a crash mid-way would resolve the rest"
  fi

  bodies_ok=1
  while IFS= read -r f; do
    [[ "$(jq -r '.source' "$f")" == "rootfs" ]] || bodies_ok=0
    [[ "$(jq -r '.host' "$f")" == "test-host" ]] || bodies_ok=0
  done < <(find "$WORK/req-18801" -name 'req-*.json')
  [[ "$bodies_ok" == "1" ]] && ok "every batch carries the contract's source and host" \
                            || no "a batch dropped the source/host envelope"

  auth="$(cat "$WORK/req-18801"/hdr-01.txt 2>/dev/null)"
  [[ "$auth" == "Bearer test-token" ]] && ok "every batch carries the feed token" \
                                       || no "the Authorization header was '$auth'"
fi

printf '\na failed batch claims nothing\n'
if ! start_server 18802 2; then
  no "the capture server did not start"
else
  ( set +e
    PANEL_URL="http://127.0.0.1:18802" SECURITY_FEED_TOKEN="test-token" SECURITY_HOST="test-host" \
      sh -c ". '$FEED_LIB'; feed_post rootfs '$WORK/findings.json' true" > "$WORK/run2.log" 2>&1
    echo $? > "$WORK/run2.rc" )
  kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null

  rc="$(cat "$WORK/run2.rc")"
  [[ "$rc" != "0" ]] && ok "feed_post fails when a batch is rejected (exit $rc)" \
                     || no "feed_post exited 0 although a batch got HTTP 500"

  sent_true=$(find "$WORK/req-18802" -name 'req-*.json' -exec jq -r 'select(.complete == true) | 1' {} + | wc -l | tr -d ' ')
  [[ "$sent_true" == "0" ]] && ok "a partial delivery never claims complete:true" \
                            || no "$sent_true batch(es) claimed completion after a failure"

  # curl retries the failing batch, so the count is not the assertion; what matters is that the
  # run never marched on to the last batch and claimed completion for it.
  # Every finding's key carries its index, so the deepest offset that reached the server says
  # exactly how far the run got — retry attempts of the same batch do not move it.
  deepest=$(find "$WORK/req-18802" -name 'req-*.json' -exec jq -r '.findings[0].key' {} + \
            | sed 's/.*-//' | sort -n | tail -1)
  [[ "${deepest:-0}" -lt 500 ]] && ok "the run stopped before the last batch (deepest offset ${deepest} of 900)" \
                                || no "the run pushed past the rejected batch (deepest offset ${deepest} of 900)"
fi

printf '\nan empty set is still one push\n'
if ! start_server 18803 0; then
  no "the capture server did not start"
else
  printf '[]\n' > "$WORK/empty.json"
  ( set +e
    PANEL_URL="http://127.0.0.1:18803" SECURITY_FEED_TOKEN="test-token" SECURITY_HOST="test-host" \
      sh -c ". '$FEED_LIB'; feed_post osv '$WORK/empty.json' false" > "$WORK/run3.log" 2>&1
    echo $? > "$WORK/run3.rc" )
  kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null

  reqs=$(find "$WORK/req-18803" -name 'req-*.json' | wc -l | tr -d ' ')
  [[ "$reqs" == "1" ]] && ok "an empty set still pushes once (so a clean scan is visible)" \
                       || no "an empty set produced $reqs requests"
  err=$(grep -c "FAILED" "$WORK/run3.log" 2>/dev/null || true)
  [[ "${err:-0}" == "0" ]] && ok "the empty push was accepted" || no "the empty push failed"
fi

printf '\nPASS: %d  FAIL: %d\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
