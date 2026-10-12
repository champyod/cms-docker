#!/usr/bin/env bash
# Surface checks the first rehearsal never reached: the entity reads, the public
# config and credits, the image fallbacks, and the framing the Python service
# enforced. Sourced by ranking_e2e.sh, so it defines functions only and reads the
# WORK, PARITY, LOG, BASE and pass/fail helpers its caller already set.
#
# Every expectation is derived from seed.json — the rows this rehearsal seeds — or
# asserted as a property of the response itself (spacing, headers, status), so nothing
# here is pinned to one host's production data.
#
# The checks run as `python3 -c '…' || fail` on one logical line rather than a
# heredoc, because a heredoc whose command ends in `||` leaves the shell guessing
# which of the two bodies the following lines belong to.

# The header a route does or does not carry, without failing the script on a miss.
request_has_header() {
  curl -sS -D - -o /dev/null "${BASE}$1" | grep -qi "^$2:"
}

entity_lists_carry_the_seeded_values() {
  curl -fsS "${BASE}/users/" >"${WORK}/users.json"
  curl -fsS "${BASE}/contests/" >"${WORK}/contests.json"
  curl -fsS "${BASE}/tasks/" >"${WORK}/tasks.json"
  curl -fsS "${BASE}/teams/" >"${WORK}/teams.json"
  python3 -c '
import json, sys
seed = json.load(open(sys.argv[1]))["entities"]
for kind, served_path in (("users", sys.argv[2]), ("contests", sys.argv[3]),
                          ("tasks", sys.argv[4]), ("teams", sys.argv[5])):
    if json.load(open(served_path)) != seed[kind]:
        raise SystemExit("/" + kind + "/ does not carry the seeded values")
' "${PARITY}/seed.json" "${WORK}/users.json" "${WORK}/contests.json" \
    "${WORK}/tasks.json" "${WORK}/teams.json" ||
    fail "an entity list does not carry the seeded values"
  pass "every entity list is an object keyed by key with the seeded values"
}

task_single_keeps_the_python_byte_style() {
  local key
  key="$(python3 -c "import json;print(next(iter(json.load(open('${PARITY}/seed.json'))['entities']['tasks'])))")" ||
    fail "seed.json carries no task to read back"
  curl -fsS "${BASE}/tasks/${key}" >"${WORK}/task_one.json"
  python3 -c '
import json, sys
seed = json.load(open(sys.argv[1]))["entities"]["tasks"][sys.argv[2]]
served = open(sys.argv[3]).read()
task = json.loads(served)
if served != json.dumps(task, separators=(", ", ": ")):
    raise SystemExit("the task is not serialised in the Python style: " + served)
if not isinstance(task["max_score"], float) or task["max_score"] != seed["max_score"]:
    raise SystemExit("max_score is not the seeded float: " + served)
' "${PARITY}/seed.json" "${key}" "${WORK}/task_one.json" ||
    fail "/tasks/${key} does not keep the Python byte style"
  pass "/tasks/${key} keeps the seeded float and the Python separators"
}

