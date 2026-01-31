#!/bin/bash

# Configuration
ENV_FILE="$(dirname "$0")/../.env"
if [ -f "$ENV_FILE" ]; then
    set -a
    source "$ENV_FILE"
    set +a
fi

WEBHOOK_URL="${DISCORD_WEBHOOK_URL:-}"
ROLE_ID="${DISCORD_ROLE_ID:-}"
HOSTNAME=$(hostname)

# Settings
CHECK_INTERVAL=${MONITOR_INTERVAL:-10}
COOLDOWN=${MONITOR_COOLDOWN:-300}
CPU_THRESHOLD=${MONITOR_CPU_THRESHOLD:-80}
MEM_THRESHOLD=${MONITOR_MEM_THRESHOLD:-80}
DISK_THRESHOLD=${MONITOR_DISK_THRESHOLD:-80}

# Backup Settings
BACKUP_INTERVAL_MINS=${BACKUP_INTERVAL_MINS:-1440}
LAST_BACKUP_TIME=0

# Mode
DAEMON_MODE=false

usage() {
    echo "Usage: $0 [-d] [-i interval] [-c cooldown]"
    echo "  -d          Daemon mode"
    echo "  -i seconds  Check interval"
    echo "  -c seconds  Cooldown"
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
    while read -r line; do
        if [[ $line == Mem:* ]]; then
            set -- $line
            local total=$2
            local used=$3
            local free=$4
            local available=$7
            if [ -n "$available" ]; then
                echo $(( 100 * (total - available) / total ))
            else
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
    local status="$1"
    local message="$2"
    local color="$3"
    local mention="$4"
    local timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    
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
    fi
}

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

get_container_restart_config() {
    local container_id="$1"
    local config_file="${REPO_ROOT:-$(dirname "$0")/..}/config/container-restart.json"

    if [ ! -f "$config_file" ]; then
        echo "false:5:0"
        return
    fi

    # Try to parse JSON using basic tools (jq if available, otherwise skip)
    if command -v jq &> /dev/null; then
        local auto_restart=$(jq -r ".[\"$container_id\"].autoRestart // false" "$config_file" 2>/dev/null || echo "false")
        local max_restarts=$(jq -r ".[\"$container_id\"].maxRestarts // 5" "$config_file" 2>/dev/null || echo "5")
        local current_restarts=$(jq -r ".[\"$container_id\"].currentRestarts // 0" "$config_file" 2>/dev/null || echo "0")
        echo "$auto_restart:$max_restarts:$current_restarts"
    else
        echo "false:5:0"
    fi
}

should_suppress_notification() {
    local container_name="$1"
    local event_type="$2"

    # Get container ID
    local container_id=$(docker ps -aqf "name=$container_name" 2>/dev/null | head -1)
    if [ -z "$container_id" ]; then
        return 1  # Don't suppress if we can't find container
    fi

    # Get restart count from Docker
    local restart_count=$(docker inspect "$container_id" --format='{{.RestartCount}}' 2>/dev/null || echo "0")

    # Get config
    local config=$(get_container_restart_config "$container_id")
    local auto_restart=$(echo "$config" | cut -d: -f1)
    local max_restarts=$(echo "$config" | cut -d: -f2)

    # If auto-restart is disabled and container is dying/restarting, suppress after first notification
    if [ "$auto_restart" = "false" ] && [ "$event_type" = "die" ] || [ "$event_type" = "restart" ]; then
        # Check if we already notified about this container being disabled
        if grep -q "^${container_name}:disabled:notified" "$NOTIF_CACHE" 2>/dev/null; then
            return 0  # Suppress
        fi
    fi

    # If restart count exceeds max, suppress repeated die/restart notifications
    if [ "$restart_count" -ge "$max_restarts" ] && [ "$event_type" = "die" ] || [ "$event_type" = "restart" ]; then
        # Check if we already notified about limit reached
        if grep -q "^${container_name}:limit:notified" "$NOTIF_CACHE" 2>/dev/null; then
            return 0  # Suppress
        fi
    fi

    return 1  # Don't suppress
}

