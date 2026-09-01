#!/bin/bash
set -euo pipefail

# Source shared helpers if present — guard for absence per contract.
if [[ -f "__lib/common.sh" ]]; then
  # shellcheck source=/dev/null
  source "__lib/common.sh"
elif [[ -f "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh" ]]; then
  # shellcheck source=/dev/null
  source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
fi
# Fallback log helpers when common.sh is absent.
if ! declare -F log_info >/dev/null 2>&1; then
  log_info() { printf '[INFO] %s\n' "$*"; }
fi
if ! declare -F log_warn >/dev/null 2>&1; then
  log_warn() { printf '[WARN] %s\n' "$*" >&2; }
fi
if ! declare -F log_die >/dev/null 2>&1; then
  log_die() { printf '[FAIL] %s\n' "${1:-fatal}" >&2; exit "${2:-1}"; }
fi

ENV_FILE=".env.core"
WORKER_ENV_FILE=".env.worker"
CONFIG_FILE="config/cms.toml"
RANKING_CONFIG_FILE="config/cms_ranking.toml"
SKIP_RANKING=false

echo "Running configuration injection script..."

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found."
  exit 1
fi
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Error: $CONFIG_FILE not found."
  exit 1
fi
if [[ ! -f "$RANKING_CONFIG_FILE" ]]; then
  echo "Info: $RANKING_CONFIG_FILE not found, skipping ranking injection."
  SKIP_RANKING=true
fi

# Exact key match via awk -F= (avoids regex metachars in key).
get_env_val() {
  local key="$1"
  local file="$ENV_FILE"
  awk -F= -v k="$key" '$1==k { v=$0; sub(/^[^=]*=/, "", v); print v; exit }' "$file" 2>/dev/null | tr -d '\r' || true
}
get_worker_env_val() {
  local key="$1"
  local file="$WORKER_ENV_FILE"
  [[ -f "$file" ]] || return 0
  awk -F= -v k="$key" '$1==k { v=$0; sub(/^[^=]*=/, "", v); print v; exit }' "$file" 2>/dev/null | tr -d '\r' || true
}

# Helper: exact match from arbitrary file (for .env.contest).
get_kv_from_file() {
  local key="$1" file="$2"
  [[ -f "$file" ]] || return 0
  awk -F= -v k="$key" '$1==k { v=$0; sub(/^[^=]*=/, "", v); print v; exit }' "$file" 2>/dev/null | tr -d '\r' || true
}

DB_USER="$(get_env_val "POSTGRES_USER")"
DB_PASS="$(get_env_val "POSTGRES_PASSWORD")"
DB_NAME="$(get_env_val "POSTGRES_DB")"
DB_HOST="$(get_env_val "POSTGRES_HOST")"
DB_PORT="$(get_env_val "POSTGRES_PORT")"
CMS_SECRET="$(get_env_val "CMS_SECRET_KEY")"
TAILSCALE_IP="$(get_env_val "TAILSCALE_IP")"
CORE_SERVICES_IP="$(get_env_val "CORE_SERVICES_IP")"

DB_USER="${DB_USER:-$(get_worker_env_val "POSTGRES_USER")}"
DB_PASS="${DB_PASS:-$(get_worker_env_val "POSTGRES_PASSWORD")}"
DB_NAME="${DB_NAME:-$(get_worker_env_val "POSTGRES_DB")}"
DB_HOST="${DB_HOST:-$(get_worker_env_val "POSTGRES_HOST")}"
DB_PORT="${DB_PORT:-$(get_worker_env_val "POSTGRES_PORT")}"

DB_USER="${DB_USER:-cmsuser}"
DB_PASS="${DB_PASS:-your_password_here}"
DB_NAME="${DB_NAME:-cmsdb}"
# cms.toml on the MAIN server is consumed only by this host's containers, which
# reach Postgres through the compose network service name ("database") — never a
# routable IP, which is unreachable from inside the docker bridge and breaks RPC.
# REMOTE workers have no such container: set WORKER_DB_HOST (+ WORKER_DB_PORT)
# in .env.worker so cms.toml points at the main server's routable address instead.
if [[ -n "$(get_worker_env_val "WORKER_DB_HOST")" ]]; then
  DB_HOST="$(get_worker_env_val "WORKER_DB_HOST")"
  _W_DB_PORT="$(get_worker_env_val "WORKER_DB_PORT")"
  [[ -n "$_W_DB_PORT" ]] && DB_PORT="$_W_DB_PORT"
else
  DB_HOST="database"
  DB_PORT="${DB_PORT:-5432}"
fi

echo "Injecting configuration:"
echo "  - DB Host: $DB_HOST:$DB_PORT"
echo "  - DB User: $DB_USER"
echo "  - DB Name: $DB_NAME"

