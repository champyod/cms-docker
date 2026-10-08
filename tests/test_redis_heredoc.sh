#!/usr/bin/env bash
# Exercises the real REDIS_RATE_LIMIT block out of __domain.sh. With the heredoc
# delimiter unquoted, the backtick-quoted nginx names in the block ran as command
# substitutions, so rendering with REDIS_RATE_LIMIT=1 printed "<name>: command not
# found" and ate the words out of the emitted comments. The delimiter is now quoted
# and the one dynamic reference substituted separately; this pins both.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
DOMAIN_SH="${REPO_ROOT}/scripts/__domain.sh"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

# The if/else that builds redis_upstream_block, from the guard to its closing fi.
block="$(awk '
  /REDIS_RATE_LIMIT:-0.*then/ { inblk = 1 }
  inblk { print }
  inblk && /^  fi$/ { exit }
' "$DOMAIN_SH")"

[[ -n "$block" ]] \
  && ok "REDIS_RATE_LIMIT block extracted" \
  || { no "REDIS_RATE_LIMIT block extracted"; exit 1; }

err="$(mktemp)"
trap 'rm -f "$err"' EXIT

# Evaluate the block as the script would, with REDIS_RATE_LIMIT=1.
out="$(REDIS_RATE_LIMIT=1 REDIS_HOST="redis-rate-limit" REDIS_PORT="6379" \
  bash -c "${block}
printf '%s' \"\$redis_upstream_block\"" 2>"$err")"

if [[ ! -s "$err" ]]; then
  ok "no command substitution at render time"
else
  no "no command substitution at render time (stderr: $(head -n1 "$err"))"
fi

# The backtick spans must survive as literal text.
for span in '`access_by_lua*`' '`lua_shared_dict`' '`resolver`' '`limit_req`'; do
  if printf '%s' "$out" | grep -qF -- "$span"; then
    ok "literal span kept: ${span}"
  else
    no "literal span kept: ${span}"
  fi
done

# The one dynamic reference is still substituted.
if printf '%s' "$out" | grep -qF -- "server redis-rate-limit:6379"; then
  ok "dynamic reference substituted"
else
  no "dynamic reference substituted"
fi
if printf '%s' "$out" | grep -qF -- "__REDIS_BACKEND__"; then
  no "placeholder left behind"
else
  ok "placeholder consumed"
fi

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