public_config_is_exactly_two_keys() {
  curl -fsS "${BASE}/config" >"${WORK}/config.json"
  python3 -c '
import json, sys
raw = open(sys.argv[1]).read()
config = json.loads(raw)
if raw != json.dumps(config, separators=(", ", ": ")):
    raise SystemExit("/config is not serialised in the Python style: " + raw)
if set(config) != {"show_id_column", "source_url"}:
    raise SystemExit("/config must be exactly show_id_column and source_url, got " + str(sorted(config)))
if not isinstance(config["show_id_column"], bool) or not isinstance(config["source_url"], str):
    raise SystemExit("/config carries the wrong types")
' "${WORK}/config.json" || fail "/config is not exactly two Python-spaced keys"
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

# The board the page draws is the override-applied one: a rename reaches it, a hidden
# user leaves it, a guest joins it, and every row carries a server rank. The client
# consumes this instead of recomputing ranks, so the overrides actually show.
board_carries_the_overrides() {
  python3 - "${PARITY}/seed.json" <<'PY' | psql "${DATABASE_URL}" -q >/dev/null
import json, sys
seed = json.load(open(sys.argv[1], encoding="utf-8"))["entities"]
users = list(seed["users"])
teams = list(seed["teams"])
print("DELETE FROM ranking_overrides;")
print("INSERT INTO ranking_overrides (contest_id,target_kind,target_key,action,payload,reason) "
      "VALUES (1,'user','%s','rename','{\"value\": \"Renamed Reader\"}'::jsonb,'e2e');" % users[0])
if len(users) > 1:
    print("INSERT INTO ranking_overrides (contest_id,target_kind,target_key,action,payload,reason) "
          "VALUES (1,'user','%s','hide',NULL,'e2e');" % users[1])
print("INSERT INTO ranking_overrides (contest_id,target_kind,target_key,action,payload,reason) "
      "VALUES (1,'user','e2e_guest','guest','{\"value\": \"E2E Guest\"}'::jsonb,'e2e');")
if teams:
    print("INSERT INTO ranking_overrides (contest_id,target_kind,target_key,action,payload,reason) "
          "VALUES (1,'team','%s','rename','{\"value\": \"Renamed Team\"}'::jsonb,'e2e');" % teams[0])
    print("INSERT INTO ranking_overrides (contest_id,target_kind,target_key,action,payload,reason) "
          "VALUES (1,'team','%s','score','{\"value\": \"123\"}'::jsonb,'e2e');" % teams[0])
PY
  curl -fsS "${BASE}/board" >"${WORK}/board.json"
  python3 - "${PARITY}/seed.json" "${WORK}/board.json" <<'PY' || fail "/board is not the override-applied board"
import json, sys
users = list(json.load(open(sys.argv[1], encoding="utf-8"))["entities"]["users"])
board = json.load(open(sys.argv[2], encoding="utf-8"))
renamed = board.get(users[0])
if renamed is None or (renamed["f_name"], renamed["l_name"]) != ("Renamed", "Reader"):
    raise SystemExit("the rename did not reach /board: " + json.dumps(renamed))
if len(users) > 1 and users[1] in board:
    raise SystemExit("a hidden user is still on /board")
guest = board.get("e2e_guest")
if guest is None or (guest["f_name"], guest["l_name"]) != ("E2E", "Guest"):
    raise SystemExit("the guest did not reach /board: " + json.dumps(guest))
if renamed.get("rank") is None or guest.get("rank") is None:
    raise SystemExit("a board row carries no server rank")
PY
  curl -fsS "${BASE}/board/teams" >"${WORK}/board_teams.json"
  python3 - "${PARITY}/seed.json" "${WORK}/board_teams.json" <<'PY' || fail "/board/teams is not the override-applied team board"
import json, sys
teams = list(json.load(open(sys.argv[1], encoding="utf-8"))["entities"]["teams"])
board = json.load(open(sys.argv[2], encoding="utf-8"))
if not teams:
    raise SystemExit(0)
team = board.get(teams[0])
if team is None or team["name"] != "Renamed Team":
    raise SystemExit("the team rename did not reach /board/teams: " + json.dumps(team))
if team["score"] != 123.0:
    raise SystemExit("the team score override did not replace the aggregate: " + json.dumps(team))
if team.get("rank") is None:
    raise SystemExit("a team row carries no server rank")
PY
  psql "${DATABASE_URL}" -q -c "DELETE FROM ranking_overrides;" >/dev/null
  pass "/board and /board/teams carry the override-applied, server-ranked rows"
}

# A score move must reach an open stream as a board delta (rank/score), so a live page
# updates in place instead of refetching the whole board.
a_score_write_publishes_a_board_delta() {
  local subchange
  subchange="$(python3 -c "import json;print(next(iter(json.load(open('${PARITY}/seed.json'))['entities']['subchanges'])))")" ||
    fail "seed.json carries no subchange to move"
  (timeout 10 curl -sS -N "${BASE}/events" >"${LOG}.board" 2>/dev/null || true) &
  local reader=$!
  sleep 1
  psql "${DATABASE_URL}" -q -c \
    "UPDATE ranking_subchanges SET score = score + 1 WHERE key = '${subchange}'" >/dev/null
  wait "${reader}" || true
  grep -q '^event:board' "${LOG}.board" || fail "a score move published no board delta"
  grep -q '^event:score' "${LOG}.board" || fail "a score move published no score event"
  rm -f "${LOG}.board"
  pass "a score move publishes both a score event and a board delta"
}

timestamps_land_where_python_put_them() {
  local route
  for route in /scores /board /board/teams /users/ /contests/; do
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