export DB_USER DB_PASS DB_NAME DB_HOST DB_PORT CMS_SECRET TAILSCALE_IP CORE_SERVICES_IP

# Ranking Scoreboard auth — exact-match reads, never via grep regex.
R_USER="$(get_kv_from_file "RANKING_USERNAME" ".env.contest")"
R_PASS="$(get_kv_from_file "RANKING_PASSWORD" ".env.contest")"
R_USER="${R_USER:-usern4me}"
R_PASS="${R_PASS:-passw0rd}"
export R_USER R_PASS

# Perform replacements using Python for robustness — secrets via env, never argv.
python3 - << 'PY'
import os
import re
from pathlib import Path

config_path = Path("config/cms.toml")
if not config_path.exists():
    exit(0)

text = config_path.read_text()

def toml_escape(v): return v.replace("\\", "\\\\").replace('"', '\\"')

user = os.environ.get("DB_USER", "cmsuser")
pw = os.environ.get("DB_PASS", "your_password_here")
host = os.environ.get("DB_HOST", "database")
port = os.environ.get("DB_PORT", "5432")
db = os.environ.get("DB_NAME", "cmsdb")

# URL-encode user/pw for DB URL, TOML-escape host/db
import urllib.parse as _up
user_q = _up.quote(user, safe='')
pw_q = _up.quote(pw, safe='')
host_e = toml_escape(host)
db_e = toml_escape(db)
db_url_pattern = r'^url = "postgresql\+psycopg2://.*"'
new_url = f'url = "postgresql+psycopg2://{user_q}:{pw_q}@{host_e}:{port}/{db_e}"'

if re.search(db_url_pattern, text, re.MULTILINE):
    text = re.sub(db_url_pattern, lambda m: new_url, text, flags=re.MULTILINE)
else:
    text = text.replace('url = "postgresql+psycopg2://cmsuser:your_password_here@database:5432/cmsdb"', new_url)

cms_secret = os.environ.get("CMS_SECRET", "")
if cms_secret:
    text = re.sub(r'^secret_key = ".*"', lambda m: f'secret_key = "{toml_escape(cms_secret)}"', text, flags=re.MULTILINE)

r_user = os.environ.get("R_USER", "usern4me")
r_pass = os.environ.get("R_PASS", "passw0rd")

# Push target for score feed: same-network service by default. A remote
# ranking node is only assumed when RANKING_REMOTE=1 (then RANKING_PUSH_HOST
# or legacy TAILSCALE_IP supplies the address). Port 8890 is always enforced.
ranking_host = os.environ.get("RANKING_PUSH_HOST", "").strip()
if os.environ.get("RANKING_REMOTE", "").strip() == "1" and not ranking_host:
    ranking_host = os.environ.get("TAILSCALE_IP", "").strip()
if not ranking_host:
    ranking_host = "cms-ranking-web-server"
if ":" not in ranking_host.split("/")[-1]:
    ranking_host += ":8890"

updated_lines = []
for line in text.splitlines():
    if line.startswith('rankings = ["http://'):
        m = re.match(r'^(rankings = \["http://)([^:"]+):([^@"]+)@([^/"]+)(.*)$', line)
        if m:
            r_user_q = _up.quote(r_user, safe='')
            r_pass_q = _up.quote(r_pass, safe='')
            line = f'{m.group(1)}{r_user_q}:{r_pass_q}@{ranking_host}{m.group(5)}'
    updated_lines.append(line)

text = "\n".join(updated_lines) + ("\n" if text.endswith("\n") else "")

# Global replacements — idempotent after first run.
text = text.replace('"127.0.0.1"', '"0.0.0.0"')
text = text.replace('["127.0.0.1"]', '["0.0.0.0"]')

text = re.sub(r'^#\s*log_dir = .*', lambda m: 'log_dir = "/var/local/log/cms"', text, flags=re.MULTILINE)
text = re.sub(r'^#\s*cache_dir = .*', lambda m: 'cache_dir = "/var/local/cache/cms"', text, flags=re.MULTILINE)
text = re.sub(r'^#\s*data_dir = .*', lambda m: 'data_dir = "/var/local/lib/cms"', text, flags=re.MULTILINE)

if 'log_dir =' not in text:
    text = "[global]\nlog_dir = \"/var/local/log/cms\"\n" + text
if 'cache_dir =' not in text:
    text = text.replace('log_dir = "/var/local/log/cms"', 'log_dir = "/var/local/log/cms"\ncache_dir = "/var/local/cache/cms"\ndata_dir = "/var/local/lib/cms"')

config_path.write_text(text)
PY

