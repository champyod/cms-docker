#!/bin/sh
# feed.sh — the one place the feed envelope is built and POSTed.
set -eu

feed_log() { printf '%s security-feed: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }

# SECURITY_HOST is set per deployment; the hostname only keeps a hand-run from sending an empty host.
feed_host() {
    if [ -n "${SECURITY_HOST:-}" ]; then
        printf '%s' "$SECURITY_HOST"
    else
        hostname 2>/dev/null || printf 'unknown'
    fi
}

# The run's start instant, computed once for every batch that follows.
if [ -z "${SECURITY_RUN_STARTED_AT:-}" ]; then
    SECURITY_RUN_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
fi

# host_modules: a path to the rootfs mode's record; empty means this push claims nothing about the kernel.
FEED_HOST_MODULES_FILE="${FEED_HOST_MODULES_FILE:-}"

# feed_body SOURCE HOST COMPLETE MODULES_FILE — one envelope on stdout, findings on stdin, because 400 findings on argv die with "Argument list too long".
feed_body() {
    _mods="$4"
    if [ -z "$_mods" ] || [ ! -f "$_mods" ]; then _mods=/dev/null; fi
    jq -c \
        --arg source "$1" \
        --arg host "$2" \
        --argjson complete "$3" \
        --arg run "$SECURITY_RUN_STARTED_AT" \
        --slurpfile modules "$_mods" \
        '{source: $source, host: $host, findings: ., complete: $complete, run_started_at: $run}
         + (if $modules[0] == null then {} else {host_modules: $modules[0]} end)'
}

# feed_post SOURCE FINDINGS_FILE COMPLETE — one push, in batches that fit the route's body cap.
# FEED_LAST_* carries the tally out: accepted findings, bodies sent, bodies planned, bodies the panel refused.
feed_post() {
    _source="$1"
    _file="$2"
    _complete="$3"
    _url="${PANEL_URL:-http://admin-panel-next:3000}/api/security/findings"
    _token="${SECURITY_FEED_TOKEN:-}"

    # Reset here, not at the caller: a source that inherits the previous one's tally reports batches it never sent.
    FEED_LAST_ACCEPTED=0
    # Rows the panel took that name a fixed version; only accepted batches count, exactly like findings.
    FEED_LAST_FIXABLE=0
    FEED_LAST_BATCHES_SENT=0
    FEED_LAST_BATCHES_TOTAL=0
    FEED_LAST_BATCHES_REJECTED=0
    FEED_LAST_COMPLETE=false

    # WHY refuse instead of sending: the route answers 401, and a silent 401 in a nightly container looks exactly like
    if [ -z "$_token" ]; then
        feed_log "SECURITY_FEED_TOKEN is empty — not POSTing $_source (the route would answer 401)"
        return 1
    fi

    _count=$(jq 'length' "$_file")

    # Validated once, so a malformed record costs the module facts and never the batch: /dev/null slurps as [], read as "no claim".
    _mods=""
    if [ -n "$FEED_HOST_MODULES_FILE" ] && [ -f "$FEED_HOST_MODULES_FILE" ] \
       && jq -e . "$FEED_HOST_MODULES_FILE" >/dev/null 2>&1; then
        _mods="$FEED_HOST_MODULES_FILE"
    fi

    # WHY chunking instead of a hard cap: the route's body limit is 1 MB, and one finding is roughly half a kilobyte 
    _batch=250
    _budget=${FEED_BATCH_BYTES:-900000}
    _limit=1000000

    # An empty set is still one push: a clean scan has to be visible in the panel, and a producer that sends nothing at
    if [ "$_count" -eq 0 ]; then
        _body=$(feed_body "$_source" "$(feed_host)" "$_complete" "$_mods" < "$_file")
        _code=$(printf '%s' "$_body" | curl -sS --max-time 60 --retry 3 --retry-connrefused \
            -o /dev/null -w '%{http_code}' -X POST \
            -H "Authorization: Bearer ${_token}" -H 'Content-Type: application/json' \
            --data-binary @- "$_url") || _code=000
        FEED_LAST_BATCHES_TOTAL=1
        case "$_code" in
            2*) FEED_LAST_BATCHES_SENT=1
                FEED_LAST_COMPLETE="$_complete"
                feed_log "POST $_url accepted 0 findings (source=$_source, complete=$_complete) → HTTP $_code"
                return 0 ;;
            *)  FEED_LAST_BATCHES_REJECTED=1
                feed_log "POST $_url FAILED → HTTP $_code"
                return 1 ;;
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
        # Only the last batch carries it: one snapshot per run, and that batch already speaks for the run.
        _batch_modules=""
        if [ "$_n" -eq "$_batches" ]; then _batch_modules="$_mods"; fi
        printf '%s' "$_chunk" | feed_body "$_source" "$(feed_host)" "$_claim" "$_batch_modules" > "$_req"
        _size=$(wc -c < "$_req" | tr -d ' ')

        # WHY refuse instead of sending: one record larger than the panel's body cap cannot go in any body, and cutting it
        if [ "$_size" -gt "$_limit" ]; then
            feed_log "$_source: one finding serializes to $_size bytes, over the panel's $_limit-byte body limit and cannot be split — nothing more is sent"
            # Sent-vs-planned is the shortfall; nothing was refused, so rejected stays 0.
            FEED_LAST_BATCHES_TOTAL="$_batches"
            FEED_LAST_BATCHES_SENT=$((_n - 1))
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
                FEED_LAST_ACCEPTED="$_seen"
                FEED_LAST_BATCHES_TOTAL="$_batches"
                FEED_LAST_BATCHES_SENT=$((_n - 1))
                FEED_LAST_BATCHES_REJECTED=1
                rm -f "$_resp" "$_plan"
                return 1
                ;;
        esac

        _seen=$((_seen + $(printf '%s' "$_chunk" | jq 'length')))
        # `available` is the panel's own "a fix exists" field; a row without one is not fixable.
        _fixed=$(printf '%s' "$_chunk" | jq '[.[] | select(.available != null)] | length') || _fixed=0
        case "$_fixed" in '' | *[!0-9]*) _fixed=0 ;; esac
        FEED_LAST_FIXABLE=$((FEED_LAST_FIXABLE + _fixed))
    done < "$_plan"

    rm -f "$_plan"
    FEED_LAST_ACCEPTED="$_total"
    FEED_LAST_BATCHES_TOTAL="$_batches"
    FEED_LAST_BATCHES_SENT="$_batches"
    FEED_LAST_COMPLETE="$_complete"
    feed_log "$_source: all $_total findings accepted in $_batches batch(es), complete=$_complete"
    return 0
}
