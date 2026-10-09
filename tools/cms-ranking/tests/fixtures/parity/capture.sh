#!/usr/bin/env bash
# Capture the running Python ranking server's responses as the parity baseline.
#
# The Rust replacement is accepted only if it reproduces these bytes for the same
# seed data. The service must already be running: this script never starts a stack.

set -euo pipefail

readonly HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly BASE_URL="${RANKING_URL:-http://127.0.0.1:8890}"
OUT_DIR="${HERE}/captured/$(date +%Y%m%dT%H%M%S)"
readonly EVENTS_SECONDS="${EVENTS_SECONDS:-5}"

require_command() {
    command -v "$1" >/dev/null 2>&1 || {
        printf 'missing command: %s\n' "$1" >&2
        exit 1
    }
}

seed_rows() {
    python3 - "${HERE}/seed.json" <<'PY'
import json
import sys

seed = json.load(open(sys.argv[1], encoding="utf-8"))
for singular, dirname in seed["path_prefixes"].items():
    for key, body in seed["entities"][singular + "s"].items():
        print(f"{dirname}\t{key}\t{json.dumps(body, sort_keys=True)}")
PY
}

seed_store() {
    local dirname key body
    while IFS=$'\t' read -r dirname key body; do
        curl --fail-with-body --silent --show-error \
            --user "${RANKING_USER:?}:${RANKING_PASSWORD:?}" \
            --header 'Content-Type: application/json' \
            --request PUT --data "$body" \
            "${BASE_URL}/${dirname}/${key}" >/dev/null
    done < <(seed_rows)
}

capture_body() {
    local name="$1" path="$2"
    curl --silent --show-error --dump-header "${OUT_DIR}/${name}.headers" \
        --output "${OUT_DIR}/${name}.body" "${BASE_URL}${path}"
}

# The store keys are the host's own data, so read one back from the list body
# instead of guessing a key that may not exist.
capture_entity() {
    local list_name="$1" prefix="$2" target="$3" key
    key="$(python3 - "${OUT_DIR}/${list_name}.body" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        entities = json.load(handle)
except (OSError, ValueError):
    sys.exit(0)

if isinstance(entities, dict) and entities:
    print(next(iter(entities)))
PY
)"
    if [ -n "$key" ]; then
        capture_body "$target" "${prefix}${key}"
    fi
}

# Subscribe before the first write: the service replays only events a subscriber
# has not seen, so a stream opened after seeding would miss every seed event.
start_events() {
    timeout "${EVENTS_SECONDS}" curl --silent --no-buffer \
        --output "${OUT_DIR}/events.stream" "${BASE_URL}/events" &
    EVENTS_PID=$!
}

stop_events() {
    wait "${EVENTS_PID}" || true
}

docker_image() {
    command -v docker >/dev/null 2>&1 || return 1
    docker ps --filter 'name=cms-ranking-web-server' --format '{{.Image}}'
}

write_manifest() {
    local seed_sha=""
    if [ "$SEED" = 1 ] && [ -f "${HERE}/seed.json" ]; then
        seed_sha="$(sha256sum "${HERE}/seed.json" | cut -d' ' -f1)"
    fi
    {
        printf 'captured_at=%s\n' "$(date -Iseconds)"
        printf 'base_url=%s\n' "${BASE_URL}"
        printf 'seed_sha256=%s\n' "${seed_sha}"
        printf 'repo_head=%s\n' "$(git -C "${HERE}" rev-parse HEAD 2>/dev/null || printf 'unknown')"
        printf 'image=%s\n' "$(docker_image || printf 'unknown')"
    } >"${OUT_DIR}/MANIFEST.txt"
}

# The capture is read-only with --no-seed: nothing is written to the service, which is what
# makes it safe to run against a live deployment whose data is already the one to compare.
SEED=1
STDOUT_ONLY=0
for arg in "$@"; do
    case "$arg" in
        --no-seed) SEED=0 ;;
        --stdout) STDOUT_ONLY=1 ;;
        -h|--help) printf 'usage: capture.sh [--no-seed] [--stdout] [output-dir]\n'; exit 0 ;;
        *) OUT_DIR="$arg" ;;
    esac
done

# Everything to stdout and nothing left on disk: the output is meant to be pasted back,
# so the files exist only while this runs.
emit_stdout() {
    local body name
    for body in "${OUT_DIR}"/*.body; do
        [ -e "$body" ] || continue
        name="$(basename "$body" .body)"
        echo
        echo "===== $name (status + headers) ====="
        cat "${OUT_DIR}/${name}.headers" 2>/dev/null || true
        echo "===== $name (body) ====="
        cat "$body"
    done
    echo
    echo "===== events (first $EVENTS_SECONDS s) ====="
    cat "$OUT_DIR/events.stream" 2>/dev/null || true
    echo
    echo "===== manifest ====="
    cat "$OUT_DIR/MANIFEST.txt" 2>/dev/null || true
    echo
    echo "===== end of capture ====="
}

main() {
    require_command curl
    require_command python3
    mkdir -p "${OUT_DIR}"
    start_events
    if [ "$SEED" = 1 ]; then
        seed_store
    fi
    capture_body root /
    capture_body scores /scores
    capture_body history /history
    capture_body config /config
    capture_body credits /credits
    capture_body logo /logo
    capture_body users_list /users/
    capture_body contests_list /contests/
    capture_body tasks_list /tasks/
    capture_body teams_list /teams/
    capture_entity users_list /users/ user_one
    capture_entity contests_list /contests/ contest_one
    capture_entity tasks_list /tasks/ task_one
    capture_entity teams_list /teams/ team_one
    capture_entity users_list /face/ face
    capture_entity users_list /submissions/ submissions
    stop_events
    write_manifest
    if [ "$STDOUT_ONLY" = 1 ]; then
        emit_stdout
        rm -rf "$OUT_DIR"
    fi
    printf 'captured into %s\n' "${OUT_DIR}"
}

main "$@"