# Update Ranking Config File — safe write via env (no argv exposure), idempotent.
if [[ "$SKIP_RANKING" != "true" ]]; then
  R_USER="$R_USER" R_PASS="$R_PASS" RANKING_CONFIG_FILE="$RANKING_CONFIG_FILE" python3 - << 'PY'
import os, re
from pathlib import Path
p = Path(os.environ["RANKING_CONFIG_FILE"])
if p.exists():
    t = p.read_text()
    u = os.environ.get("R_USER", "")
    pw = os.environ.get("R_PASS", "")
    def toml_escape(v): return v.replace("\\", "\\\\").replace('"', '\\"')
    t = re.sub(r'^username = ".*"', lambda m: f'username = "{toml_escape(u)}"', t, flags=re.MULTILINE)
    t = re.sub(r'^password = ".*"', lambda m: f'password = "{toml_escape(pw)}"', t, flags=re.MULTILINE)
    # Sync RANKING_LOGO_PATH -> container-side logo_path (if host file set)
    admin_logo = ""
    for env_file in [".env.admin", ".env"]:
        try:
            for line in Path(env_file).read_text().splitlines():
                if line.startswith("RANKING_LOGO_PATH="):
                    admin_logo = line.split("=",1)[1].strip().strip('"').strip("'")
                    break
            if admin_logo: break
        except: pass
    lib_dir = "/var/local/lib/cms/ranking"
    try:
        for line in Path(".env.admin").read_text().splitlines():
            if line.startswith("CMS_RANKING_LIB_DIR="):
                lib_dir = line.split("=",1)[1].strip().strip('"').strip("'") or lib_dir
                break
    except: pass
    t = re.sub(r'^\s*(#\s*)?lib_dir\s*=.*', f'lib_dir = "{lib_dir}"', t, flags=re.MULTILINE)
    if admin_logo:
        ext = admin_logo.rsplit(".",1)[-1].lower() if "." in admin_logo else "png"
        if ext == "jpeg": ext = "jpg"
        if ext not in ("png","jpg","gif","bmp"): ext = "png"
        container_logo = f"{lib_dir}/logo.{ext}"
        if re.search(r'^logo_path\s*=', t, re.MULTILINE):
            t = re.sub(r'^logo_path\s*=.*', lambda m: f'logo_path = "{toml_escape(container_logo)}"', t, flags=re.MULTILINE)
        else:
            if re.search(r'^lib_dir\s*=', t, re.MULTILINE):
                t = re.sub(r'^(lib_dir\s*=.*)', lambda m: m.group(1) + f'\nlogo_path = "{toml_escape(container_logo)}"', t, flags=re.MULTILINE, count=1)
            else:
                t = "lib_dir = \"{}\"\nlogo_path = \"{}\"\n{}".format(lib_dir, container_logo, t)
    else:
        t = re.sub(r'^logo_path\s*=.*\n?', '', t, flags=re.MULTILINE)
    p.write_text(t)
PY
fi

# Build ContestWebServer array from CONTESTS_DEPLOY_CONFIG
echo "Building contest web server configuration..."
CWS_ARRAY=""
CWS_COUNT=0
DEPLOY_CONFIG="$(get_kv_from_file "CONTESTS_DEPLOY_CONFIG" ".env.contest")"
if [[ -n "${DEPLOY_CONFIG:-}" ]] && [[ "$DEPLOY_CONFIG" != "[]" ]]; then
  CWS_SECTION="$(DEPLOY_CONFIG="$DEPLOY_CONFIG" python3 - << 'PY'
import json, os
s = os.environ.get("DEPLOY_CONFIG", "[]")
try:
    data = json.loads(s)
    if not isinstance(data, list):
        print("")
        exit(0)
    entries=[]
    for item in data:
        cid=item.get("id")
        if cid:
            entries.append(f'["cms-contest-web-server-{cid}", 21000]')
    if entries:
        print("ContestWebServer = [\n    " + ",\n    ".join(entries) + "\n]")
    else:
        print("")
except Exception:
    print("")
PY
)"
fi

if [[ -n "${CWS_SECTION:-}" ]]; then
  CWS_SECTION="$CWS_SECTION" python3 - << 'PY'
