#!/usr/bin/env bash
set -eu
if (set -o pipefail 2>/dev/null); then set -o pipefail; fi
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
if [ -f "${SCRIPT_DIR}/__lib/common.sh" ]; then
  # shellcheck source=/dev/null
  source "${SCRIPT_DIR}/__lib/common.sh"
fi
declare -F log_info >/dev/null 2>&1 || log_info() { printf '[INFO] %s\n' "$*"; }
declare -F log_warn >/dev/null 2>&1 || log_warn() { printf '[WARN] %s\n' "$*" >&2; }
declare -F log_die >/dev/null 2>&1 || log_die() { printf '[FAIL] %s\n' "${1:-fatal}" >&2; exit "${2:-1}"; }

REGISTRY="${REPO_ROOT}/admin-panel/src/lib/permission-registry.ts"
HANDLER_DIR="${REPO_ROOT}/src/cms/server/admin/handlers"
RPC_FILE="${REPO_ROOT}/src/cms/server/admin/rpc_authorization.py"

[ -f "$REGISTRY" ] || log_die "missing $REGISTRY" 1
[ -d "$HANDLER_DIR" ] || log_die "missing $HANDLER_DIR" 1

tmp_registry=$(mktemp)
tmp_python=$(mktemp)
tmp_rpc=$(mktemp)
tmp_offenders=$(mktemp)
trap 'rm -f "$tmp_registry" "$tmp_python" "$tmp_rpc" "$tmp_offenders"' EXIT

# Why: derive the full registry key set from source so parity never hardcodes the list.
python3 - "$REGISTRY" "$tmp_registry" <<'PY'
import re
import sys

registry_path = sys.argv[1]
out_path = sys.argv[2]

with open(registry_path) as f:
    content = f.read()

m = re.search(r"const\s+MODULES[^=]*=\s*\[(.*?)\]", content, re.S)
if not m:
    sys.exit(f"could not parse MODULES in {registry_path}")
modules = re.findall(r"'([^']+)'", m.group(1))

m = re.search(r"const\s+STANDARD_VERBS[^=]*=\s*\[(.*?)\]", content, re.S)
if not m:
    sys.exit(f"could not parse STANDARD_VERBS in {registry_path}")
verbs = re.findall(r"'([^']+)'", m.group(1))

m = re.search(r"const\s+DOMAIN_VERBS[^=]*=\s*\[(.*?)\]", content, re.S)
if not m:
    sys.exit(f"could not parse DOMAIN_VERBS in {registry_path}")
domain = re.findall(r"\{\s*module:\s*'([^']+)'\s*,\s*verb:\s*'([^']+)'\s*\}", m.group(1))

keys = set()
for mod in modules:
    for v in verbs:
        keys.add(f"{mod}:{v}")
for mod, v in domain:
    keys.add(f"{mod}:{v}")
keys.add("all:all")

with open(out_path, "w") as out:
    for k in sorted(keys):
        out.write(k + "\n")
PY

# Why: collect every permission key the Python admin references via
# require_permission("…"), SimpleHandler(…, permission="…") and
# SimpleContestHandler(…, permission="…"). AUTHENTICATED sentinel excluded.
# Strategy: scan handler files for quoted module:verb strings; every such
# string in handlers is a permission reference except the docstring example.
python3 - "$HANDLER_DIR" "$REPO_ROOT" "$tmp_python" "$tmp_offenders" "$tmp_registry" <<'PY'
import pathlib
import re
import sys

handler_dir = pathlib.Path(sys.argv[1])
repo_root = pathlib.Path(sys.argv[2])
python_out = pathlib.Path(sys.argv[3])
offenders_out = pathlib.Path(sys.argv[4])
registry_path = pathlib.Path(sys.argv[5])

with open(registry_path) as f:
    registry = {line.strip() for line in f if line.strip()}

# Quoted permission-like strings
perm_re = re.compile(r"""['"](\w+:\w+)['"]""")

# Keys mapped to first occurrence file:line
key_loc: dict[str, str] = {}
all_keys: set[str] = set()

for p in sorted(handler_dir.rglob("*.py")):
    text = p.read_text(encoding="utf-8", errors="ignore")
    # Only consider files that actually reference permission machinery
    # to avoid picking up unrelated quoted strings elsewhere.
    # But every handler file with a \w+:\w+ quote is permission-related;
    # check whole file for at least one require_permission/SimpleHandler mention
    # or just rely on the \w+:\w+ pattern being rare outside permissions.
    # Direct scan is safe: handlers only contain permission keys as quoted \w+:\w+.
    lines = text.splitlines()
    for idx, line in enumerate(lines, 1):
        for m in perm_re.finditer(line):
            val = m.group(1)
            if val == "module:verb":
                continue
            all_keys.add(val)
            if val not in key_loc:
                try:
                    rel = p.relative_to(repo_root)
                except ValueError:
                    rel = p
                key_loc[val] = f"{rel}:{idx}"

with open(python_out, "w") as out:
    for k in sorted(all_keys):
        out.write(k + "\n")

with open(offenders_out, "w") as out:
    for k in sorted(all_keys):
        if k not in registry:
            loc = key_loc.get(k, "unknown")
            out.write(f"{k}  {loc}\n")
PY

python_count=$(wc -l < "$tmp_python" | tr -d ' ')
registry_count=$(wc -l < "$tmp_registry" | tr -d ' ')

if [ -s "$tmp_offenders" ]; then
  printf 'Permission parity FAILED:\n' >&2
  while IFS= read -r line; do
    [ -n "$line" ] && printf '  %s\n' "$line" >&2
  done < "$tmp_offenders"
  exit 1
fi

# Why: rpc_authorization.py tiers rely on specific keys/prefixes existing in the registry.
if [ -f "$RPC_FILE" ]; then
  rpc_missing=""
  if ! grep -qxF "all:all" "$tmp_registry"; then
    rpc_missing="${rpc_missing}all:all (rpc_authorization.py: all:all tier)"$'\n'
  fi
  if ! grep -qxF "message:send" "$tmp_registry"; then
    rpc_missing="${rpc_missing}message:send (rpc_authorization.py: messaging tier)"$'\n'
  fi
  if ! grep -q "^question:" "$tmp_registry"; then
    rpc_missing="${rpc_missing}question:* (rpc_authorization.py: question: prefix tier)"$'\n'
  fi
  if ! grep -q "^announcement:" "$tmp_registry"; then
    rpc_missing="${rpc_missing}announcement:* (rpc_authorization.py: announcement: prefix tier)"$'\n'
  fi
  if [ -n "$rpc_missing" ]; then
    printf 'Permission parity FAILED:\n' >&2
    printf '%s' "$rpc_missing" | while IFS= read -r line; do
      [ -n "$line" ] && printf '  %s\n' "$line" >&2
    done
    exit 1
  fi
fi

printf 'Permission parity OK (%s python keys checked against %s registry keys)\n' "$python_count" "$registry_count"
