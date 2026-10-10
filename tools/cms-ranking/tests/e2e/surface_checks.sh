#!/usr/bin/env bash
# Surface checks the first rehearsal never reached: the entity reads, the public
# config and credits, the image fallbacks, and the framing the Python service
# enforced. Sourced by ranking_e2e.sh, so it defines functions only and reads the
# WORK, PARITY, LOG, BASE and pass/fail helpers its caller already set.
#
# Every expectation is taken from tests/fixtures/parity/captured, which is the only
# trustworthy contract: the deployed image is newer than any checkout, so the Python
# source describes a service that is no longer running.
#
# The checks run as `python3 -c '…' || fail` on one logical line rather than a
# heredoc, because a heredoc whose command ends in `||` leaves the shell guessing
# which of the two bodies the following lines belong to.

# The header a route does or does not carry, without failing the script on a miss.
request_has_header() {
  curl -sS -D - -o /dev/null "${BASE}$1" | grep -qi "^$2:"
}

entity_reads_match_the_captures() {
  curl -fsS "${BASE}/users/" >"${WORK}/users.json"
  curl -fsS "${BASE}/contests/" >"${WORK}/contests.json"
  curl -fsS "${BASE}/tasks/" >"${WORK}/tasks.json"
  python3 -c '
import json, sys
for served, captured in ((sys.argv[1], sys.argv[2]), (sys.argv[3], sys.argv[4])):
    if json.load(open(served)) != json.load(open(captured)):
        raise SystemExit(served + " does not carry the values captured from Python")
' "${WORK}/users.json" "${PARITY}/captured/users_list.json" \
    "${WORK}/contests.json" "${PARITY}/captured/contests_list.json" ||
    fail "an entity list does not match the captured Python values"
  pass "the entity lists are objects keyed by key with the captured values"
}

task_single_keeps_the_python_byte_style() {
  local key
  key="$(python3 -c "import json,sys;d=json.load(open('${WORK}/tasks.json'));print(next(k for k,v in d.items() if v.get('short_name')=='aplusb'))")" ||
    fail "the fixture task aplusb is missing from /tasks/"
  curl -fsS "${BASE}/tasks/${key}" >"${WORK}/task_one.json"
  python3 -c '
import json, sys
served = open(sys.argv[1]).read()
if "100.0" not in served:
    raise SystemExit("max_score lost the Python float spelling: " + served)
if "\", \"" not in served or "\": \"" not in served:
    raise SystemExit("the task is not serialised with Python separators: " + served)
if not isinstance(json.loads(served).get("max_score"), float):
    raise SystemExit("max_score is not a JSON number")
' "${WORK}/task_one.json" || fail "/tasks/${key} does not keep the Python byte style"
  pass "/tasks/<aplusb> keeps 100.0 and the ', ' / ': ' separators"
}

public_config_is_exactly_two_keys() {
  curl -fsS "${BASE}/config" >"${WORK}/config.json"
  python3 -c '
import json, sys
raw = open(sys.argv[1]).read()
if "\", \"" not in raw or "\": \"" not in raw:
    raise SystemExit("/config is not serialised with Python separators: " + raw)
config = json.loads(raw)
if set(config) != {"show_id_column", "source_url"}:
    raise SystemExit("/config must be exactly show_id_column and source_url, got " + str(sorted(config)))
if not isinstance(config["show_id_column"], bool) or not isinstance(config["source_url"], str):
    raise SystemExit("/config carries the wrong types")
' "${WORK}/config.json" || fail "/config leaked more than show_id_column and source_url"
  pass "/config is exactly two keys, spaced Python style"
}

credits_nests_licence_project_and_surface() {
  curl -fsS "${BASE}/credits" >"${WORK}/credits.json"
  python3 -c '
import json, sys
credits = json.load(open(sys.argv[1]))
if set(credits) != {"license", "project", "surface"}:
    raise SystemExit("/credits must nest license, project and surface, got " + str(sorted(credits)))
if "spdx_id" not in credits["license"] or "name" not in credits["project"]:
    raise SystemExit("/credits flattened the licence or the project")
' "${WORK}/credits.json" || fail "/credits is not the nested licence shape"
  pass "/credits nests licence, project and surface"
}

timestamps_land_where_python_put_them() {
  local route
  for route in /scores /users/ /contests/; do
    if ! request_has_header "${route}" "timestamp"; then
      fail "${route} is missing the Timestamp header"
    fi
  done
  for route in /history /config /credits /sublist/u0; do
    if request_has_header "${route}" "timestamp"; then
      fail "${route} must not carry a Timestamp header"
    fi
  done
  pass "the Timestamp header lands on the stamped routes only"
}

image_routes_never_answer_a_404() {
  local route code content_type
  for route in /faces/u0 /faces/no-such-key /flags/no-such-key; do
    code="$(curl -sS -o /dev/null -w '%{http_code}' "${BASE}${route}")"
    [[ "${code}" == "200" ]] || fail "${route} answered ${code}: the Python handler never 404s an image"
    content_type="$(curl -sS -D - -o /dev/null "${BASE}${route}" | tr -d '\r' | grep -i '^content-type:' || true)"
    [[ "${content_type}" == *image/* ]] || fail "${route} is not an image (${content_type})"
  done
  pass "faces and flags serve an image for known and unknown keys alike"
}

unknown_entity_key_is_a_404() {
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' "${BASE}/users/no-such-key")"
  [[ "${code}" == "404" ]] || fail "an unknown user key answered ${code}, expected 404"
  pass "an unknown entity key is a 404"
}

events_refuse_a_client_that_excludes_the_stream() {
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' -H 'Accept: application/json' "${BASE}/events")"
  [[ "${code}" == "406" ]] || fail "/events with Accept: application/json answered ${code}, expected 406"
  pass "/events answers 406 to a client that excludes the stream"
}

# Needs a populated replay buffer, so the caller runs it after a write has reached the
# stream: a fresh feed answers a stale id with nothing, exactly as the baseline did.
a_stale_event_id_is_answered_with_a_reinit() {
  curl -sS -N -H 'Last-Event-ID: 0' "${BASE}/events" >"${LOG}.reinit" 2>/dev/null &
  local reader=$!
  sleep 1
  kill "${reader}" 2>/dev/null || true
  wait "${reader}" 2>/dev/null || true
  grep -q '^event:reinit' "${LOG}.reinit" || fail "a stale Last-Event-ID produced no reinit"
  rm -f "${LOG}.reinit"
  pass "a stale Last-Event-ID is answered with reinit"
}
