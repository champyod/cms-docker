#!/usr/bin/env bash

# Contest Management System - http://cms-dev.github.io/
# Copyright © 2026
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.

# __check_render_parity.sh — the S-1 equivalence oracle.
#
# Two stacks, one database, one request list, one diff. The baseline is the tree
# at --baseline-ref (HEAD by default, extracted with git archive so an
# uncommitted change cannot move it), the candidate is the working tree. That
# asymmetry is the whole point: it is what lets a one-line planted change show
# up as a diff instead of cancelling out because both stacks read the same file.
#
# WHY the stacks run one at a time: both need the database to open in the same
# seeded state, and a snapshot database (created with CREATE DATABASE … TEMPLATE)
# is restored before each capture. Running them side by side would let each
# other's RPC clients connect, and would let one stack's writes reach the other's
# reads. Sequential also means one port pair, not two.
#
# Exit codes: 0 = every surface recorded and no difference; 1 = a difference;
# 2 = the harness could not run (missing tool, occupied name, stack not ready);
# 3 = a surface did not answer what the request list says it must.
#
# Usage:
#   scripts/__check_render_parity.sh                 # baseline vs working tree
#   scripts/__check_render_parity.sh --baseline-only # boot + record, no diff
#   scripts/__check_render_parity.sh --candidate-src DIR   # another checkout
#
# Knobs: CMS_PARITY_IMAGE (stack image), CMS_PARITY_DB_IMAGE, CMS_PARITY_PORTS
# ("18888 18889"), CMS_PARITY_KEEP=1 (keep the work directory and containers).

set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

IMAGE="${CMS_PARITY_IMAGE:-ghcr.io/champyod/cms-docker-core:major-admin-panel}"
DB_IMAGE="${CMS_PARITY_DB_IMAGE:-postgres:15-alpine}"
NETWORK="cms-network"
DB_CONTAINER="database"
SNAPSHOT_DB="cmsdb_ref"
DB_NAME="cmsdb"
DB_USER="cmsuser"
DB_PASS="cmsdevpw"
RPC_SECRET="parity-rpc-secret"
COOKIE_SECRET="c0ffee5eedc0ffee5eedc0ffee5eed00"
BASE_REF="HEAD"
BASELINE_ONLY=0
CANDIDATE_SRC=""
KEEP="${CMS_PARITY_KEEP:-0}"
JSON_OUT=""

read -r -a PORTS <<<"${CMS_PARITY_PORTS:-18888 18889}"
CWS_PORT="${PORTS[0]}"
AWS_PORT="${PORTS[1]}"

WORK=""
BASELINE_CONTAINER="parity-baseline"
CANDIDATE_CONTAINER="parity-candidate"

log() { printf 'parity: %s\n' "$*"; }
die() { printf 'parity: FAIL %s\n' "$*" >&2; exit "${2:-2}"; }

usage() {
    sed -n '2,45p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --baseline-only) BASELINE_ONLY=1; shift ;;
        --baseline-ref) BASE_REF="${2:?}"; shift 2 ;;
        --candidate-src) CANDIDATE_SRC="${2:?}"; shift 2 ;;
        --json) JSON_OUT="${2:?}"; shift 2 ;;
        --keep) KEEP=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) die "unknown argument: $1" ;;
    esac
done

# shellcheck disable=SC2329  # invoked by the EXIT trap below
cleanup() {
    local status=$?
    if [[ "$KEEP" != "1" ]]; then
        docker rm -f "$BASELINE_CONTAINER" "$CANDIDATE_CONTAINER" >/dev/null 2>&1
        # WHY only a container this run labelled: an unlabelled `database` is
        # another writer's, and removing it would destroy their data.
        if [[ "$(docker inspect -f '{{ index .Config.Labels "cms.parity" }}' "$DB_CONTAINER" 2>/dev/null)" == "1" ]]; then
            docker rm -f "$DB_CONTAINER" >/dev/null 2>&1
        fi
        [[ -n "$WORK" && -d "$WORK" ]] && rm -rf "$WORK"
    else
        log "kept: containers ${BASELINE_CONTAINER}/${CANDIDATE_CONTAINER}, work ${WORK}"
    fi
    exit "$status"
}
trap cleanup EXIT INT TERM

# --- preflight -------------------------------------------------------------

command -v docker >/dev/null 2>&1 || die "docker is not on PATH"
command -v python3 >/dev/null 2>&1 || die "python3 is not on PATH"
command -v git >/dev/null 2>&1 || die "git is not on PATH"
docker info >/dev/null 2>&1 || die "the docker daemon is not reachable"
docker image inspect "$IMAGE" >/dev/null 2>&1 \
    || die "stack image ${IMAGE} is not present locally (pull it first)"
docker network inspect "$NETWORK" >/dev/null 2>&1 \
    || die "docker network ${NETWORK} does not exist"

