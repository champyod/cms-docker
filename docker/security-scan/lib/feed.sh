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
    # Two ceilings, because either one alone loses findings. The record cap keeps a batch small
    # enough to retry inside the route's 2000-finding limit; the BYTE cap is the route's own body
    # limit (MAX_BODY_BYTES = 1,000,000), and a 250-record batch of 5 KB findings is 1.25 MB — a
    # body the panel refuses before it parses a single finding.
    #
    # WHY the boundary is always between two records: the packer measures each record's serialized
    # size in BYTES (`tojson | utf8bytelength`, not `length` in characters) and only ever starts a
    # new batch *after* a whole record. Slicing the serialized body at a byte offset — `head -c`,
    # `cut -b`, "split this JSON at N bytes" — cuts a finding in half and cuts a 3-byte UTF-8
    # character into bytes that are no longer text, which arrives at the route as 422 "Body is not
    # valid JSON" with no finding stored and no clue which record was at the cut.
    _batch=250
    _budget=${FEED_BATCH_BYTES:-900000}
    _limit=1000000

    # An empty set is still one push: a clean scan has to be visible in the panel, and a producer
    # that sends nothing at all looks exactly like one that is broken.
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

    # _pack FILE BUDGET — one JSON array per line: whole records, input order, both ceilings met.
    _pack() {
        jq -c --argjson records "$_batch" --argjson budget "$2" '
            def pack($records; $budget):
                reduce .[] as $record (
                    { done: [], batch: [], bytes: 0 };
                    ($record | tojson | utf8bytelength) as $size
                    | if ((.batch | length) >= $records)
                         or ((.batch | length) > 0 and (.bytes + 1 + $size) > $budget)
                      then .done += [.batch] | .batch = [$record] | .bytes = $size
                      else .batch += [$record]
                           | .bytes = (.bytes + $size
                                       + (if (.batch | length) > 1 then 1 else 0 end))
                      end)
                | .done + (if (.batch | length) > 0 then [.batch] else [] end);
            pack($records; $budget) | .[]
        ' "$1"
    }

    _plan=$(mktemp)
    _pack "$_file" "$_budget" > "$_plan"
    _batches=$(wc -l < "$_plan" | tr -d ' ')
    [ "$_batches" -gt 1 ] && feed_log "$_source: $_count findings need $_batches bodies (at most $_batch records and $_budget bytes each)"

    _n=0
    _seen=0
    _total=$_count

    while IFS= read -r _chunk; do
        _n=$((_n + 1))
        # The last batch carries the producer's completeness claim; every earlier one must not.
        if [ "$_n" -eq "$_batches" ]; then _claim="$_complete"; else _claim=false; fi

        _req=$(mktemp)
        printf '%s' "$_chunk" | jq -c \
            --arg source "$_source" \
            --arg host "$(feed_host)" \
            --argjson complete "$_claim" \
            --arg run "$SECURITY_RUN_STARTED_AT" \
            '{source: $source, host: $host, findings: ., complete: $complete, run_started_at: $run}' \
            > "$_req"
        _size=$(wc -c < "$_req" | tr -d ' ')

        # WHY refuse instead of sending: one record larger than the panel's body cap cannot go in
        # any body, and cutting it is exactly what produces the 422 this file exists to prevent.
        # Stopping here also keeps `complete` off the wire, so the failure resolves nothing.
        if [ "$_size" -gt "$_limit" ]; then
            feed_log "$_source: one finding serializes to $_size bytes, over the panel's $_limit-byte body limit and cannot be split — nothing more is sent"
            rm -f "$_req" "$_plan"
            return 1
        fi

        _resp=$(mktemp)
        _code=$(curl -sS --max-time 120 --retry 3 --retry-connrefused \
            -o "$_resp" -w '%{http_code}' \
            -X POST \
            -H "Authorization: Bearer ${_token}" \
            -H 'Content-Type: application/json' \
            --data-binary "@$_req" "$_url") || _code=000
        rm -f "$_req"

        case "$_code" in
            2*)
                feed_log "POST $_url accepted batch $_n/$_batches (${_size} bytes, source=$_source, complete=$_claim) → HTTP $_code"
                rm -f "$_resp"
                ;;
            *)
                feed_log "POST $_url FAILED on batch $_n/$_batches → HTTP $_code: $(head -c 400 "$_resp" 2>/dev/null || true)"
                feed_log "$_source: $_seen of $_total findings were accepted before the failure; the run claims nothing"
                rm -f "$_resp" "$_plan"
                return 1
                ;;
        esac

        _seen=$((_seen + $(printf '%s' "$_chunk" | jq 'length')))
    done < "$_plan"

    rm -f "$_plan"
    feed_log "$_source: all $_total findings accepted in $_batches batch(es), complete=$_complete"
    return 0
}
