#!/usr/bin/env bash
# The migration path must reach the database from either side; the host URL was localhost-only.
set -uo pipefail

SCRIPT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/scripts/__owner_url.sh"
pass=0 fail=0
ok() { printf '  ok   %s\n' "$1"; pass=$((pass + 1)); }
no() { printf '  FAIL %s\n' "$1"; fail=$((fail + 1)); }

url() { # url <mode> [env assignments...]
  local mode="$1"; shift
  env -i PATH="$PATH" HOME="${HOME:-/tmp}" "$@" bash "$SCRIPT" "$mode"
}

printf '\nthe container side addresses the compose service\n'
out="$(url container POSTGRES_USER=u POSTGRES_PASSWORD=p POSTGRES_DB=d)"
[[ "$out" == "postgresql://u:p@database:5432/d" ]] && ok "container URL" || no "container URL was: $out"

printf '\nthe host side addresses the published interface, never localhost\n'
out="$(url host POSTGRES_USER=u POSTGRES_PASSWORD=p POSTGRES_DB=d DB_BIND_IP=100.114.35.41 POSTGRES_PORT_EXTERNAL=5432)"
[[ "$out" == "postgresql://u:p@100.114.35.41:5432/d" ]] && ok "uses DB_BIND_IP" || no "host URL was: $out"
[[ "$out" != *localhost* ]] && ok "never says localhost" || no "still says localhost"

printf '\nand falls back to loopback only when nothing binds elsewhere\n'
out="$(url host POSTGRES_USER=u POSTGRES_PASSWORD=p POSTGRES_DB=d)"
[[ "$out" == "postgresql://u:p@127.0.0.1:5432/d" ]] && ok "loopback default" || no "default was: $out"

printf '\nan unknown mode is refused\n'
if env -i PATH="$PATH" HOME="${HOME:-/tmp}" bash "$SCRIPT" nope >/dev/null 2>&1; then
  no "accepted an unknown mode"
else
  ok "refused an unknown mode"
fi

printf '\nthe Makefile no longer builds the URL inline\n'
MK="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/Makefile"
if grep -q '__owner_url.sh host' "$MK" && ! grep -q 'OWNER_URL_LOCAL="postgresql://\$\${POSTGRES_USER' "$MK"; then
  ok "delegates to the script"
else
  no "the inline URL is still there"
fi

printf '\nthe exec target follows the deployment, not a hardcoded colour\n'
AC="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/scripts/__admin_container.sh"
STUB="$(mktemp -d)"
printf '#!/usr/bin/env bash\nprintf "%%s\\n" %s\n' "${STUB_NAMES:-}" > "$STUB/docker"
chmod +x "$STUB/docker"

pick() { env -i PATH="$STUB:$PATH" HOME="${HOME:-/tmp}" "$@" bash "$AC"; }

# colour A stopped, colour B serving — the exact state of a blue-green deploy before a swap
printf '#!/usr/bin/env bash\necho cms-admin-panel-next-b\n' > "$STUB/docker"; chmod +x "$STUB/docker"
out="$(pick)"
[[ "$out" == "cms-admin-panel-next-b" ]] && ok "picks the running colour B" || no "picked: $out"

# colour A serving
printf '#!/usr/bin/env bash\necho cms-admin-panel-next\n' > "$STUB/docker"; chmod +x "$STUB/docker"
out="$(pick)"
[[ "$out" == "cms-admin-panel-next" ]] && ok "picks the running colour A" || no "picked: $out"

# nothing running: a name is still printed so callers can explain themselves
printf '#!/usr/bin/env bash\nexit 0\n' > "$STUB/docker"; chmod +x "$STUB/docker"
out="$(pick)"
[[ "$out" == "cms-admin-panel-next" ]] && ok "defaults when nothing runs" || no "picked: $out"

# an explicit override wins
out="$(pick CMS_ADMIN_CONTAINER=weird-name)"
[[ "$out" == "weird-name" ]] && ok "override wins" || no "picked: $out"

# and the tool resolver uses it rather than its own copy
if grep -q '__admin_container.sh' "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/scripts/__resolve_tool.sh"; then
  ok "the resolver shares the same answer"
else
  no "the resolver still hardcodes a colour"
fi
rm -rf "$STUB"

printf '\nPASS: %d  FAIL: %d\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
