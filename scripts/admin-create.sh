#!/bin/bash
# CMS Admin Account Creation Script
# Creates admin accounts compatible with both CMS core AWS and the Admin Panel
# Writes directly to the admins table with full permission support
#
# Usage:
#   ./admin-create.sh                     # Interactive mode
#   ./admin-create.sh <username>          # Interactive for password/perms
#   ./admin-create.sh <username> -p <pass>  # Minimal args
#   ./admin-create.sh <username> -p <pass> --superadmin  # Full CLI mode
#
# Options:
#   -p, --password <pass>    Set password (omit for prompt)
#   -n, --name <name>        Display name (defaults to username)
#   --superadmin             Grant all permissions (default)
#   --no-messaging           Deny messaging permission
#   --no-tasks               Deny task management permission
#   --no-users               Deny user management permission
#   --no-contests            Deny contest management permission
#   -h, --help               Show this help

set -e

# --- Config ---
DB_CONTAINER="cms-database"
LOG_CONTAINER="cms-log-service"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()   { echo -e "${RED}[ERROR]${NC} $1"; }

# --- Help ---
usage() {
    sed -n '2,20p' "$0" | sed 's/^# \?//'
    exit 0
}

# --- Parse args ---
USERNAME=""
PASSWORD=""
DISPLAY_NAME=""
SUPERADMIN=true
PERM_MESSAGING=true
PERM_TASKS=true
PERM_USERS=true
PERM_CONTESTS=true

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help) usage ;;
        -p|--password) PASSWORD="$2"; shift 2 ;;
        -n|--name) DISPLAY_NAME="$2"; shift 2 ;;
        --superadmin) SUPERADMIN=true; shift ;;
        --no-messaging) PERM_MESSAGING=false; shift ;;
        --no-tasks) PERM_TASKS=false; shift ;;
        --no-users) PERM_USERS=false; shift ;;
        --no-contests) PERM_CONTESTS=false; shift ;;
        -*)
            # If an unknown flag is passed after positional, it's ambiguous
            if [ -n "$USERNAME" ]; then
                echo "Unknown option: $1"
                usage
            fi
            warn "Unknown option: $1 (ignored)"
            shift
            ;;
        *)
            if [ -z "$USERNAME" ]; then
                USERNAME="$1"
            else
                err "Unexpected argument: $1"
                usage
            fi
            shift
            ;;
    esac
done

# --- Interactive prompts ---
if [ -z "$USERNAME" ]; then
    read -p "Username: " USERNAME
fi

if [ -z "$PASSWORD" ]; then
    read -s -p "Password: " PASSWORD
    echo ""
    read -s -p "Confirm password: " PASSWORD_CONFIRM
    echo ""
    if [ "$PASSWORD" != "$PASSWORD_CONFIRM" ]; then
        err "Passwords do not match."
        exit 1
    fi
fi

if [ -z "$DISPLAY_NAME" ]; then
    read -p "Display name [$USERNAME]: " DISPLAY_NAME
    DISPLAY_NAME=${DISPLAY_NAME:-$USERNAME}
fi

if [ "$SUPERADMIN" = true ]; then
    echo ""
    read -p "Grant superadmin (all permissions)? [Y/n]: " IS_SUPERADMIN
    if [[ "$IS_SUPERADMIN" =~ ^[Nn] ]]; then
        SUPERADMIN=false
        echo "Select granular permissions:"
        read -p "  Messaging? [Y/n]: " p && [[ "$p" =~ ^[Nn] ]] && PERM_MESSAGING=false || PERM_MESSAGING=true
        read -p "  Task management? [Y/n]: " p && [[ "$p" =~ ^[Nn] ]] && PERM_TASKS=false || PERM_TASKS=true
        read -p "  User management? [Y/n]: " p && [[ "$p" =~ ^[Nn] ]] && PERM_USERS=false || PERM_USERS=true
        read -p "  Contest management? [Y/n]: " p && [[ "$p" =~ ^[Nn] ]] && PERM_CONTESTS=false || PERM_CONTESTS=true
    fi
fi

