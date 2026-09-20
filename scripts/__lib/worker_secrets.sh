# Shared-secret distribution for remote worker boxes.
# A remote box renders its own config, so secrets it must share with main
# (DB passwords, signing keys) would otherwise diverge on every local sync.
# Push copies main's values over scp/ssh and merges them into the remote
# config.toml before the remote re-syncs — no manual copy, no drift.

# Keys a worker box must share with main to reach its DB and RPC.
SHARED_WORKER_SECRETS="POSTGRES_PASSWORD POSTGRES_BACKUP_PASSWORD AUTH_SECRET SECRET_KEY CMS_SECRET_KEY RANKING_PASSWORD"

# Print KEY="value" lines for the shared secrets present in $1 (.env).
build_secrets_fragment() {
  local env_file="$1" key raw val
  for key in $SHARED_WORKER_SECRETS; do
    raw="$(awk -F= -v k="$key" '$1==k {v=$0; sub(/^[^=]*=/,"",v); gsub(/^[ \t]+|[ \t\r]+$/,"",v); print v; exit}' "$env_file" 2>/dev/null || true)"
    val="$raw"
    case "$val" in
      \"*\") val="${val#\"}"; val="${val%\"}" ;;
    esac
    [ -n "$val" ] || continue
    val="$(printf '%s' "$val" | sed 's/\\/\\\\/g; s/"/\\"/g')"
    printf '%s="%s"\n' "$key" "$val"
  done
}

# Push shared secrets to user@host:<repo-path>: merge into remote
# config.toml, then re-sync there. Returns nonzero on any failure.
push_worker_secrets() {
  local target="$1" repo_path="$2"
  local userhost="${target%%:*}" frag
  [ -n "$repo_path" ] || repo_path="${target#*:}"
  if [ "$repo_path" = "$target" ]; then
    echo "[FAIL] push target must be user@host:/remote/repo/path" >&2
    return 1
  fi
  frag="$(mktemp)"
  build_secrets_fragment ".env" > "$frag"
  if [ ! -s "$frag" ]; then
    echo "[WARN] no shared secrets in .env — nothing to push" >&2
    rm -f "$frag"
    return 0
  fi
  scp -q "$frag" "$userhost:/tmp/cms-worker-secrets.env" || { rm -f "$frag"; return 1; }
  rm -f "$frag"
  ssh -q "$userhost" "cd '$repo_path' && python3 - /tmp/cms-worker-secrets.env <<'PYEOF'
import sys
from pathlib import Path
frag = Path(sys.argv[1]).read_text().splitlines()
toml = Path('config.toml')
text = toml.read_text() if toml.exists() else '[worker]\n'
vals = {}
for line in frag:
    if '=' in line:
        k, v = line.split('=', 1)
        vals[k.strip()] = v.strip()
lines = text.splitlines()
seen = set()
out = []
for line in lines:
    s = line.strip()
    key = s.split('=')[0].strip() if '=' in s else ''
    if key in vals and not s.startswith('#'):
        out.append(f'{key} = {vals[key]}')
        seen.add(key)
    else:
        out.append(line)
for key, val in vals.items():
    if key not in seen:
        out.append(f'{key} = {val}')
toml.write_text('\n'.join(out) + '\n')
PYEOF
bash scripts/__config_sync.sh --no-secrets" || return 1
  echo "[INFO] secrets pushed to $target and re-synced"
}