import os
from pathlib import Path
p = Path("config/cms.toml")
cws = os.environ.get("CWS_SECTION", "")
if p.exists() and cws:
    t = p.read_text()
    lines = t.splitlines()
    # Remove any existing ContestWebServer block(s) by bracket depth — idempotent.
    new_lines=[]
    skip_until=-1
    for i, line in enumerate(lines):
        if i <= skip_until:
            continue
        s=line.strip()
        if s.startswith("ContestWebServer = [") or s.startswith("# ContestWebServer = ["):
            depth=0
            j=i
            while j < len(lines):
                depth += lines[j].count("[")
                depth -= lines[j].count("]")
                if depth <= 0 and (j > i or "]" in lines[j]):
                    skip_until=j
                    break
                j+=1
            continue
        new_lines.append(line)
    # Insert before AdminWebServer (canonical order), fallback to ProxyService or append.
    inserted=False
    out=[]
    for line in new_lines:
        if not inserted and line.strip().startswith("AdminWebServer"):
            out.append(cws)
            inserted=True
        out.append(line)
    if not inserted:
        for idx, line in enumerate(out):
            if line.strip().startswith("ProxyService"):
                out.insert(idx, cws)
                inserted=True
                break
        if not inserted:
            out.append(cws)
    p.write_text("\n".join(out) + "\n")
PY
  echo "Injected contest web server(s) into configuration."
fi

# Surgically remove any existing Worker block — idempotent.
python3 - << 'PY'
from pathlib import Path
import re
p = Path("config/cms.toml")
if not p.exists():
    exit(0)
t = p.read_text()
lines = t.splitlines()
new_lines=[]
skip_until=-1
for i, line in enumerate(lines):
    if i <= skip_until:
        continue
    s=line.strip()
    if s.startswith("Worker = [") or s.startswith("# Worker = [") or s == "# Worker =":
        depth=0
        j=i
        while j < len(lines):
            depth += lines[j].count("[")
            depth -= lines[j].count("]")
            if depth <= 0 and (j > i or "]" in lines[j]):
                skip_until=j
                break
            j+=1
        continue
    new_lines.append(line)
p.write_text("\n".join(new_lines) + "\n")
PY

# Build Worker array from WORKER_N — exact-match enumeration, pipefail-safe.
echo "Building worker configuration..."
WORKER_ARRAY=""
WORKER_COUNT=0

# Collect WORKER_N lines via awk exact prefix (avoids grep regex metachars, pipefail-safe)
tmp_workers="$(mktemp)"
awk -F= '$1 ~ /^WORKER_[0-9]+$/ { print }' "$ENV_FILE" | sort -t '_' -k2,2n > "$tmp_workers" || true
while IFS='=' read -r key value; do
  # Trim possible \r
  value="$(printf '%s' "$value" | tr -d '\r')"
  key="$(printf '%s' "$key" | tr -d '\r' | xargs)"
  case "$key" in
    WORKER_[0-9]*)
      worker_index="$(printf '%s' "$key" | sed 's/WORKER_//')"
      worker_host="$(printf '%s' "$value" | cut -d ':' -f1)"
      worker_port="$(printf '%s' "$value" | cut -d ':' -f2)"
      if [[ -z "$worker_host" || -z "$worker_port" ]]; then
        echo "  - Skipping invalid $key=$value"
        continue
      fi
      case "$worker_port" in
        ''|*[!0-9]*)
          echo "  - Skipping invalid port in $key=$value"
          continue
          ;;
      esac
      if [[ -z "$WORKER_ARRAY" ]]; then
        WORKER_ARRAY="[\"$worker_host\", $worker_port]"
      else
        WORKER_ARRAY="$(printf "%s,\n    [\"%s\", %s]" "$WORKER_ARRAY" "$worker_host" "$worker_port")"
      fi
      WORKER_COUNT=$((WORKER_COUNT + 1))
      echo "  - Worker $worker_index: $worker_host:$worker_port"
      ;;
  esac
done < "$tmp_workers"
rm -f "$tmp_workers"

if [[ "$WORKER_COUNT" -gt 0 ]]; then
  WORKER_SECTION="$(printf "Worker = [\n    %s\n]" "$WORKER_ARRAY")"
  WORKER_SECTION="$WORKER_SECTION" python3 - << 'PY'
import os, re
from pathlib import Path
p = Path("config/cms.toml")
ws = os.environ.get("WORKER_SECTION", "")
if p.exists() and ws:
    t = p.read_text()
    if "EvaluationService =" in t:
        if re.search(r'^Worker = \[', t, re.MULTILINE):
            t = re.sub(r'^Worker = \[.*?^\]', lambda m: ws, t, flags=re.MULTILINE | re.DOTALL)
        else:
            lines = t.splitlines()
            new=[]
            for line in lines:
                new.append(line)
                if line.strip().startswith("EvaluationService ="):
                    new.append(ws)
            t = "\n".join(new) + "\n"
        p.write_text(t)
PY
  echo "Injected $WORKER_COUNT worker(s) into configuration."
else
  echo "No workers configured. Existing Worker block removed if present."
fi

echo "Configuration injection complete."
