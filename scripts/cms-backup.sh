#!/bin/bash

###############################################################################
# CMS Submission Backup Script (Bash Version)
# Author: CCYod
#
# Exports submissions to CSV and manages retention policies.
###############################################################################

# Configuration from environment
BACKUP_DIR="${BACKUP_DIR:-./backups}"
DATABASE_URL="${DATABASE_URL:-}"
MAX_BACKUPS="${BACKUP_MAX_COUNT:-50}"
MAX_AGE_DAYS="${BACKUP_MAX_AGE_DAYS:-10}"
MAX_SIZE_GB="${BACKUP_MAX_SIZE_GB:-5}"
WEBHOOK_URL="${DISCORD_WEBHOOK_URL:-}"
ROLE_ID="${DISCORD_ROLE_ID:-}"
HOSTNAME=$(hostname)

# Helpers
send_discord_log() {
    local message="$1"
    local color="$2"
    local mention="$3"
    [ -z "$WEBHOOK_URL" ] && return

    local timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    local payload
    
    if [ "$mention" = "true" ] && [ -n "$ROLE_ID" ]; then
        payload="{\"content\": \"<@&$ROLE_ID>\", \"embeds\": [{\"title\": \"CMS Backup System\", \"description\": \"$message\", \"color\": $color, \"timestamp\": \"$timestamp\"}]}"
    else
        payload="{\"embeds\": [{\"title\": \"CMS Backup System\", \"description\": \"$message\", \"color\": $color, \"timestamp\": \"$timestamp\"}]}"
    fi

    curl -s -H "Content-Type: application/json" -X POST -d "$payload" "$WEBHOOK_URL" > /dev/null
}

run_cleanup() {
    echo "Starting cleanup..."
    cd "$BACKUP_DIR" || return
    
    local deleted_count=0
    local deleted_size=0

    # 1. Cleanup by Count
    if [ "$MAX_BACKUPS" -gt 0 ]; then
        local count=$(ls -1 submissions-backup-*.csv 2>/dev/null | wc -l)
        if [ "$count" -gt "$MAX_BACKUPS" ]; then
            local to_delete=$((count - MAX_BACKUPS))
            for f in $(ls -1tr submissions-backup-*.csv | head -n "$to_delete"); do
                local size=$(stat -c%s "$f")
                rm "$f"
                deleted_count=$((deleted_count + 1))
                deleted_size=$((deleted_size + size))
            done
        fi
    fi

    # 2. Cleanup by Age
    if [ "$MAX_AGE_DAYS" -gt 0 ]; then
        # Find files older than X days, but always keep at least 1 file
        local old_files=$(find . -name "submissions-backup-*.csv" -mtime +"$MAX_AGE_DAYS")
        for f in $old_files;
 do
            local count=$(ls -1 submissions-backup-*.csv 2>/dev/null | wc -l)
            [ "$count" -le 1 ] && break
            local size=$(stat -c%s "$f")
            rm "$f"
            deleted_count=$((deleted_count + 1))
            deleted_size=$((deleted_size + size))
        done
    fi

    # 3. Cleanup by Total Size
    if [ "$MAX_SIZE_GB" -gt 0 ]; then
        local max_bytes=$((MAX_SIZE_GB * 1024 * 1024 * 1024))
        local total_bytes=$(du -cb submissions-backup-*.csv 2>/dev/null | tail -1 | awk '{print $1}')
        
        while [ "$total_bytes" -gt "$max_bytes" ]; do
            local count=$(ls -1 submissions-backup-*.csv 2>/dev/null | wc -l)
            [ "$count" -le 1 ] && break
            
            local oldest=$(ls -1tr submissions-backup-*.csv | head -n 1)
            local size=$(stat -c%s "$oldest")
            rm "$oldest"
            deleted_count=$((deleted_count + 1))
            deleted_size=$((deleted_size + size))
            total_bytes=$((total_bytes - size))
        done
    fi

    if [ "$deleted_count" -gt 0 ]; then
        local size_mb=$(echo "scale=2; $deleted_size / 1048576" | bc)
        send_discord_log "🧹 **Cleanup Performed**\nDeleted $deleted_count old backups.\nSpace freed: $size_mb MB" 15844367 false
        echo "Cleanup done: deleted $deleted_count files ($size_mb MB)"
    fi
}

run_backup() {
    mkdir -p "$BACKUP_DIR"
    local timestamp=$(date +%Y-%m-%dT%H-%M-%S)
    local filename="submissions-backup-$timestamp.csv"
    local filepath="$BACKUP_DIR/$filename"

    echo "Starting backup to $filepath..."

    if [ -z "$DATABASE_URL" ]; then
        echo "Error: DATABASE_URL is not set."
        send_discord_log "❌ **Backup Failed**\nError: DATABASE_URL not configured." 16711680 true
        return 1
    fi

    local query="COPY (SELECT * FROM submissions) TO STDOUT WITH CSV HEADER"
    
    if psql "$DATABASE_URL" -c "$query" > "$filepath" 2>/tmp/backup_error.log; then
        local size_bytes=$(stat -c%s "$filepath")
        local size_mb=$(echo "scale=2; $size_bytes / 1048576" | bc)
        
        echo "Backup successful: $filename ($size_mb MB)"
        send_discord_log "✅ **Backup Successful**\nFilename: \`$filename\`\nSize: $size_mb MB" 65280 false
        run_cleanup
    else
        local err=$(cat /tmp/backup_error.log)
        echo "Backup failed: $err"
        send_discord_log "❌ **Backup Failed**\nError: $err" 16711680 true
        rm -f "$filepath"
        return 1
    fi
}

# Entry point
if [ "$1" = "--cleanup-only" ]; then
    run_cleanup
else
    run_backup
fi
