#!/bin/bash
# __monitor.sh — CMS host monitor (Discord alerts, Docker events, backups)
# Prometheus integration: when MONITORING_ENABLED=1 + profile monitoring, Prometheus
# scrapes the same ping targets as monitor_targets.json (see config/prometheus/prometheus.yml)
# via jobs: prometheus (self), node-exporter, nginx (stub_status /metrics), cms-monitor placeholder.
# Prometheus scrape_interval 15s mirrors MONITOR_INTERVAL; Grafana dashboards in config/grafana/dashboards/.

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
# Digest window: docker events arriving within this many seconds share one embed.
EVENT_BATCH_WINDOW=${MONITOR_EVENT_WINDOW:-15}
# Discord allows 25 fields per embed; a fuller window flushes and continues.
EVENT_BATCH_MAX=25
CPU_THRESHOLD=${MONITOR_CPU_THRESHOLD:-80}
MEM_THRESHOLD=${MONITOR_MEM_THRESHOLD:-80}
DISK_THRESHOLD=${MONITOR_DISK_THRESHOLD:-80}

# Backup Settings
BACKUP_INTERVAL_MINS=${BACKUP_INTERVAL_MINS:-1440}
LAST_BACKUP_TIME=0

# Log retention. The CMS services open a fresh <epoch>.log under CMS_LOG_DIR at
# every start and never rotate it (src/cms/io/service.py, service/LogService.py),
# so the volume grows without bound. Caps mirror the backup retention knobs.
CMS_LOG_DIR=${CMS_LOG_DIR:-/var/local/log/cms}
CMS_LOG_MAX_AGE_DAYS=${CMS_LOG_MAX_AGE_DAYS:-7}
CMS_LOG_MAX_SIZE_GB=${CMS_LOG_MAX_SIZE_GB:-5}
CMS_LOG_PRUNE_INTERVAL_MINS=${CMS_LOG_PRUNE_INTERVAL_MINS:-60}
LAST_LOG_PRUNE_TIME=0

# Mode
DAEMON_MODE=false

usage() {
    echo "Usage: $0 [-d] [-i interval]"
    echo "  -d          Daemon mode"
    echo "  -i seconds  Check interval"
    exit 1
}

while getopts "di:h" opt; do
    case $opt in
        d) DAEMON_MODE=true ;;
        i) CHECK_INTERVAL=$OPTARG ;;
        h) usage ;;
        *) usage ;;
    esac
done

get_cpu_usage() {
    read -r _ user nice system idle iowait irq softirq steal guest guest_nice < /proc/stat
    prev_idle=$((idle + iowait))
    prev_non_idle=$((user + nice + system + irq + softirq + steal))
    prev_total=$((prev_idle + prev_non_idle))

    sleep 0.5

    read -r _ user nice system idle iowait irq softirq steal guest guest_nice < /proc/stat
    idle_now=$((idle + iowait))
    non_idle_now=$((user + nice + system + irq + softirq + steal))
    total_now=$((idle_now + non_idle_now))

    total_delta=$((total_now - prev_total))
    idle_delta=$((idle_now - prev_idle))
    if [ "$total_delta" -le 0 ]; then
        echo "0"
        return
    fi

    cpu_usage=$((100 * (total_delta - idle_delta) / total_delta))
    echo "$cpu_usage"
}

get_mem_usage() {
    local mem_line
    mem_line=$(free -m 2>/dev/null | awk '/^Mem:/ {print $2" "$3" "$7; exit}')
    if [ -z "$mem_line" ]; then
        echo "0"
        return
    fi

    set -- $mem_line
    local total=${1:-0}
    local used=${2:-0}
    local available=${3:-0}

    if ! [[ "$total" =~ ^[0-9]+$ ]] || [ "$total" -le 0 ]; then
        echo "0"
        return
    fi

    if [[ "$available" =~ ^[0-9]+$ ]]; then
        echo $(( 100 * (total - available) / total ))
    else
        echo $(( 100 * used / total ))
    fi
}

get_disk_usage() {
    local target="${DISK_PATH:-/}"
    local usage
    usage=$(df -P "$target" 2>/dev/null | awk 'NR==2 {gsub(/%/, "", $5); print $5; exit}')
    if [[ "$usage" =~ ^[0-9]+$ ]]; then
        echo "$usage"
    else
        echo "0"
    fi
}