if docker inspect "$DB_CONTAINER" >/dev/null 2>&1; then
    if [[ "$(docker inspect -f '{{ index .Config.Labels "cms.parity" }}' "$DB_CONTAINER")" != "1" ]]; then
        die "a container named ${DB_CONTAINER} already exists and was not created by this harness"
    fi
    docker rm -f "$DB_CONTAINER" >/dev/null 2>&1
fi
docker rm -f "$BASELINE_CONTAINER" "$CANDIDATE_CONTAINER" >/dev/null 2>&1

# WHY the prisma CLI and not a hand-applied SQL file: the panel's migrations
# carry the roles and RLS policies the services read, and the repo's own
# migration path is `make prisma-sync`. __resolve_tool.sh is what that path uses
# to find the CLI on either side of the container boundary.
PRISMA_RESOLVE="$(bash "${SCRIPT_DIR}/__resolve_tool.sh" prisma)" \
    || die "could not resolve the prisma CLI (make prisma-sync would fail too)"
IFS=$'\t' read -r PRISMA_WHERE PRISMA_DIR PRISMA_CMD <<<"$PRISMA_RESOLVE"
# WHY --config.lockfile=false: a plain `pnpm exec` writes pnpm-lock.yaml into
# admin-panel/, and a gate must not leave a file in the tree it is measuring.
case "$PRISMA_CMD" in
    pnpm\ *) PRISMA_CMD="pnpm --config.lockfile=false ${PRISMA_CMD#pnpm }" ;;
esac

WORK="$(mktemp -d "${TMPDIR:-/tmp}/cms-parity.XXXXXXXX")" || die "mktemp failed"
log "work ${WORK}"

# --- sources ---------------------------------------------------------------

mkdir -p "${WORK}/baseline"
git -C "$REPO_ROOT" archive "$BASE_REF" src \
    | tar -x -C "${WORK}/baseline" || die "could not extract src/ at ${BASE_REF}"

BASELINE_SRC="${WORK}/baseline/src"
if [[ -z "$CANDIDATE_SRC" ]]; then
    CANDIDATE_SRC="${REPO_ROOT}/src"
elif [[ -d "${CANDIDATE_SRC}/src" ]]; then
    CANDIDATE_SRC="${CANDIDATE_SRC}/src"
fi
[[ -d "$BASELINE_SRC/cms" ]] || die "baseline extraction has no cms/ package"
[[ -d "$CANDIDATE_SRC/cms" ]] || die "candidate source ${CANDIDATE_SRC} has no cms/ package"
log "baseline=${BASE_REF} candidate=${CANDIDATE_SRC}"

AREAS=()
for area in cms cmscommon cmscontrib cmsranking cmstaskenv cmstestsuite; do
    [[ -d "${BASELINE_SRC}/${area}" ]] && AREAS+=("$area")
