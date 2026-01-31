#!/bin/bash

# Configuration
# It is recommended to load these from an environment file or set them in the environment
# e.g., source .env
ENV_FILE="$(dirname "$0")/../.env"
if [ -f "$ENV_FILE" ]; then
    set -a
    source "$ENV_FILE"
    set +a
fi

WEBHOOK_URL="${DISCORD_WEBHOOK_URL:-}"
USER_ID="${DISCORD_USER_ID:-}"
HOSTNAME=$(hostname)

# Settings
CHECK_INTERVAL=${MONITOR_INTERVAL:-10}       # Seconds between checks
COOLDOWN=${MONITOR_COOLDOWN:-300}            # Seconds to wait before re-alerting on persistent error
CPU_THRESHOLD=${MONITOR_CPU_THRESHOLD:-80}
MEM_THRESHOLD=${MONITOR_MEM_THRESHOLD:-80}
DISK_THRESHOLD=${MONITOR_DISK_THRESHOLD:-80}

# Backup Settings
BACKUP_INTERVAL_MINS=${BACKUP_INTERVAL_MINS:-1440} # Default 24h
LAST_BACKUP_TIME=0

# Mode
DAEMON_MODE=false

# Helper Functions
usage() {
    echo "Usage: $0 [-d] [-i interval] [-c cooldown]"
    echo "  -d          Daemon mode (loop forever)"
    echo "  -i seconds  Check interval (default: 10)"
    echo "  -c seconds  Cooldown for re-alerts (default: 300)"
    exit 1
}

while getopts "di:c:h" opt; do
    case $opt in
        d) DAEMON_MODE=true ;;
        i) CHECK_INTERVAL=$OPTARG ;;
        c) COOLDOWN=$OPTARG ;;
        h) usage ;;
        *) usage ;;
    esac
done

# ... (get_cpu_usage, get_mem_usage, get_disk_usage same)

send_discord_notification() {
    local title="$1"
    local message="$2"
    local color="$3"
    
    local timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    
    cat <<EOF > /tmp/discord_notif.json
{
  "embeds": [
    {
      "title": "$title",
      "description": "$message",
      "color": $color,
      "footer": { "text": "$HOSTNAME" },
      "timestamp": "$timestamp"
    }
  ]
}
EOF

    if [ -n "$WEBHOOK_URL" ]; then
        curl -s -H "Content-Type: application/json" -X POST -d @/tmp/discord_notif.json "$WEBHOOK_URL" > /dev/null
    fi
}

listen_docker_events() {
    echo "Starting Docker event listener..."
    # Filter for interesting events
    docker events --filter 'event=start' --filter 'event=stop' --filter 'event=die' --filter 'event=restart' --format '{{.Status}} container {{.Actor.Attributes.name}}' | while read -r event; do
        COLOR=3447003 # Blue
        case "$event" in
            *"start"*) COLOR=65280 ;; # Green
            *"stop"*) COLOR=16711680 ;; # Red
            *"die"*) COLOR=16711680 ;;
            *"restart"*) COLOR=16753920 ;; # Orange
        esac
        send_discord_notification "Docker Event" "🔄 **$event**" $COLOR
    done
}

check_once() {
    CPU_USAGE=$(get_cpu_usage)
    MEM_USAGE=$(get_mem_usage)
    DISK_USAGE=$(get_disk_usage)
    
    DOCKER_STATUS="N/A"
    if command -v docker &> /dev/null; then
        RUNNING=$(docker ps -q | wc -l)
        EXITED=$(docker ps -q -f status=exited | wc -l)
        DOCKER_STATUS="$RUNNING running, $EXITED exited"
    fi

    # ... (Evaluation logic same)

    # State Machine
    CURRENT_TIME=$(date +%s)
    
    # ... (State machine logic same)

    # Periodic Backup Logic
    BACKUP_INTERVAL_SECS=$((BACKUP_INTERVAL_MINS * 60))
    if [ "$BACKUP_INTERVAL_MINS" -gt 0 ]; then
        if [ $((CURRENT_TIME - LAST_BACKUP_TIME)) -ge "$BACKUP_INTERVAL_SECS" ]; then
            echo "Triggering scheduled backup..."
            bun /usr/local/bin/cms-backup.ts &
            LAST_BACKUP_TIME=$CURRENT_TIME
        fi
    fi
}

# Main Execution
PREV_STATE="OK"
LAST_ALERT_TIME=0
LAST_BACKUP_TIME=0

if [ "$DAEMON_MODE" = true ]; then
    echo "Starting monitoring daemon (Interval: ${CHECK_INTERVAL}s)..."
    
    # Start event listener in background
    listen_docker_events &
    
    while true; do
        check_once
        sleep "$CHECK_INTERVAL"
    done
else
    check_once
fi