# --- Validate ---
if [ ${#USERNAME} -lt 2 ]; then
    err "Username must be at least 2 characters."
    exit 1
fi
if [ ${#PASSWORD} -lt 6 ]; then
    err "Password must be at least 6 characters."
    exit 1
fi

# --- Check docker ---
if ! docker ps &>/dev/null; then
    err "Docker is not running or not accessible."
    exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
    err "Database container '$DB_CONTAINER' is not running."
    err "Deploy core services first: make core-img"
    exit 1
fi

# --- Load DB credentials from .env.core ---
ENV_FILE=".env.core"
DB_USER="cmsuser"
DB_PASS=""
DB_NAME="cmsdb"

if [ -f "$ENV_FILE" ]; then
    DB_USER=$(grep "^POSTGRES_USER=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '\r' || echo "cmsuser")
    DB_PASS=$(grep "^POSTGRES_PASSWORD=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '\r' || true)
    DB_NAME=$(grep "^POSTGRES_DB=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '\r' || echo "cmsdb")
fi

if [ -z "$DB_PASS" ]; then
    err "Could not read POSTGRES_PASSWORD from $ENV_FILE"
    exit 1
fi

# --- Generate bcrypt hash ---
info "Generating password hash..."
HASH=""

# Method 1: Python3 + bcrypt
if command -v python3 &>/dev/null; then
    HASH=$(python3 -c "
import bcrypt, sys
try:
    h = bcrypt.hashpw(sys.argv[1].encode(), bcrypt.gensalt(rounds=10)).decode()
    print(h)
except Exception:
    sys.exit(1)
" "$PASSWORD" 2>/dev/null) || HASH=""
fi

# Method 2: Docker container with bcrypt
if [ -z "$HASH" ]; then
    warn "Python bcrypt not available locally. Trying cms-log-service container..."
    if docker ps --format '{{.Names}}' | grep -q "^${LOG_CONTAINER}$"; then
        HASH=$(docker exec "$LOG_CONTAINER" python3 -c "
import bcrypt, sys
try:
    h = bcrypt.hashpw(sys.argv[1].encode(), bcrypt.gensalt(rounds=10)).decode()
    print(h)
except Exception:
    sys.exit(1)
" "$PASSWORD" 2>/dev/null) || HASH=""
    fi
fi

# Method 3: python:3-slim docker run
if [ -z "$HASH" ]; then
    warn "Temporary python:3-slim container for bcrypt..."
    HASH=$(docker run --rm python:3-slim sh -c "
pip install bcrypt -q && python3 -c \"
import bcrypt, sys
h = bcrypt.hashpw(sys.argv[1].encode(), bcrypt.gensalt(rounds=10)).decode()
print(h)
\" \"$PASSWORD\"" 2>/dev/null) || HASH=""
fi

if [ -z "$HASH" ]; then
    err "Could not generate bcrypt hash. Install bcrypt: pip install bcrypt"
    exit 1
fi

AUTH_STRING="bcrypt:${HASH}"
ok "Hash generated."

# --- Check if admin already exists ---
EXISTS=$(docker exec -i -e PGPASSWORD="$DB_PASS" "$DB_CONTAINER" \
    psql -U "$DB_USER" -d "$DB_NAME" -tAc \
    "SELECT 1 FROM admins WHERE username='${USERNAME//\'/\'\'}';" 2>/dev/null)

if [ "$EXISTS" = "1" ]; then
    # Update existing admin with new permissions
    info "Admin '$USERNAME' already exists. Updating permissions and password..."
    docker exec -i -e PGPASSWORD="$DB_PASS" "$DB_CONTAINER" \
        psql -U "$DB_USER" -d "$DB_NAME" -c \
        "UPDATE admins SET
            authentication='${AUTH_STRING//\'/\'\'}',
            name='${DISPLAY_NAME//\'/\'\'}',
            enabled=true,
            permission_all=$( [[ "$SUPERADMIN" = true ]] && echo true || echo false ),
            permission_messaging=$PERM_MESSAGING,
            permission_tasks=$PERM_TASKS,
            permission_users=$PERM_USERS,
            permission_contests=$PERM_CONTESTS
        WHERE username='${USERNAME//\'/\'\'}';" >/dev/null
    ok "Admin '$USERNAME' updated."
else
    # Create new admin
    info "Creating admin '$USERNAME'..."
    docker exec -i -e PGPASSWORD="$DB_PASS" "$DB_CONTAINER" \
        psql -U "$DB_USER" -d "$DB_NAME" -c \
        "INSERT INTO admins (
            username, authentication, name, enabled,
            permission_all, permission_messaging, permission_tasks,
            permission_users, permission_contests
        ) VALUES (
            '${USERNAME//\'/\'\'}',
            '${AUTH_STRING//\'/\'\'}',
            '${DISPLAY_NAME//\'/\'\'}',
            true,
            $( [[ "$SUPERADMIN" = true ]] && echo true || echo false ),
            $PERM_MESSAGING, $PERM_TASKS,
            $PERM_USERS, $PERM_CONTESTS
        );" >/dev/null
    ok "Admin '$USERNAME' created."
fi

# --- Summary ---
echo ""
echo "╔═══════════════════════════════════════╗"
echo "║        Admin Account Created          ║"
echo "╠═══════════════════════════════════════╣"
echo "║ Username:   $USERNAME"
echo "║ Name:       $DISPLAY_NAME"
echo "║ Password:   (set)"
echo "║ Superadmin: $SUPERADMIN"
if [ "$SUPERADMIN" != true ]; then
    echo "║ Permissions:"
    echo "║   Messaging: $PERM_MESSAGING"
    echo "║   Tasks:     $PERM_TASKS"
    echo "║   Users:     $PERM_USERS"
    echo "║   Contests:  $PERM_CONTESTS"
fi
echo "╠═══════════════════════════════════════╣"
echo "║ Login at:  http://localhost:8891      ║"
echo "╚═══════════════════════════════════════╝"
echo ""
info "CMS Classic AWS also accessible at http://localhost:8889"
