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

listen_docker_events() {
    echo "Starting Docker event listener..."
    # Track last notification time per container to prevent spam
    NOTIF_CACHE="/tmp/monitor_notif_cache"
    touch "$NOTIF_CACHE"

    docker events --filter 'event=start' --filter 'event=stop' --filter 'event=die' --filter 'event=restart' --format '{{.Status}} container {{.Actor.Attributes.name}}' | while read -r event; do
        # Cooldown Logic: Don't notify for the same container more than once every 60s
        CONT_NAME=$(echo "$event" | awk '{print $3}')
        CURRENT_TIME=$(date +%s)
        LAST_NOTIF=$(grep "^${CONT_NAME}:" "$NOTIF_CACHE" | cut -d: -f2 || echo "0")
        
        if [ $((CURRENT_TIME - LAST_NOTIF)) -lt 60 ]; then
            continue
        fi
        
        # Update cache
        grep -v "^${CONT_NAME}:" "$NOTIF_CACHE" > "${NOTIF_CACHE}.tmp" || true
        echo "${CONT_NAME}:${CURRENT_TIME}" >> "${NOTIF_CACHE}.tmp"
        mv "${NOTIF_CACHE}.tmp" "$NOTIF_CACHE"

        COLOR=3447003
        case "$event" in
            *"start"*) COLOR=65280 ;;
            *"stop"*) COLOR=16711680 ;;
            *"die"*) COLOR=16711680 ;;
            *"restart"*) COLOR=16753920 ;;
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
            bun /usr/local/bin/cms-backup.ts &
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