is_integer() {
    [[ "$1" =~ ^[0-9]+$ ]]
}

# WHY: an unset webhook is the silent-non-delivery failure mode — the operator believes
# alerting is on while every message is dropped. Report it on stderr (docker logs) so it
# reaches the surface the operator actually reads, and never abort the daemon loop.
warn_webhook_unconfigured() {
    echo "[WARN] DISCORD_WEBHOOK_URL is unset — dropped $1." >&2
    echo "[WARN] Set it in config.toml [infra] then run './cms config sync', or from the admin panel (Maintenance → Discord Notifications), and recreate the monitor container." >&2
}

# Post a prepared payload and report a non-2xx response instead of discarding it.
post_discord_payload() {
    local payload_file="$1"
    local context="$2"
    local http_code
    # curl reports an unreachable endpoint as 000, which the case below also catches.
    http_code=$(curl -s -o /dev/null -w '%{http_code}' -H "Content-Type: application/json" -X POST -d "@${payload_file}" "$WEBHOOK_URL" || true)
    case "$http_code" in
        2??) ;;
        *) echo "[WARN] Discord webhook delivery failed (HTTP ${http_code:-000}) — dropped $context." >&2 ;;
    esac
}

send_discord_alert() {
    local status="$1"
    local message="$2"
    local color="$3"
    local mention="$4"
    local timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)

    if [ -z "$WEBHOOK_URL" ]; then
        warn_webhook_unconfigured "alert ($status)"
        return 0
    fi

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

    post_discord_payload /tmp/discord_payload.json "alert ($status)"
}

send_discord_notification() {
    local title="$1"
    local message="$2"
    local color="$3"
    local timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)

    if [ -z "$WEBHOOK_URL" ]; then
        warn_webhook_unconfigured "notification ($title)"
        return 0
    fi

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

    post_discord_payload /tmp/discord_notif.json "notification ($title)"
}

# WHY: when the config file cannot be located the defaults below silently disarm every
# per-container policy (autoRestart / maxRestarts / discordNotifications), so say it once
# per process instead of quietly behaving as if nothing were configured.
RESTART_CONFIG_NOTICE_SHOWN=false
warn_restart_config_missing() {
    if [ "$RESTART_CONFIG_NOTICE_SHOWN" = "true" ]; then
        return 0
    fi
    RESTART_CONFIG_NOTICE_SHOWN=true
    echo "[WARN] container restart config not found at $1 — per-container autoRestart/maxRestarts/discordNotifications are ignored." >&2
    echo "[WARN] When the monitor runs in a container set REPO_ROOT=/repo-root; config/ is mounted at /repo-root/config." >&2
}

get_container_restart_config() {
    local container_id="$1"
    local config_file="${REPO_ROOT:-$(dirname "$0")/..}/config/container-restart.json"

    if [ ! -f "$config_file" ]; then
        warn_restart_config_missing "$config_file"
        echo "false:5:0:true"
        return
    fi

    # Try to parse JSON using basic tools (jq if available, otherwise skip)
    if command -v jq &> /dev/null; then
        local auto_restart=$(jq -r ".[\"$container_id\"].autoRestart // false" "$config_file" 2>/dev/null || echo "false")
        local max_restarts=$(jq -r ".[\"$container_id\"].maxRestarts // 5" "$config_file" 2>/dev/null || echo "5")
        local current_restarts=$(jq -r ".[\"$container_id\"].currentRestarts // 0" "$config_file" 2>/dev/null || echo "0")
        # WHY: jq's // treats boolean false as "empty" too, so `.discordNotifications // true`
        # always reported true and silently ignored a stored opt-out; has() keeps false intact.
        local discord_notifications=$(jq -r "if (.[\"$container_id\"] | has(\"discordNotifications\")) then .[\"$container_id\"].discordNotifications else true end" "$config_file" 2>/dev/null || echo "true")
        echo "$auto_restart:$max_restarts:$current_restarts:$discord_notifications"
    else
        echo "false:5:0:true"
    fi
}

