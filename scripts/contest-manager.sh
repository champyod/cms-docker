#!/bin/bash

# ===================================
# CMS Contest Management Functions
# ===================================
# Dynamic contest discovery and selection
# Handles contest deletion/recreation gracefully

source_dir=$(dirname "$(readlink -f "$0")")
log_file="/opt/cms/log/contest-manager.log"

# Logging function
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$log_file"
}

# Get all contests from database
get_all_contests() {
    local contests
    contests=$(PGPASSWORD="${CMS_DB_PASSWORD}" psql -h "${CMS_DB_HOST}" -p "${CMS_DB_PORT}" -U "${CMS_DB_USER}" -d "${CMS_DB_NAME}" -t -c "
        SELECT 
            id,
            name,
            start,
            stop,
            CASE 
                WHEN start <= NOW() AND stop >= NOW() THEN 'active'
                WHEN start > NOW() THEN 'upcoming'
                ELSE 'finished'
            END as status
        FROM contests 
        ORDER BY start DESC;
    " 2>/dev/null)
    
    echo "$contests"
}

# Get contest count
get_contest_count() {
    local count
    count=$(PGPASSWORD="${CMS_DB_PASSWORD}" psql -h "${CMS_DB_HOST}" -p "${CMS_DB_PORT}" -U "${CMS_DB_USER}" -d "${CMS_DB_NAME}" -t -c "SELECT COUNT(*) FROM contests;" 2>/dev/null | tr -d ' ')
    echo "${count:-0}"
}

# Get contest by ID
get_contest_by_id() {
    local contest_id="$1"
    local contest
    contest=$(PGPASSWORD="${CMS_DB_PASSWORD}" psql -h "${CMS_DB_HOST}" -p "${CMS_DB_PORT}" -U "${CMS_DB_USER}" -d "${CMS_DB_NAME}" -t -c "
        SELECT 
            id,
            name,
            CASE 
                WHEN start <= NOW() AND stop >= NOW() THEN 'active'
                WHEN start > NOW() THEN 'upcoming'
                ELSE 'finished'
            END as status
        FROM contests 
        WHERE id = $contest_id;
    " 2>/dev/null)
    
    echo "$contest"
}

# Auto-discover best contest based on strategy
auto_discover_contest() {
    local strategy="${CMS_CONTEST_SELECTION_STRATEGY:-active}"
    local all_contests
    local selected_contest_id
    
    log_message "Auto-discovering contest using strategy: $strategy"
    
    all_contests=$(get_all_contests)
    
    if [ -z "$all_contests" ]; then
        log_message "No contests found in database"
        return 1
    fi
    
    case "$strategy" in
        "active")
            # Try to find active contest first, then upcoming, then latest
            selected_contest_id=$(echo "$all_contests" | grep -E '\s+active\s*$' | head -1 | awk '{print $1}' | tr -d ' ')
            if [ -z "$selected_contest_id" ]; then
                selected_contest_id=$(echo "$all_contests" | grep -E '\s+upcoming\s*$' | head -1 | awk '{print $1}' | tr -d ' ')
            fi
            if [ -z "$selected_contest_id" ]; then
                selected_contest_id=$(echo "$all_contests" | head -1 | awk '{print $1}' | tr -d ' ')
            fi
            ;;
        "latest")
            # Get most recently created (first in DESC order)
            selected_contest_id=$(echo "$all_contests" | head -1 | awk '{print $1}' | tr -d ' ')
            ;;
        "earliest")
            # Get oldest contest (last in DESC order)
            selected_contest_id=$(echo "$all_contests" | tail -1 | awk '{print $1}' | tr -d ' ')
            ;;
        *)
            log_message "Unknown strategy: $strategy. Using latest."
            selected_contest_id=$(echo "$all_contests" | head -1 | awk '{print $1}' | tr -d ' ')
            ;;
    esac
    
    if [ -n "$selected_contest_id" ]; then
        log_message "Auto-discovered contest ID: $selected_contest_id"
        echo "$selected_contest_id"
        return 0
    else
        log_message "Failed to auto-discover any contest"
        return 1
    fi
}

