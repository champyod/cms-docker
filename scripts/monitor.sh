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

get_cpu_usage() {
    read cpu a b c previdle e f g h < /proc/stat
    prevtotal=$((a+b+c+previdle+e+f+g+h))
    sleep 0.5
    read cpu a b c idle e f g h < /proc/stat
    total=$((a+b+c+idle+e+f+g+h))
    cpu_usage=$((100*( (total-prevtotal) - (idle-previdle) ) / (total-prevtotal) ))
    echo "$cpu_usage"
}

get_mem_usage() {
    # Try to support both old and new 'free' output
    # 'available' is the best metric, found in column 7 in newer procps
    # free output keys: total used free shared buff/cache available
    while read -r line; do
        if [[ $line == Mem:* ]]; then
            set -- $line
            local total=$2
            local used=$3
            local free=$4
            local available=$7
            
            # If available is present, use it: Usage = (Total - Available) / Total
            if [ -n "$available" ]; then
                echo $(( 100 * (total - available) / total ))
            else
                # Fallback: Usage = Used / Total
                echo $(( 100 * used / total ))
            fi
            return
        fi
    done < <(free -m)
}

get_disk_usage() {
    local target="${DISK_PATH:-/}"
    df "$target" | tail -1 | awk '{print $5}' | sed 's/%//'
}

send_discord_alert() {
    local status="$1"     # ALERT or RESOLVED
    local message="$2"
    local color="$3"      # Decimal color code
    local mention="$4"    # Optional mention string
    
    local timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    
    # JSON Construction
    # Using a constructed string to avoid dependency on jq, though jq is safer.
    # Escaping quotes in message is important if message contains quotes.
    # For simple usage here, we assume safe messages.
    
    cat <<EOF > /tmp/discord_payload.json
{
  "content": "$mention",
  "embeds": [
    {
      "title": "Server Status: $status",
      "description": "$message",
      "color": $color,
      "fields": [
        { "name": "CPU", "value": "${CPU_USAGE}%", "inline": true },
        { "name": "Memory", "value": "${MEM_USAGE}%", "inline": true },
        { "name": "Disk", "value": "${DISK_USAGE}%", "inline": true },
        { "name": "Docker", "value": "${DOCKER_STATUS}", "inline": false }
      ],
      "footer": { "text": "$HOSTNAME" },
      "timestamp": "$timestamp"
    }
  ]
}
EOF

    if [ -n "$WEBHOOK_URL" ]; then
        curl -s -H "Content-Type: application/json" -X POST -d @/tmp/discord_payload.json "$WEBHOOK_URL" > /dev/null
    else
        echo "Error: DISCORD_WEBHOOK_URL missing"
    fi
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

    # Evaluation
    IS_ALERT=false
    FAIL_REASON=""

    if [ "$CPU_USAGE" -ge "$CPU_THRESHOLD" ]; then IS_ALERT=true; FAIL_REASON="${FAIL_REASON}High CPU ($CPU_USAGE%). "; fi
    if [ "$MEM_USAGE" -ge "$MEM_THRESHOLD" ]; then IS_ALERT=true; FAIL_REASON="${FAIL_REASON}High Memory ($MEM_USAGE%). "; fi
    if [ "$DISK_USAGE" -ge "$DISK_THRESHOLD" ]; then IS_ALERT=true; FAIL_REASON="${FAIL_REASON}High Disk ($DISK_USAGE%). "; fi

    echo "Stats: CPU=$CPU_USAGE% Mem=$MEM_USAGE% Disk=$DISK_USAGE% Alert=$IS_ALERT"

    # State Machine
    CURRENT_TIME=$(date +%s)
    
    if [ "$IS_ALERT" = true ]; then
        if [ "$PREV_STATE" = "OK" ]; then
            # New Alert
            send_discord_alert "WARNING" "$FAIL_REASON" 16711680 "${USER_ID:+<@$USER_ID>}"
            LAST_ALERT_TIME=$CURRENT_TIME
            PREV_STATE="ALERT"
        elif [ "$PREV_STATE" = "ALERT" ]; then
            # Ongoing Alert - Check cooldown
            TIME_DIFF=$((CURRENT_TIME - LAST_ALERT_TIME))
            if [ "$TIME_DIFF" -ge "$COOLDOWN" ]; then
                send_discord_alert "WARNING (Ongoing)" "$FAIL_REASON" 16711680 "${USER_ID:+<@$USER_ID>}"
                LAST_ALERT_TIME=$CURRENT_TIME
            fi
        fi
    else
        # Status is OK
        if [ "$PREV_STATE" = "ALERT" ]; then
            # Recovery
            send_discord_alert "RESOLVED" "All systems normal." 65280 "" # Green
            PREV_STATE="OK"
        fi
        # If OK -> OK, do nothing (maybe heartbeat logic later)
        PREV_STATE="OK"
    fi
}

# Main Execution
PREV_STATE="OK"
LAST_ALERT_TIME=0

if [ "$DAEMON_MODE" = true ]; then
    echo "Starting monitoring daemon (Interval: ${CHECK_INTERVAL}s)..."
    while true; do
        check_once
        sleep "$CHECK_INTERVAL"
    done
else
    check_once
fi
