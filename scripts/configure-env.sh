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

configure_env_file() {
    local example_file=$1
    local target_file=${example_file%.example}
    
    echo ""
    print_step "Configuring $target_file..."
    
    if [ ! -f "$example_file" ]; then
        print_error "Example file $example_file not found. Skipping."
        return
    fi

    # Create temporary file for new config
    local temp_file=$(mktemp)
    
    # Process each line from the example file
    # Using FD 3 to read the file so we can still use stdin for user input
    while IFS= read -r line <&3 || [ -n "$line" ]; do
        # Skip empty lines and comments
        if [[ -z "$line" || "$line" =~ ^# ]]; then
            echo "$line" >> "$temp_file"
            continue
        fi

        # Parse KEY and DEFAULT_VALUE
        if [[ "$line" =~ ^([^=]+)=(.*)$ ]]; then
            local key="${BASH_REMATCH[1]}"
            local default_val="${BASH_REMATCH[2]}"
            local current_val=""
            local exists=false

            # Check if key already exists in target file
            if [ -f "$target_file" ]; then
                if grep -q "^${key}=" "$target_file"; then
                    current_val=$(grep "^${key}=" "$target_file" | cut -d '=' -f2-)
                    exists=true
                fi
            fi

            if [ "$exists" = true ]; then
                # Variable exists: Ask to keep or update
                if [ "$current_val" == "$default_val" ]; then
                    # No change in template
                    echo "${key}=${current_val}" >> "$temp_file"
                else
                    echo -e "\n${BOLD}Variable:${NC} ${CYAN}${key}${NC}"
                    echo -e "  [K] Keep current:  ${YELLOW}${current_val}${NC}"
                    echo -e "  [U] Use example:   ${GREEN}${default_val}${NC}"
                    echo -e "  [M] Specify manually"
                    
                    read -p "Choice for $key [K]: " choice
                    case ${choice:-K} in
                        [Uu]*) echo "${key}=${default_val}" >> "$temp_file" ;;
                        [Mm]*) 
                            read -p "Enter value for $key: " manual_val
                            echo "${key}=${manual_val}" >> "$temp_file"
                            ;; 
                        *) echo "${key}=${current_val}" >> "$temp_file" ;;
                    esac
                fi
            else
                # New variable: Ask for value
                echo -e "\n${BOLD}New Variable detected:${NC} ${CYAN}${key}${NC}"
                echo -e "  [D] Use default:   ${GREEN}${default_val}${NC}"
                echo -e "  [R] Generate random ID/Password"
                echo -e "  [M] Specify manually"
                
                read -p "Choice for $key [D]: " choice
                case ${choice:-D} in
                    [Rr]*) 
                        local rand_val=$(generate_random)
                        print_info "Generated: $rand_val"
                        echo "${key}=${rand_val}" >> "$temp_file" 
                        ;; 
                    [Mm]*) 
                        read -p "Enter value for $key: " manual_val
                        echo "${key}=${manual_val}" >> "$temp_file"
                        ;; 
                    *) echo "${key}=${default_val}" >> "$temp_file" ;;
                esac
            fi
        else
            # Line is not key=value, preserve it
            echo "$line" >> "$temp_file"
        fi
    done 3< "$example_file"

    mv "$temp_file" "$target_file"
    print_success "Updated $target_file"
}

# Main
clear
echo -e "${CYAN}${BOLD}CMS Environment Configuration Tool${NC}"
echo "========================================="
echo "This script will help you set up your .env files."
echo "For each variable, you can keep the default, provide a value,"
echo "or generate a random password."
echo ""

# Find all example files
EXAMPLES=(.env.core.example .env.admin.example .env.contest.example .env.worker.example .env.infra.example)

for ex in "${EXAMPLES[@]}"; do
    if [ -f "$ex" ]; then
        configure_env_file "$ex"
    fi
done

echo ""
print_step "Finalizing..."
make env
print_success "Configuration complete! You can now run ./setup.sh"
echo ""
