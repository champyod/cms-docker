#!/bin/bash
set -e

# Define files
ENV_FILE=".env.core"
WORKER_ENV_FILE=".env.worker"
CONFIG_FILE="config/cms.toml"
RANKING_CONFIG_FILE="config/cms_ranking.toml"

echo "Running configuration injection script..."

if [ ! -f "$ENV_FILE" ]; then
    echo "Error: $ENV_FILE not found."
    exit 1
fi

if [ ! -f "$CONFIG_FILE" ]; then
    echo "Error: $CONFIG_FILE not found."
    exit 1
fi

if [ ! -f "$RANKING_CONFIG_FILE" ]; then
    echo "Info: $RANKING_CONFIG_FILE not found, skipping ranking injection."
    SKIP_RANKING=true
fi

# Function to get value from env file
get_env_val() {
    grep "^$1=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '\r'
}

get_worker_env_val() {
    if [ -f "$WORKER_ENV_FILE" ]; then
        grep "^$1=" "$WORKER_ENV_FILE" | cut -d '=' -f2- | tr -d '\r'
    fi
}

# Read variables
DB_USER=$(get_env_val "POSTGRES_USER")
DB_PASS=$(get_env_val "POSTGRES_PASSWORD")
DB_NAME=$(get_env_val "POSTGRES_DB")
DB_HOST=$(get_env_val "POSTGRES_HOST")
DB_PORT=$(get_env_val "POSTGRES_PORT")
CMS_SECRET=$(get_env_val "CMS_SECRET_KEY")
TAILSCALE_IP=$(get_env_val "TAILSCALE_IP")
CORE_SERVICES_IP=$(get_env_val "CORE_SERVICES_IP")

# Default values if missing
DB_USER=${DB_USER:-$(get_worker_env_val "POSTGRES_USER")}
DB_PASS=${DB_PASS:-$(get_worker_env_val "POSTGRES_PASSWORD")}
DB_NAME=${DB_NAME:-$(get_worker_env_val "POSTGRES_DB")}
DB_HOST=${DB_HOST:-$(get_worker_env_val "POSTGRES_HOST")}
DB_PORT=${DB_PORT:-$(get_worker_env_val "POSTGRES_PORT")}

DB_USER=${DB_USER:-cmsuser}
DB_PASS=${DB_PASS:-your_password_here}
DB_NAME=${DB_NAME:-cmsdb}
DB_HOST=${DB_HOST:-database}
DB_PORT=${DB_PORT:-5432}

# Safely escape special characters for sed: | & \ /
# We use | as delimiter, so we escape | and \
SAFE_PASS=$(echo "$DB_PASS" | sed 's/\\/\\\\/g' | sed 's/|/\\|/g' | sed 's/&/\\&/g')
echo "Injecting configuration:"
echo "  - DB Host: $DB_HOST:$DB_PORT"
echo "  - DB User: $DB_USER"
echo "  - DB Name: $DB_NAME"

# Export variables for Python
export DB_USER DB_PASS DB_NAME DB_HOST DB_PORT CMS_SECRET

# Handle Ranking Scoreboard Auth
# We check environment variables which are populated by 'make env'
# These might be in .env.contest
R_USER=$(grep "^RANKING_USERNAME=" .env.contest 2>/dev/null | cut -d '=' -f2-)
R_PASS=$(grep "^RANKING_PASSWORD=" .env.contest 2>/dev/null | cut -d '=' -f2-)
R_USER=${R_USER:-usern4me}
R_PASS=${R_PASS:-passw0rd}

# Escape username/password for sed in Ranking Config
SAFE_R_USER=$(echo "$R_USER" | sed 's/\\/\\\\/g' | sed 's/|/\\|/g' | sed 's/&/\\&/g')
SAFE_R_PASS=$(echo "$R_PASS" | sed 's/\\/\\\\/g' | sed 's/|/\\|/g' | sed 's/&/\\&/g')

export R_USER SAFE_R_PASS

# Perform replacements using Python for better robustness (it won't break if the sample placeholder is gone)
python3 - << 'PY'
import os
import re
from pathlib import Path

config_path = Path("config/cms.toml")
if not config_path.exists():
    exit(0)

text = config_path.read_text()

# Update Database URL
user = os.environ.get("DB_USER", "cmsuser")
pw = os.environ.get("DB_PASS", "your_password_here")
host = os.environ.get("DB_HOST", "database")
port = os.environ.get("DB_PORT", "5432")
db = os.environ.get("DB_NAME", "cmsdb")

# This regex matches the SQLAlchemy URL pattern in TOML
# We match everything inside the quotes of url = "..."
db_url_pattern = r'^url = "postgresql\+psycopg2://.*"'
new_url = f'url = "postgresql+psycopg2://{user}:{pw}@{host}:{port}/{db}"'

if re.search(db_url_pattern, text, re.MULTILINE):
    text = re.sub(db_url_pattern, new_url, text, flags=re.MULTILINE)
else:
    # Fallback if the pattern doesn't match
    text = text.replace('url = "postgresql+psycopg2://cmsuser:your_password_here@database:5432/cmsdb"', new_url)