done
[[ ${#AREAS[@]} -gt 0 ]] || die "baseline has no python packages to mount"

# --- database --------------------------------------------------------------

start_database() {
    local attempt
    for attempt in 1 2 3; do
        docker rm -f "$DB_CONTAINER" >/dev/null 2>&1
        # WHY a tmpfs PGDATA: every run needs a cluster built from scratch, and
        # a container volume would leave a stale one behind for the next run to
        # inherit (and a gigabyte of them on disk after a week of runs).
        if ! docker run -d --name "$DB_CONTAINER" --network "$NETWORK" \
                --label cms.parity=1 \
                --tmpfs /var/lib/postgresql/data:rw,size=1g \
                -p "127.0.0.1:15432:5432" \
                -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD="$DB_PASS" \
                -v "${SCRIPT_DIR}/parity/db-bootstrap.sql:/docker-entrypoint-initdb.d/00-parity.sql:ro" \
                "$DB_IMAGE" >/dev/null 2>"${WORK}/db-run.err"; then
            cat "${WORK}/db-run.err" >&2
            sleep 2
            continue
        fi
        for _ in $(seq 1 90); do
            docker exec "$DB_CONTAINER" pg_isready -U "$DB_USER" >/dev/null 2>&1 && return 0
            # WHY: a container that exited will never become ready, and ninety
            # seconds of waiting hides the line that says why.
            if [[ "$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null)" != "true" ]]; then
                break
            fi
            sleep 1
        done
        docker logs "$DB_CONTAINER" >&2 2>&1
        log "database start attempt ${attempt} failed"
        sleep 2
    done
    die "postgres did not become ready in three attempts"
}

start_database

psql_db() {
    docker exec -i "$DB_CONTAINER" psql -q -v ON_ERROR_STOP=1 -U "$DB_USER" "$@"
}

# WHY a separate administrative connection: the migrations demote cmsuser, so
# the snapshot and restore below run as the bootstrap superuser the database
# container was initialised with (see scripts/parity/db-bootstrap.sql).
psql_admin() {
    docker exec -i "$DB_CONTAINER" psql -q -v ON_ERROR_STOP=1 -U postgres "$@"
}

create_stack_container() {  # <name> <stack-label> <src-root>
    local name="$1" stack="$2" src="$3" alias mounts=()
    for area in "${AREAS[@]}"; do
        mounts+=(-v "${src}/${area}:/home/cmsuser/cms/lib/python3.12/site-packages/${area}:ro")
    done
    mkdir -p "${WORK}/${stack}/etc"
    python3 "${SCRIPT_DIR}/parity/parity.py" config \
        --source "${WORK}/devdb.toml" \
        --out "${WORK}/${stack}/etc/cms.toml" \
        --stack "$stack" \
        --secret "$COOKIE_SECRET" \
        --rpc-secret "$RPC_SECRET" \
        --database-url "postgresql+psycopg2://${DB_USER}:${DB_PASS}@${DB_CONTAINER}:5432/${DB_NAME}" \
        || die "could not render ${stack}/cms.toml"

    local aliases=()
    while IFS= read -r alias; do aliases+=("--network-alias" "$alias"); done < <(
        grep -oE '"cms-[a-z0-9-]+"' "${WORK}/${stack}/etc/cms.toml" | tr -d '"' | sort -u
    )
    docker run -d --name "$name" --network "$NETWORK" \
        --label cms.parity=1 \
        "${aliases[@]}" \
        -p "127.0.0.1:${CWS_PORT}:8888" -p "127.0.0.1:${AWS_PORT}:8889" \
        -e CMS_CONFIG=/home/cmsuser/cms/etc/cms.toml \
        "${mounts[@]}" \
        -v "${WORK}/${stack}/etc/cms.toml:/home/cmsuser/cms/etc/cms.toml:ro" \
        --entrypoint sleep "$IMAGE" infinity >/dev/null \
        || die "could not start ${name}"
}

# WHY the config template is read out of the image: it is the stack's own
# measured configuration (real service ports, captcha off, isolate sandbox) and
# the only field the harness has to change is the one cms/conf.py refuses to
# boot with.
docker run --rm --entrypoint cat "$IMAGE" /home/cmsuser/cms/etc/cms-devdb.toml \
    >"${WORK}/devdb.toml" || die "could not read cms-devdb.toml from ${IMAGE}"

log "building schema (cmsInitDB + prisma migrate deploy)"
create_stack_container "$BASELINE_CONTAINER" baseline "$BASELINE_SRC"
docker exec "$BASELINE_CONTAINER" cmsInitDB >/dev/null 2>&1 \
    || die "cmsInitDB failed inside ${BASELINE_CONTAINER}"

# WHY: this tree's models declare the username_policies enums, and create_all
# emits them even though the table itself is Prisma-owned; the Prisma migration
# that creates that table would then fail on an existing type. Dropping the two
# types first is what lets the migration history own its own objects.
psql_db -d "$DB_NAME" -c "DROP TYPE IF EXISTS username_policy_scope, username_policy" >/dev/null \
    || die "could not drop the prisma-owned enum types"

for role_sql in 20260820120000_db_roles.sql 20260820125000_backup_role.sql; do
    psql_db -d "$DB_NAME" -v cms_backup_password="$DB_PASS" \
        <"${REPO_ROOT}/admin-panel/prisma/sql/${role_sql}" >/dev/null \
        || die "role bootstrap ${role_sql} failed"
done

HOST_DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:15432/${DB_NAME}"
NET_DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_CONTAINER}:5432/${DB_NAME}"
PRISMA_CONTAINER="$(bash "${SCRIPT_DIR}/__admin_container.sh" 2>/dev/null || true)"

run_prisma() {  # <args...>
    if [[ "$PRISMA_WHERE" == "container" ]]; then
        docker exec -e DATABASE_URL="$NET_DATABASE_URL" "$PRISMA_CONTAINER" \
            sh -lc "cd '$PRISMA_DIR' && $*" >/dev/null
    else
        # shellcheck disable=SC2048  # $* is a resolved command line, split on purpose
        ( cd "$PRISMA_DIR" && DATABASE_URL="$HOST_DATABASE_URL" $* >/dev/null )
    fi
}

# WHY: cmsInitDB creates the core tables first, which is exactly the state the
# P3005 baseline marker exists for; without the marker prisma refuses a
# non-empty database.
run_prisma "$PRISMA_CMD migrate resolve --applied 20260910000000_baseline_marker --schema=./prisma/schema.prisma" \
    || die "prisma baseline resolve failed"
run_prisma "$PRISMA_CMD migrate deploy --schema=./prisma/schema.prisma" \
    || die "prisma migrate deploy failed"

docker cp "${SCRIPT_DIR}/parity/seed.py" "${BASELINE_CONTAINER}:/tmp/parity-seed.py" >/dev/null \
    || die "could not copy the seed into ${BASELINE_CONTAINER}"
docker exec "$BASELINE_CONTAINER" python3 /tmp/parity-seed.py \
    || die "seeding failed"

# WHY a template copy rather than a dump: both captures must start from byte-
# identical data, and CREATE DATABASE … TEMPLATE is exact where a re-seed is a
# second run of the same code.
psql_admin -d postgres \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid()" \
    -c "CREATE DATABASE ${SNAPSHOT_DB} TEMPLATE ${DB_NAME}" >/dev/null \
    || die "could not snapshot the seeded database"

restore_snapshot() {
    psql_admin -d postgres \
        -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('${DB_NAME}','${SNAPSHOT_DB}') AND pid <> pg_backend_pid()" \
        -c "DROP DATABASE IF EXISTS ${DB_NAME}" \
        -c "CREATE DATABASE ${DB_NAME} TEMPLATE ${SNAPSHOT_DB} OWNER ${DB_USER}" >/dev/null \
        || die "could not restore the seeded database"
}

# --- stack lifecycle -------------------------------------------------------

start_services() {  # <container>
    local name="$1" service
    for service in LogService ResourceService ScoringService EvaluationService ProxyService; do
        docker exec -d "$name" sh -c "cms${service} 0 > /tmp/${service}.log 2>&1"
        sleep 0.5
    done
    sleep 1
    for service in ContestWebServer AdminWebServer; do
        docker exec -d "$name" sh -c "cms${service} 0 > /tmp/${service}.log 2>&1"
    done
}

dump_logs() {  # <container>
    local name="$1" log
    for log in LogService ResourceService ScoringService EvaluationService ProxyService ContestWebServer AdminWebServer; do
        printf -- '--- %s %s\n' "$name" "$log" >&2
        docker exec "$name" tail -n 6 "/tmp/${log}.log" 2>/dev/null >&2
    done
}

wait_ready() {  # <container>
    local name="$1" code_cws code_aws
    for _ in $(seq 1 120); do
        code_cws="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${CWS_PORT}/login" || true)"
        code_aws="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${AWS_PORT}/login" || true)"
        if [[ "$code_cws" != "000" && "$code_aws" != "000" ]]; then
            return 0
        fi
        sleep 1
    done
    dump_logs "$name"
    return 1
}