# Validate and resolve contest ID
resolve_contest_id() {
    local contest_id_setting="${CMS_CONTEST_ID:-auto}"
    local resolved_id
    
    log_message "Resolving contest ID from setting: $contest_id_setting"
    
    case "$contest_id_setting" in
        "auto")
            resolved_id=$(auto_discover_contest)
            if [ $? -eq 0 ]; then
                log_message "Auto-discovery successful: Contest ID $resolved_id"
                echo "$resolved_id"
                return 0
            else
                log_message "Auto-discovery failed, no contest available"
                return 1
            fi
            ;;
        "latest")
            resolved_id=$(auto_discover_contest)
            echo "$resolved_id"
            return $?
            ;;
        "manual")
            log_message "Manual contest selection mode - no auto-selection"
            return 2  # Special code for manual mode
            ;;
        [0-9]*)
            # Specific contest ID provided
            local contest_info
            contest_info=$(get_contest_by_id "$contest_id_setting")
            if [ -n "$contest_info" ]; then
                log_message "Specific contest ID $contest_id_setting found and valid"
                echo "$contest_id_setting"
                return 0
            else
                log_message "Specific contest ID $contest_id_setting not found. Falling back to auto-discovery."
                resolved_id=$(auto_discover_contest)
                if [ $? -eq 0 ]; then
                    log_message "Fallback successful: Contest ID $resolved_id"
                    echo "$resolved_id"
                    return 0
                else
                    log_message "Fallback failed, no contest available"
                    return 1
                fi
            fi
            ;;
        *)
            log_message "Invalid contest ID setting: $contest_id_setting. Using auto-discovery."
            resolved_id=$(auto_discover_contest)
            echo "$resolved_id"
            return $?
            ;;
    esac
}

# Display contest information
show_contest_info() {
    local contest_count
    contest_count=$(get_contest_count)
    
    log_message "=== Contest Status Report ==="
    log_message "Total contests in database: $contest_count"
    
    if [ "$contest_count" -gt 0 ]; then
        log_message "Available contests:"
        get_all_contests | while IFS='|' read -r id name start stop status; do
            # Clean up whitespace
            id=$(echo "$id" | tr -d ' ')
            name=$(echo "$name" | sed 's/^[ \t]*//;s/[ \t]*$//')
            status=$(echo "$status" | tr -d ' ')
            
            log_message "  ID: $id | Name: $name | Status: $status"
        done
        
        # Show resolved contest
        local resolved_id
        resolved_id=$(resolve_contest_id)
        local resolve_result=$?
        
        if [ $resolve_result -eq 0 ]; then
            log_message "Selected contest ID: $resolved_id"
            export CMS_CONTEST_ID="$resolved_id"
        elif [ $resolve_result -eq 2 ]; then
            log_message "Manual contest selection mode - admin must choose via web interface"
            unset CMS_CONTEST_ID
        else
            log_message "Warning: No contest could be selected automatically"
            unset CMS_CONTEST_ID
        fi
    else
        log_message "No contests found - will create sample contest if auto-creation is enabled"
    fi
    log_message "=========================="
}

# Monitor for contest changes (background function)
monitor_contest_changes() {
    local last_count
    local current_count
    local monitor_interval="${CMS_CONTEST_MONITOR_INTERVAL:-30}"
    
    last_count=$(get_contest_count)
    log_message "Starting contest monitor. Initial count: $last_count, check interval: ${monitor_interval}s"
    
    while true; do
        sleep "$monitor_interval"
        
        current_count=$(get_contest_count)
        
        if [ "$current_count" -ne "$last_count" ]; then
            log_message "Contest count changed from $last_count to $current_count"
            log_message "Re-evaluating contest selection..."
            
            # Re-resolve contest ID
            local new_contest_id
            new_contest_id=$(resolve_contest_id)
            local resolve_result=$?
            
            if [ $resolve_result -eq 0 ]; then
                log_message "New contest selection: ID $new_contest_id"
                export CMS_CONTEST_ID="$new_contest_id"
                
                # Create a signal file that web services can monitor
                echo "$new_contest_id" > /tmp/cms_current_contest_id
                
                log_message "Updated contest ID to $new_contest_id"
                log_message "Note: Web services may need restart to fully reflect contest changes"
            fi
            
            last_count="$current_count"
        fi
    done
}

# Main execution when script is called directly
if [ "${BASH_SOURCE[0]}" == "${0}" ]; then
    case "${1:-info}" in
        "info")
            show_contest_info
            ;;
        "resolve")
            resolve_contest_id
            ;;
        "monitor")
            monitor_contest_changes
            ;;
        "list")
            echo "Available contests:"
            get_all_contests
            ;;
        *)
            echo "Usage: $0 {info|resolve|monitor|list}"
            echo "  info    - Show contest status and selection"
            echo "  resolve - Resolve and return contest ID"
            echo "  monitor - Monitor for contest changes (background)"
            echo "  list    - List all contests"
            exit 1
            ;;
    esac
fi