# Update secret key if present
cms_secret = os.environ.get("CMS_SECRET", "")
if cms_secret:
    text = re.sub(r'^secret_key = ".*"', f'secret_key = "{cms_secret}"', text, flags=re.MULTILINE)

# Update Ranking credentials in ProxyService URL
r_user = os.environ.get("R_USER", "usern4me")
r_pass = os.environ.get("SAFE_R_PASS", "passw0rd")
# match rankings = ["http://user:pass@..."]
rank_url_pattern = r'rankings = \["http://[^:]+:[^@]+@'
new_rank_start = f'rankings = ["http://{r_user}:{r_pass}@'
text = re.sub(rank_url_pattern, new_rank_start, text)

# Global replacements
text = text.replace('"127.0.0.1"', '"0.0.0.0"')
text = text.replace('["127.0.0.1"]', '["0.0.0.0"]')

config_path.write_text(text)
PY

# Update Ranking Config File
if [ "$SKIP_RANKING" != "true" ]; then
    sed -i "s|^username = \".*\"|username = \"$SAFE_R_USER\"|g" "$RANKING_CONFIG_FILE"
    sed -i "s|^password = \".*\"|password = \"$SAFE_R_PASS\"|g" "$RANKING_CONFIG_FILE"
fi

# Use Python to surgically remove any existing Worker block and provide a clean insertion point
python3 - << 'PY'
from pathlib import Path
import re

config_path = Path("config/cms.toml")
if not config_path.exists():
    exit(0)

text = config_path.read_text()

# Pattern to match Worker block: 
# It can be 'Worker = [...]' or '# Worker = [...]' spanning multiple lines.
lines = text.splitlines()
new_lines = []
skip_until = -1

for i, line in enumerate(lines):
    if i <= skip_until:
        continue
    
    stripped = line.strip()
    if (stripped.startswith("Worker = [") or stripped.startswith("# Worker = [") or stripped == "# Worker ="):
        depth = 0
        j = i
        while j < len(lines):
            depth += lines[j].count("[")
            depth -= lines[j].count("]")
            if depth <= 0 and (j > i or "]" in lines[j]):
                skip_until = j
                break
            j += 1
        continue
    
    new_lines.append(line)

config_path.write_text("\n".join(new_lines) + "\n")
PY

# Build Worker array from WORKER_N environment variables
echo "Building worker configuration..."
WORKER_ARRAY=""
WORKER_COUNT=0

while IFS='=' read -r key value; do
    case "$key" in
        WORKER_[0-9]*)
            worker_index=$(echo "$key" | sed 's/WORKER_//')
            worker_host=$(echo "$value" | cut -d ':' -f1)
            worker_port=$(echo "$value" | cut -d ':' -f2)

            if [ -z "$worker_host" ] || [ -z "$worker_port" ]; then
                echo "  - Skipping invalid $key=$value"
                continue
            fi

            case "$worker_port" in
                ''|*[!0-9]*)
                    echo "  - Skipping invalid port in $key=$value"
                    continue
                    ;;
            esac

            if [ -z "$WORKER_ARRAY" ]; then
                WORKER_ARRAY="[\"$worker_host\", $worker_port]"
            else
                WORKER_ARRAY=$(printf "%s,\n    [\"%s\", %s]" "$WORKER_ARRAY" "$worker_host" "$worker_port")
            fi

            WORKER_COUNT=$((WORKER_COUNT + 1))
            echo "  - Worker $worker_index: $worker_host:$worker_port"
            ;;
    esac
done < <(grep '^WORKER_[0-9]\+=' "$ENV_FILE" | sort -t '_' -k2,2n)

# Inject workers into cms.toml
if [ $WORKER_COUNT -gt 0 ]; then
    # Create the formatted worker array with actual newlines
    WORKER_SECTION=$(printf "Worker = [\n    %s\n]" "$WORKER_ARRAY")
    
    # Use a more robust way to insert after EvaluationService
    export WORKER_SECTION
    python3 - << 'PY'
import os
import re
from pathlib import Path

config_path = Path("config/cms.toml")
worker_section = os.environ.get("WORKER_SECTION", "")

if config_path.exists() and worker_section:
    text = config_path.read_text()
    if "EvaluationService =" in text:
        # Check if Worker already exists (double safety)
        if re.search(r'^Worker = \[', text, re.MULTILINE):
             text = re.sub(r'^Worker = \[.*?^\]', worker_section, text, flags=re.MULTILINE | re.DOTALL)
        else:
            # Insert after EvaluationService
            lines = text.splitlines()
            new_lines = []
            for line in lines:
                new_lines.append(line)
                if line.strip().startswith("EvaluationService ="):
                    new_lines.append(worker_section)
            text = "\n".join(new_lines) + "\n"
        
        config_path.write_text(text)
PY
    echo "Injected $WORKER_COUNT worker(s) into configuration."
else
    echo "No workers configured. Existing Worker block removed if present."
fi

echo "Configuration injection complete."