capture_stack() {  # <container> <label> <outdir>
    local name="$1" stack="$2" out="$3" status=0
    restore_snapshot
    start_services "$name"
    wait_ready "$name" || die "${stack} stack did not answer on its ports"
    python3 "${SCRIPT_DIR}/parity/parity.py" capture \
        --requests "${SCRIPT_DIR}/parity/requests.json" \
        --stack "$stack" \
        --cws-url "http://127.0.0.1:${CWS_PORT}" \
        --aws-url "http://127.0.0.1:${AWS_PORT}" \
        --out "$out" || status=$?
    if [[ $status -ne 0 ]]; then
        dump_logs "$name"
    fi
    # WHY the container goes either way: the two stacks run one after the
    # other on one port pair, and a second published port would refuse to bind.
    docker rm -f "$name" >/dev/null 2>&1
    return $status
}

BASELINE_CAPTURE="${WORK}/capture-baseline"
capture_stack "$BASELINE_CONTAINER" baseline "$BASELINE_CAPTURE" || exit $?

if [[ "$BASELINE_ONLY" == "1" ]]; then
    python3 - "${BASELINE_CAPTURE}/capture.json" <<'PY'
import json, sys
with open(sys.argv[1]) as handle:
    document = json.load(handle)
surfaces = {}
for item in document["requests"]:
    surfaces.setdefault(item["surface"], []).append(item["id"])
for surface in sorted(surfaces):
    print("parity: surface %-18s %d response(s)" % (surface, len(surfaces[surface])))
print("parity: baseline-only ok requests=%d surfaces=%d"
      % (len(document["requests"]), len(surfaces)))
PY
    exit 0
fi

log "candidate=${CANDIDATE_SRC}"
create_stack_container "$CANDIDATE_CONTAINER" candidate "$CANDIDATE_SRC"
CANDIDATE_CAPTURE="${WORK}/capture-candidate"
capture_stack "$CANDIDATE_CONTAINER" candidate "$CANDIDATE_CAPTURE" || exit $?

[[ -n "$JSON_OUT" ]] || JSON_OUT="${WORK}/diff.json"
python3 "${SCRIPT_DIR}/parity/parity.py" diff \
    --a "$BASELINE_CAPTURE" --b "$CANDIDATE_CAPTURE" --json "$JSON_OUT"
status=$?
log "diff report ${JSON_OUT}"
exit "$status"
