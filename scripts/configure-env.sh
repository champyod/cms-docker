#!/bin/bash

###############################################################################
# CMS Docker Environment Configuration Tool
# Author: CCYod
# 
# This script interactively initializes and updates .env files from templates.
###############################################################################

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

print_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[✓]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[!]${NC} $1"; }
print_error() { echo -e "${RED}[✗]${NC} $1"; }
print_step() { echo -e "${CYAN}${BOLD}>>> $1${NC}"; }

generate_random() {
    openssl rand -base64 16 | tr -d "=+/" | cut -c1-16
}

# Helper to extract a value from a .env file reliably
get_env_value() {
    local key=$1
    local file=$2
    [ ! -f "$file" ] && return
    # Matches key=val, key = val, key= val, etc.
    # Returns the value part, trimmed of whitespace and quotes
    grep -E "^[[:space:]]*${key}[[:space:]]*=" "$file" | head -n 1 | cut -d '=' -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

# Helper to check if a value is a placeholder
is_placeholder_val() {
    local val=$1
    [[ "$val" =~ YOUR_.*_HERE || "$val" == "CHANGE_ME" || "$val" == "REPLACE_ME" ]]
}

configure_env_file() {
    local example_file=$1
    local target_file=${example_file%.example}
    
    echo ""
    print_step "Configuring $target_file..."
    
    if [ ! -f "$example_file" ]; then
        print_error "Example file $example_file not found. Skipping."
        return
    fi

    local temp_file=$(mktemp)
    
    # 1. Process template variables
    while IFS= read -r line <&3 || [ -n "$line" ]; do
        # Preserve comments and empty lines
        if [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]]; then
            echo "$line" >> "$temp_file"
            continue
        fi

        # Parse line: KEY=DEFAULT
        if [[ "$line" =~ ^([^=]+)=(.*)$ ]]; then
            local key=$(echo "${BASH_REMATCH[1]}" | xargs)
            local default_val=$(echo "${BASH_REMATCH[2]}" | xargs)
            local current_val=$(get_env_value "$key" "$target_file")
            local exists=false
            
            if [ -f "$target_file" ] && grep -qE "^[[:space:]]*${key}[[:space:]]*=" "$target_file"; then
                exists=true
            fi

            if [ "$exists" = true ]; then
                # Check for placeholders
                if is_placeholder_val "$current_val"; then
                    echo -e "\n${BOLD}${RED}Setup Required:${NC} ${CYAN}${key}${NC}"
                    echo -e "  Current value is a placeholder: ${RED}${current_val}${NC}"
                    echo -e "  [D] Use example:   ${GREEN}${default_val}${NC}"
                    echo -e "  [R] Generate random ID/Password"
                    echo -e "  [M] Specify manually"
                    
                    read -r -p "Choice for $key [M]: " choice
                    case ${choice:-M} in
                        [Dd]*) echo "${key}=${default_val}" >> "$temp_file" ;; 
                        [Rr]*) echo "${key}=$(
generate_random)" >> "$temp_file" ;; 
                        *) 
                            read -r -p "Enter value for $key: " manual_val
                            echo "${key}=${manual_val}" >> "$temp_file"
                            ;; 
                    esac
                elif [ "$current_val" == "$default_val" ]; then
                    # Silent keep if matches template exactly
                    echo "${key}=${current_val}" >> "$temp_file"
                else
                    # Value exists and differs from template: Ask to keep or update
                    echo -e "\n${BOLD}Variable:${NC} ${CYAN}${key}${NC}"
                    echo -e "  [K] Keep current:  ${YELLOW}${current_val}${NC}"
                    echo -e "  [U] Use example:   ${GREEN}${default_val}${NC}"
                    echo -e "  [M] Specify manually"
                    
                    read -r -p "Choice for $key [K]: " choice
                    case ${choice:-K} in
                        [Uu]*) echo "${key}=${default_val}" >> "$temp_file" ;; 
                        [Mm]*) 
                            read -r -p "Enter value for $key: " manual_val
                            echo "${key}=${manual_val}" >> "$temp_file"
                            ;; 
                        *) echo "${key}=${current_val}" >> "$temp_file" ;; 
                    esac
                fi
            else
                # New variable
                echo -e "\n${BOLD}${GREEN}New Variable detected:${NC} ${CYAN}${key}${NC}"
                echo -e "  [D] Use default:   ${GREEN}${default_val}${NC}"
                echo -e "  [R] Generate random ID/Password"
                echo -e "  [M] Specify manually"
                
                read -r -p "Choice for $key [D]: " choice
                case ${choice:-D} in
                    [Rr]*) echo "${key}=$(
generate_random)" >> "$temp_file" ;; 
                    [Mm]*) 
                        read -r -p "Enter value for $key: " manual_val
                        echo "${key}=${manual_val}" >> "$temp_file"
                        ;; 
                    *) echo "${key}=${default_val}" >> "$temp_file" ;; 
                esac
            fi
        else
            echo "$line" >> "$temp_file"
        fi
    done 3< "$example_file"

    # 2. Check for orphan variables
    if [ -f "$target_file" ]; then
        while IFS= read -r target_line <&4 || [ -n "$target_line" ]; do
            [[ -z "$target_line" || "$target_line" =~ ^[[:space:]]*# ]] && continue
            if [[ "$target_line" =~ ^([^=]+)=(.*)$ ]]; then
                local t_key=$(echo "${BASH_REMATCH[1]}" | xargs)
                if ! grep -qE "^[[:space:]]*${t_key}[[:space:]]*=" "$example_file"; then
                    local t_val=$(echo "${BASH_REMATCH[2]}" | xargs)
                    echo -e "\n${YELLOW}${BOLD}Obsolete Variable detected:${NC} ${CYAN}${t_key}${NC} (Not in template)"
                    echo -e "  Current value: ${YELLOW}${t_val}${NC}"
                    echo -e "  [K] Keep it"
                    echo -e "  [R] Remove it"
                    
                    read -r -p "Choice for $t_key [K]: " orphan_choice
                    if [[ "$orphan_choice" =~ ^[Rr] ]]; then
                        print_info "Removing $t_key..."
                    else
                        echo "${t_key}=${t_val}" >> "$temp_file"
                    fi
                fi
            fi
        done 4< "$target_file"
    fi

    mv "$temp_file" "$target_file"
    print_success "Updated $target_file"
}

# Main
clear
echo -e "${CYAN}${BOLD}CMS Environment Configuration Tool${NC}"
echo "========================================="
echo ""

EXAMPLES=(.env.core.example .env.admin.example .env.contest.example .env.worker.example .env.infra.example)
for ex in "${EXAMPLES[@]}"; do
    [ -f "$ex" ] && configure_env_file "$ex"
done

echo ""
print_step "Finalizing..."
make env
print_success "Configuration complete! You can now run ./scripts/setup.sh"
echo ""