listen_docker_events() {
    echo "Starting Docker event listener..."
    # Track last notification time per container to prevent spam
    NOTIF_CACHE="/tmp/monitor_notif_cache"
    touch "$NOTIF_CACHE"

    docker events --filter 'event=start' --filter 'event=stop' --filter 'event=die' --filter 'event=restart' --format '{{.Status}} container {{.Actor.Attributes.name}}' | while read -r event; do
        # Cooldown Logic: Don't notify for the same container more than once every 60s
        CONT_NAME=$(echo "$event" | awk '{print $3}')
        EVENT_TYPE=$(echo "$event" | awk '{print $1}')
        CURRENT_TIME=$(date +%s)
        LAST_NOTIF=$(grep "^${CONT_NAME}:" "$NOTIF_CACHE" | grep -v ":disabled:" | grep -v ":limit:" | cut -d: -f2 | tail -1 || echo "0")

        # Check if we should suppress this notification
        if should_suppress_notification "$CONT_NAME" "$EVENT_TYPE"; then
            continue
        fi

        if [ $((CURRENT_TIME - LAST_NOTIF)) -lt 60 ]; then
            continue
        fi

        # Get container info for enhanced notification
        local container_id=$(docker ps -aqf "name=$CONT_NAME" 2>/dev/null | head -1)
        local restart_count=$(docker inspect "$container_id" --format='{{.RestartCount}}' 2>/dev/null || echo "0")
        local config=$(get_container_restart_config "$container_id")
        local auto_restart=$(echo "$config" | cut -d: -f1)
        local max_restarts=$(echo "$config" | cut -d: -f2)

        # Update cache
        grep -v "^${CONT_NAME}:" "$NOTIF_CACHE" > "${NOTIF_CACHE}.tmp" || true
        echo "${CONT_NAME}:${CURRENT_TIME}" >> "${NOTIF_CACHE}.tmp"
        mv "${NOTIF_CACHE}.tmp" "$NOTIF_CACHE"

        COLOR=3447003
        MESSAGE="🔄 **$event**"

        case "$event" in
            *"start"*)
                COLOR=65280
                ;;
            *"stop"*)
                COLOR=16711680
                ;;
            *"die"*)
                COLOR=16711680
                # Add warning if auto-restart is disabled
                if [ "$auto_restart" = "false" ]; then
                    MESSAGE="🔴 **$event** (Auto-restart: DISABLED - requires manual intervention)"
                    echo "${CONT_NAME}:disabled:notified" >> "$NOTIF_CACHE"
                # Add warning if restart limit reached
                elif [ "$restart_count" -ge "$max_restarts" ]; then
                    MESSAGE="🚨 **$event** (Restart limit reached: $restart_count/$max_restarts - stopped auto-restart)"
                    echo "${CONT_NAME}:limit:notified" >> "$NOTIF_CACHE"
                else
                    MESSAGE="⚠️ **$event** (Restarts: $restart_count/$max_restarts)"
                fi
                ;;
            *"restart"*)
                COLOR=16753920
                if [ "$restart_count" -ge "$max_restarts" ]; then
                    MESSAGE="🚨 **$event** (Restart limit reached: $restart_count/$max_restarts)"
                    echo "${CONT_NAME}:limit:notified" >> "$NOTIF_CACHE"
                else
                    MESSAGE="🔄 **$event** (Restarts: $restart_count/$max_restarts)"
                fi
                ;;
        esac

        send_discord_notification "Docker Event" "$MESSAGE" $COLOR
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

    IS_ALERT=false
    FAIL_REASON=""
    if [ "$CPU_USAGE" -ge "$CPU_THRESHOLD" ]; then IS_ALERT=true; FAIL_REASON="${FAIL_REASON}High CPU ($CPU_USAGE%). "; fi
    if [ "$MEM_USAGE" -ge "$MEM_THRESHOLD" ]; then IS_ALERT=true; FAIL_REASON="${FAIL_REASON}High Memory ($MEM_USAGE%). "; fi
    if [ "$DISK_USAGE" -ge "$DISK_THRESHOLD" ]; then IS_ALERT=true; FAIL_REASON="${FAIL_REASON}High Disk ($DISK_USAGE%). "; fi

    CURRENT_TIME=$(date +%s)
    if [ "$IS_ALERT" = true ]; then
        if [ "$PREV_STATE" = "OK" ]; then
            send_discord_alert "WARNING" "$FAIL_REASON" 16711680 "${ROLE_ID:+<@&$ROLE_ID>}"
            LAST_ALERT_TIME=$CURRENT_TIME
            PREV_STATE="ALERT"
        elif [ "$PREV_STATE" = "ALERT" ]; then
            TIME_DIFF=$((CURRENT_TIME - LAST_ALERT_TIME))
            if [ "$TIME_DIFF" -ge "$COOLDOWN" ]; then
                send_discord_alert "WARNING (Ongoing)" "$FAIL_REASON" 16711680 "${ROLE_ID:+<@&$ROLE_ID>}"
                LAST_ALERT_TIME=$CURRENT_TIME
            fi
        fi
    else
        if [ "$PREV_STATE" = "ALERT" ]; then
            send_discord_alert "RESOLVED" "All systems normal." 65280 ""
            PREV_STATE="OK"
        fi
        PREV_STATE="OK"
    fi

    BACKUP_INTERVAL_SECS=$((BACKUP_INTERVAL_MINS * 60))
    if [ "$BACKUP_INTERVAL_MINS" -gt 0 ] && [ "$LAST_BACKUP_TIME" -gt 0 ]; then
        if [ $((CURRENT_TIME - LAST_BACKUP_TIME)) -ge "$BACKUP_INTERVAL_SECS" ]; then
            bash /usr/local/bin/cms-backup.sh &
            LAST_BACKUP_TIME=$CURRENT_TIME
        fi
    elif [ "$BACKUP_INTERVAL_MINS" -gt 0 ] && [ "$LAST_BACKUP_TIME" -eq 0 ]; then
        LAST_BACKUP_TIME=$CURRENT_TIME
    fi
}

PREV_STATE="OK"
LAST_ALERT_TIME=0
LAST_BACKUP_TIME=0

if [ "$DAEMON_MODE" = true ]; then
    listen_docker_events &
    while true; do
        check_once
        sleep "$CHECK_INTERVAL"
    done
else
    check_once
fi