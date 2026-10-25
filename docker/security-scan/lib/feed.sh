#!/bin/sh
# feed.sh — the ONE place the security feed envelope is built and POSTed.
#
# WHY this is a library and not three curl lines: docs/SECURITY-FEED.md fixes the body as
# {source, host, findings[], complete} for every producer. Duplicating that envelope in the
# trivy path, the osv path and the Diun translator is how one of them silently drifts from
# the contract. Every producer in this image ends here.
#
# Contract fields owned by this file: source, host, complete, run_started_at, the auth header and
# the batch size. Per-source shapes live in *.jq beside it and nowhere else.
#
# WHY run_started_at: a complete push resolves the rows this run did not see, and a run can be
# several pushes (a 34,606-finding host scan is 139 of them). The panel cannot tell "not seen by
# this run" from "sent in an earlier batch" without the instant the run began, so the producer
# sends it with every batch and the panel resolves only rows last seen before it.
set -eu

feed_log() { printf '%s security-feed: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }

# The panel shows this in the findings' host column. SECURITY_HOST is set per deployment
# (.env.security); the container hostname is only a fallback so a hand-run never sends "".
feed_host() {
    if [ -n "${SECURITY_HOST:-}" ]; then
        printf '%s' "$SECURITY_HOST"
    else
        hostname 2>/dev/null || printf 'unknown'
    fi
}

# The instant this run began, computed once however many batches follow. SECURITY_RUN_STARTED_AT
# lets scan.sh stamp one run across several modes; the fallback is this process's own start.
if [ -z "${SECURITY_RUN_STARTED_AT:-}" ]; then
    SECURITY_RUN_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
fi

# feed_post SOURCE FINDINGS_FILE COMPLETE
#   SOURCE   diun | rootfs | osv (the contract's enum — never anything else)
#   FINDINGS a JSON array produced by one of the *.jq mappers
#   COMPLETE "true" only when the producer knows it reported its full current set
feed_post() {
    _source="$1"
    _file="$2"
    _complete="$3"
    _url="${PANEL_URL:-http://admin-panel-next:3000}/api/security/findings"
    _token="${SECURITY_FEED_TOKEN:-}"

    # WHY refuse instead of sending: the route answers 401, and a silent 401 in a nightly
    # container looks exactly like a healthy feed. Fail loudly at the producer.
    if [ -z "$_token" ]; then
        feed_log "SECURITY_FEED_TOKEN is empty — not POSTing $_source (the route would answer 401)"
        return 1
    fi

    _count=$(jq 'length' "$_file")

    # WHY chunking instead of a hard cap: the route's body limit is 1 MB, and one finding is
    # roughly half a kilobyte — so even 2000 findings overflow it, and the earlier "cap at 2000"
    # produced a 413 on the first real host, which meant NOTHING was recorded. The set is split
    # into batches that fit; `complete` rides only on the last one, so the route can resolve the
    # omitted rows exactly when it has actually seen them all. A batch that fails aborts the
    # whole push and still claims nothing.
    _batch=250
    _seen=0
    _total=$_count
    _remaining=$_count
    _n=0

    if [ "$_count" -eq 0 ]; then
        _body=$(jq -c --arg source "$_source" --arg host "$(feed_host)" --argjson complete "$_complete" \
            --arg run "$SECURITY_RUN_STARTED_AT" \
            '{source: $source, host: $host, findings: ., complete: $complete, run_started_at: $run}' "$_file")
        _code=$(printf '%s' "$_body" | curl -sS --max-time 60 --retry 3 --retry-connrefused \
            -o /dev/null -w '%{http_code}' -X POST \
            -H "Authorization: Bearer ${_token}" -H 'Content-Type: application/json' \
            --data-binary @- "$_url") || _code=000
        case "$_code" in
            2*) feed_log "POST $_url accepted 0 findings (source=$_source, complete=$_complete) → HTTP $_code"; return 0 ;;
            *)  feed_log "POST $_url FAILED → HTTP $_code"; return 1 ;;
        esac
    fi

    _batches=$(( (_count + _batch - 1) / _batch ))
    [ "$_batches" -gt 1 ] && feed_log "$_source: $_count findings exceed one body, sending $_batches batches of $_batch"

    while [ "$_remaining" -gt 0 ]; do
        _n=$((_n + 1))
        # The last batch carries the producer's completeness claim; every earlier one must not.
        if [ "$_n" -eq "$_batches" ]; then _claim="$_complete"; else _claim=false; fi

        _body=$(jq -c \
            --arg source "$_source" \
            --arg host "$(feed_host)" \
            --argjson complete "$_claim" \
            --argjson off "$_seen" \
            --argjson lim "$_batch" \
            --arg run "$SECURITY_RUN_STARTED_AT" \
            '{source: $source, host: $host, findings: (.[$off:$off + $lim]), complete: $complete, run_started_at: $run}' "$_file")

        _size=$(printf '%s' "$_body" | wc -c | tr -d ' ')
        _resp=$(mktemp)
        _code=$(printf '%s' "$_body" | curl -sS --max-time 120 --retry 3 --retry-connrefused \
            -o "$_resp" -w '%{http_code}' \
            -X POST \
            -H "Authorization: Bearer ${_token}" \
            -H 'Content-Type: application/json' \
            --data-binary @- "$_url") || _code=000

        case "$_code" in
            2*)
                feed_log "POST $_url accepted batch $_n/$_batches ($_batch or fewer findings, ${_size} bytes, source=$_source, complete=$_claim) → HTTP $_code"
                rm -f "$_resp"
                ;;
            *)
                feed_log "POST $_url FAILED on batch $_n/$_batches → HTTP $_code: $(head -c 400 "$_resp" 2>/dev/null || true)"
                feed_log "$_source: $_seen of $_total findings were accepted before the failure; the run claims nothing"
                rm -f "$_resp"
                return 1
                ;;
        esac

        _seen=$((_seen + _batch))
        _remaining=$((_remaining - _batch))
        [ "$_remaining" -lt 0 ] && _remaining=0
    done

    feed_log "$_source: all $_total findings accepted in $_batches batch(es), complete=$_complete"
    return 0
}