should_suppress_notification() {
    local container_name="$1"
    local event_type="$2"

    local container_id=$(docker ps -aqf "name=$container_name" 2>/dev/null | head -1)
    if [ -z "$container_id" ]; then
        return 1  # Don't suppress if we can't find container
    fi

    local config=$(get_container_restart_config "$container_id")
    local auto_restart=$(echo "$config" | cut -d: -f1)
    local max_restarts=$(echo "$config" | cut -d: -f2)
    local discord_notifications=$(echo "$config" | cut -d: -f4)

    # If Discord notifications are disabled for this container, suppress all notifications
    if [ "$discord_notifications" = "false" ]; then
        return 0  # Suppress
    fi

    local restart_count=$(docker inspect "$container_id" --format='{{.RestartCount}}' 2>/dev/null || echo "0")

    # If auto-restart is disabled and container is dying/restarting, suppress after first notification
    # WHY braces: && and || bind equally and associate left to right, so the un-braced form
    # reads as (A && B) || C — that made every restart event satisfy the guard on its own
    # and suppress alerts the intent never covered (under-alerting).
    if [ "$auto_restart" = "false" ] && { [ "$event_type" = "die" ] || [ "$event_type" = "restart" ]; }; then
        # Check if we already notified about this container being disabled
        if grep -q "^${container_name}:disabled:notified" "$NOTIF_CACHE" 2>/dev/null; then
            return 0  # Suppress
        fi
    fi

    # If restart count exceeds max, suppress repeated die/restart notifications
    # WHY braces: same precedence trap as above — restart events must only be suppressed
    # when the restart limit is genuinely reached, not unconditionally.
    if [ "$restart_count" -ge "$max_restarts" ] && { [ "$event_type" = "die" ] || [ "$event_type" = "restart" ]; }; then
        # Check if we already notified about limit reached
        if grep -q "^${container_name}:limit:notified" "$NOTIF_CACHE" 2>/dev/null; then
            return 0  # Suppress
        fi
    fi

    return 1  # Don't suppress
}

# ---------------------------------------------------------------------------
# Log retention
# ---------------------------------------------------------------------------
# WHY the prune runs inside the log-service container: that tree belongs to
# cmsuser (uid 1001) with mode 750, while the monitor runs as uid 1000 and so
# cannot unlink those files; the remedy documented in docs/TROUBLESHOOTING.md
# writes into the same container for the same reason. Files past the age cap go
# first, then oldest-first until the tree is back under the size cap.
prune_cms_logs() {
    local log_dir="$CMS_LOG_DIR"
    local age_days="$CMS_LOG_MAX_AGE_DAYS"
    local max_kb=$(( CMS_LOG_MAX_SIZE_GB * 1024 * 1024 ))
    local container="cms-log-service"

    if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$container"; then
        echo "[WARN] log retention skipped: $container is not running." >&2
        return 0
    fi

    docker exec "$container" sh -c '
        dir="$1"; age_days="$2"; max_kb="$3"
        [ -d "$dir" ] || exit 0
        # Age first: a file no service writes to any more is the cheapest to drop.
        find "$dir" -type f -name "*.log" -mtime +"$age_days" -delete 2>/dev/null
        used_kb=$(du -sk "$dir" | cut -f1)
        [ "$used_kb" -le "$max_kb" ] && exit 0
        excess=$(( (used_kb - max_kb) * 1024 ))
        listing=$(find "$dir" -type f -name "*.log" -exec stat -c "%Y %s %n" {} + 2>/dev/null | sort -n)
        # The newest file is the one a service is still appending to. Unlinking it
        # would keep its blocks until that service restarts, so when it is the only
        # one left to pay the excess it is truncated in place instead (logrotate
        # copytruncate): the space comes back now and the writer is undisturbed.
        newest=$(printf "%s\n" "$listing" | tail -n 1 | cut -d" " -f3-)
        printf "%s\n" "$listing" | while IFS=" " read -r _mtime size path; do
            [ "$excess" -gt 0 ] || break
            [ -n "$path" ] || continue
            if [ "$path" = "$newest" ]; then
                truncate -s 0 -- "$path" 2>/dev/null || : > "$path"
            elif ! rm -f -- "$path"; then
                continue
            fi
            excess=$(( excess - size ))
        done
    ' sh "$log_dir" "$age_days" "$max_kb" || echo "[WARN] log retention pass failed." >&2
}

