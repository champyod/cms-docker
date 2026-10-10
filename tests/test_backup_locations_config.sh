#!/usr/bin/env bash
# The two backup-location config keys and everything that has to carry them.
#
# WHY this exists: the [backup] BACKUP_LOCATIONS / BACKUP_DEFAULT_LOCATION pair is being
# replaced by a DB table, so the retirement has to be a deliberate act rather than a
# silent drift. Every assertion below is one the removal has to break on purpose: a
# registry row, a documented default, a compose line carrying the value into the panel,
# the resolver's data source, and the duplicate-key invariant that caught a real defect
# when this pair was briefly registered twice.
#
# Why the resolver is checked structurally: locations are rows now, so the resolver
# imports Prisma and cannot be driven from a bare `bun -e` the way the env parser
# could. Its fail-closed contract (an unknown id, a path only one container sees) is
# pinned by admin-panel/tests/backup-locations.test.ts; what is pinned here is the
# half that would silently regress: that resolution reads the table and never the
# retired env pair again.
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
REGISTRY="${REPO_ROOT}/scripts/__update_engine.sh"
CONFIG_EXAMPLE="${REPO_ROOT}/config.toml.example"
COMPOSE="${REPO_ROOT}/docker-compose.yml"
RESOLVER="${REPO_ROOT}/admin-panel/src/lib/backup-locations.ts"

KEYS=(BACKUP_DEFAULT_LOCATION BACKUP_LOCATIONS)

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

echo "the config registry declares both keys under [backup]"
for key in "${KEYS[@]}"; do
  if grep -qE "\|\[backup\]\|${key}\|" "${REGISTRY}"; then
    ok "${key} is registered under [backup]"
  else
    no "${key} is registered under [backup]"
  fi
done

echo "config.toml.example documents both keys with a default"
# WHY the default matters: an empty one means a fresh install silently carries no
# location, and the resolver then reports the single implicit tree instead — a
# configuration that looks set and is not.
for key in "${KEYS[@]}"; do
  line="$(grep -E "^${key} = " "${CONFIG_EXAMPLE}" | head -1)"
  if [[ -n "${line}" ]]; then
    ok "${key} is documented in config.toml.example"
    if [[ "${line}" != *'= ""'* ]]; then
      ok "${key} carries a non-empty default"
    else
      no "${key} carries a non-empty default"
    fi
  else
    no "${key} is documented in config.toml.example"
  fi
done

echo "the panel is given both keys"
# WHY the block is captured once and the variable is grepped: `grep -q` closes the pipe on
# its first match, which kills the upstream awk with SIGPIPE, and the pipeline status then
# reflects awk rather than grep — so a key that IS set reports as absent depending on where
# it falls in the block.
panel_block="$(awk '/^  admin-panel-next:/,/^  admin-web-server:/' "${COMPOSE}")"
for key in "${KEYS[@]}"; do
  if grep -qE "^[[:space:]]*${key}:" <<<"${panel_block}"; then
    ok "${key} reaches the admin-panel-next service"
  else
    no "${key} reaches the admin-panel-next service"
  fi
done

echo "the resolver reads the table, not the environment"
# WHY: locations are rows now, so the resolver must query them and must not
# consult the retired env pair — a module that read the env again would
# silently resolve a list the database does not know.
if grep -q 'backup_locations' "${RESOLVER}"; then
  ok "the resolver queries the backup_locations table"
else
  no "the resolver queries the backup_locations table"
fi
if grep -qE 'BACKUP_LOCATIONS|BACKUP_DEFAULT_LOCATION' "${RESOLVER}"; then
  no "the resolver still reads the retired env pair"
else
  ok "the resolver no longer reads the retired env pair"
fi

echo "no key is declared twice in the same config.toml section"
# WHY this is a whole loop rather than a spot check: this exact pair was once registered
# under both [admin] and [backup], which is a duplicate key in config.toml — a TOML error,
# not a warning. Section F of scripts/__regression_audit.py guards the same invariant at
# the repo level; asserting it here keeps the guard honest where this subject is discussed.
dups=""
while read -r name; do
  count="$(grep -cE "^${name} = " "${CONFIG_EXAMPLE}")"
  if (( count > 1 )); then dups="${dups} ${name}(x${count})"; fi
done < <(grep -oE '^[A-Za-z0-9_]+ =' "${CONFIG_EXAMPLE}" | tr -d ' =' | sort -u)
if [[ -z "${dups}" ]]; then
  ok "no duplicate key in config.toml.example"
else
  no "duplicate key(s) in config.toml.example:${dups}"
fi
if [[ -z "$(grep -oE '\|[A-Z_0-9]+\|' "${REGISTRY}" | tr -d '|' | sort | uniq -d)" ]]; then
  ok "no key registered twice in scripts/__update_engine.sh"
else
  no "key registered twice: $(grep -oE '\|[A-Z_0-9]+\|' "${REGISTRY}" | tr -d '|' | sort | uniq -d | tr '\n' ' ')"
fi

echo "everything registered under [backup] is documented"
# WHY: a key that exists in the registry but not in the example can only be set from the
# TUI, while config sync is the documented path — the operator never learns it exists.
for key in $(grep -E '\|\[backup\]\|[A-Z_0-9]+\|' "${REGISTRY}" \
    | sed -E 's/.*\|\[backup\]\|([A-Z_0-9]+)\|.*/\1/' | sort -u); do
  if grep -qE "^${key} = " "${CONFIG_EXAMPLE}"; then
    ok "[backup] ${key} is documented"
  else
    no "[backup] ${key} is registered but not documented"
  fi
done

printf '\n%d passed, %d failed\n' "${pass}" "${fail}"
(( fail == 0 ))