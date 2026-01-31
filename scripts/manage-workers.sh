#!/bin/bash
# Helper script for Admin UI to manage worker configuration
# Usage: ./manage-workers.sh <action> [args]

set -e

ENV_FILE=".env.core"

# Function to add a worker
add_worker() {
    local hostname="$1"
    local port="$2"
    
    if [ -z "$hostname" ] || [ -z "$port" ]; then
        echo "Error: hostname and port required"
        echo "Usage: $0 add <hostname> <port>"
        exit 1
    fi
    
    # Find next available WORKER_N
    local index=0
    while grep -q "^WORKER_$index=" "$ENV_FILE" 2>/dev/null; do
        index=$((index + 1))
    done
    
    # Add the worker
    echo "WORKER_$index=$hostname:$port" >> "$ENV_FILE"
    echo "Added worker $index: $hostname:$port"
}

# Function to remove a worker
remove_worker() {
    local index="$1"
    
    if [ -z "$index" ]; then
        echo "Error: worker index required"
        echo "Usage: $0 remove <index>"
        exit 1
    fi
    
    # Remove the line
    sed -i "/^WORKER_$index=/d" "$ENV_FILE"
    echo "Removed worker $index"
}

# Function to list workers
list_workers() {
    echo "Configured workers:"
    grep "^WORKER_[0-9]*=" "$ENV_FILE" 2>/dev/null || echo "  (none)"
}

# Function to update a worker
update_worker() {
    local index="$1"
    local hostname="$2"
    local port="$3"
    
    if [ -z "$index" ] || [ -z "$hostname" ] || [ -z "$port" ]; then
        echo "Error: index, hostname and port required"
        echo "Usage: $0 update <index> <hostname> <port>"
        exit 1
    fi
    
    # Remove old entry and add new one
    sed -i "/^WORKER_$index=/d" "$ENV_FILE"
    echo "WORKER_$index=$hostname:$port" >> "$ENV_FILE"
    echo "Updated worker $index: $hostname:$port"
}

# Main command dispatch
case "${1:-}" in
    add)
        add_worker "$2" "$3"
        ;;
    remove)
        remove_worker "$2"
        ;;
    list)
        list_workers
        ;;
    update)
        update_worker "$2" "$3" "$4"
        ;;
    *)
        echo "Usage: $0 <add|remove|list|update> [args]"
        echo ""
        echo "Commands:"
        echo "  add <hostname> <port>         - Add a new worker"
        echo "  remove <index>                - Remove a worker by index"
        echo "  update <index> <hostname> <port> - Update an existing worker"
        echo "  list                          - List all configured workers"
        exit 1
        ;;
esac