# Appends one docker event as a digest line: rank|color|name|value.
# Rank picks the embed color (down outranks restarting outranks up).
collect_docker_event() {
    local event="$1" batch_file="$2"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Docker Event: $event"

    local cont_name event_type
    cont_name=$(echo "$event" | awk '{print $3}')
    event_type=$(echo "$event" | awk '{print $1}')

    if should_suppress_notification "$cont_name" "$event_type"; then
        return 0
    fi

    local container_id restart_count config auto_restart max_restarts
    container_id=$(docker ps -aqf "name=$cont_name" 2>/dev/null | head -1)
    restart_count=$(docker inspect "$container_id" --format='{{.RestartCount}}' 2>/dev/null || echo "0")
    config=$(get_container_restart_config "$container_id")
    auto_restart=$(echo "$config" | cut -d: -f1)
    max_restarts=$(echo "$config" | cut -d: -f2)

    local stamp emoji status rank color detail
    stamp=$(date '+[%d %m %Y - %H:%M:%S]')
    rank=0; color=65280; emoji="🟢"; status="up"; detail="$event"
    case "$event" in
        *"die"*|*"stop"*)
            rank=2; color=16711680; emoji="🔴"; status="down"
            if [ "$auto_restart" = "false" ]; then
                detail="$event (Auto-restart DISABLED)"
                echo "${cont_name}:disabled:notified" >> "$NOTIF_CACHE"
            elif [ "$restart_count" -ge "$max_restarts" ]; then
                detail="$event (Restart limit $restart_count/$max_restarts)"
                echo "${cont_name}:limit:notified" >> "$NOTIF_CACHE"
            else
                detail="$event (Restarts $restart_count/$max_restarts)"
            fi
            ;;
        *"restart"*)
            rank=1; color=16753920; emoji="🟠"; status="restarting"
            if [ "$restart_count" -ge "$max_restarts" ]; then
                detail="$event (Restart limit $restart_count/$max_restarts)"
                echo "${cont_name}:limit:notified" >> "$NOTIF_CACHE"
            else
                detail="$event (Restarts $restart_count/$max_restarts)"
            fi
            ;;
    esac
    printf '%s|%s|%s %s|%s %s [%s]\n' "$rank" "$color" "$emoji" "$cont_name" "$stamp" "$detail" "$status" >> "$batch_file"
}

# Sends one embed for the collected batch; worst rank sets the embed color.
flush_event_batch() {
    local batch_file="$1"
    [ -s "$batch_file" ] || return 0
    local event_count
    event_count=$(wc -l < "$batch_file")

    local worst_rank worst_color rank color
    worst_rank=-1; worst_color=3447003
    while IFS='|' read -r rank color _ _; do
        if [ "${rank:-0}" -gt "$worst_rank" ]; then
            worst_rank=$rank; worst_color=$color
        fi
    done < "$batch_file"

    if [ -z "$WEBHOOK_URL" ]; then
        warn_webhook_unconfigured "docker event digest ($event_count events)"
        return 0
    fi

    if command -v jq >/dev/null 2>&1; then
        jq -n --rawfile lines "$batch_file" --argjson color "$worst_color" '
            ($lines | split("\n") | map(select(length > 0)) | .[0:25]
             | map(split("|") | {name: .[2], value: .[3], inline: false})) as $fields
            | {embeds: [{title: "Docker Events", color: $color, fields: $fields}]}' \
            > /tmp/discord_digest.json
        post_discord_payload /tmp/discord_digest.json "docker event digest"
    else
        local joined
        joined=$(cut -d'|' -f3- "$batch_file" | paste -sd' / ' -)
        send_discord_notification "Docker Events ($event_count)" "$joined" "$worst_color"
    fi
}

listen_docker_events() {
    echo "Starting Docker event listener..."
    # One-shot markers for terminal states; every other event is digested.
    NOTIF_CACHE="/tmp/monitor_notif_cache"
    touch "$NOTIF_CACHE"

    docker events --filter 'event=start' --filter 'event=stop' --filter 'event=die' --filter 'event=restart' --format '{{.Status}} container {{.Actor.Attributes.name}}' | {
    while true; do
        batch_file=$(mktemp)
        # First event blocks; the window runs from its arrival.
        if ! IFS= read -r first_event; then
            rm -f "$batch_file"
            break
        fi
        collect_docker_event "$first_event" "$batch_file"
        end_time=$(( $(date +%s) + EVENT_BATCH_WINDOW ))
        event_count=1
        while [ "$event_count" -lt "$EVENT_BATCH_MAX" ]; do
            remaining=$(( end_time - $(date +%s) ))
            [ "$remaining" -le 0 ] && break
            IFS= read -r -t "$remaining" event || break
            collect_docker_event "$event" "$batch_file"
            event_count=$(( event_count + 1 ))
        done
        flush_event_batch "$batch_file"
        rm -f "$batch_file"
    done
    }
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
    if is_integer "$CPU_USAGE" && [ "$CPU_USAGE" -ge "$CPU_THRESHOLD" ]; then IS_ALERT=true; FAIL_REASON="${FAIL_REASON}High CPU ($CPU_USAGE%). "; fi
    if is_integer "$MEM_USAGE" && [ "$MEM_USAGE" -ge "$MEM_THRESHOLD" ]; then IS_ALERT=true; FAIL_REASON="${FAIL_REASON}High Memory ($MEM_USAGE%). "; fi
    if is_integer "$DISK_USAGE" && [ "$DISK_USAGE" -ge "$DISK_THRESHOLD" ]; then IS_ALERT=true; FAIL_REASON="${FAIL_REASON}High Disk ($DISK_USAGE%). "; fi

    CURRENT_TIME=$(date +%s)
    if [ "$IS_ALERT" = true ]; then
        if [ "$PREV_STATE" = "OK" ]; then
            send_discord_alert "WARNING" "$FAIL_REASON" 16711680 "${ROLE_ID:+<@&$ROLE_ID>}"
            PREV_STATE="ALERT"
        elif [ "$PREV_STATE" = "ALERT" ]; then
            send_discord_alert "WARNING (Ongoing)" "$FAIL_REASON" 16711680 "${ROLE_ID:+<@&$ROLE_ID>}"
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

    # First pass prunes straight away, so a volume that is already over the cap
    # is brought back under it without waiting for the interval to elapse.
    if is_integer "$CMS_LOG_PRUNE_INTERVAL_MINS" && [ "$CMS_LOG_PRUNE_INTERVAL_MINS" -gt 0 ] \
       && [ $((CURRENT_TIME - LAST_LOG_PRUNE_TIME)) -ge $((CMS_LOG_PRUNE_INTERVAL_MINS * 60)) ]; then
        prune_cms_logs
        LAST_LOG_PRUNE_TIME=$CURRENT_TIME
    fi
}

PREV_STATE="OK"
LAST_BACKUP_TIME=0

# WHY: the backup script sources __lib/common.sh, so a container that never received
# the lib aborts every backup cycle at that source. Warn loudly but keep looping —
# alerting, disk checks and log pruning are all still useful without backups.
CMS_BACKUP_SCRIPT="/usr/local/bin/cms-backup.sh"
CMS_BACKUP_LIB="${CMS_BACKUP_SCRIPT%/*}/__lib/common.sh"
if ! grep -q '__lib/' "$CMS_BACKUP_SCRIPT" 2>/dev/null || [ ! -r "$CMS_BACKUP_LIB" ]; then
    echo "[WARN] ===========================================================" >&2
    if ! grep -q '__lib/' "$CMS_BACKUP_SCRIPT" 2>/dev/null; then
        echo "[WARN] $CMS_BACKUP_SCRIPT is missing or unreadable, so no backup" >&2
        echo "[WARN] will run in this container." >&2
    else
        echo "[WARN] $CMS_BACKUP_LIB is missing or unreadable, so every backup" >&2
        echo "[WARN] cycle will abort at its source line." >&2
    fi
    echo "[WARN] Mount or copy scripts/__lib next to the backup script, then" >&2
    echo "[WARN] recreate the monitor container so it picks the lib up." >&2
    echo "[WARN] Monitoring continues without backups." >&2
    echo "[WARN] ===========================================================" >&2
fi

# WHY: say up front whether this run can deliver anything — starting a monitor with no
# webhook otherwise looks healthy while every alert is dropped.
if [ -z "$WEBHOOK_URL" ]; then
    echo "[WARN] ===========================================================" >&2
    echo "[WARN] DISCORD_WEBHOOK_URL is unset — incidents will be detected" >&2
    echo "[WARN] but NO alert will be delivered for this run." >&2
    echo "[WARN] Set it in config.toml [infra] and run './cms config sync'," >&2
    echo "[WARN] or use the admin panel Maintenance page, then recreate the" >&2
    echo "[WARN] monitor container so it picks the value up." >&2
    echo "[WARN] ===========================================================" >&2
fi

if [ "$DAEMON_MODE" = true ]; then
    listen_docker_events &
    while true; do
        check_once
        sleep "$CHECK_INTERVAL"
    done
else
    check_once
fi