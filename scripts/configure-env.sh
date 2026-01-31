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
    grep -E "^[[:space:]]*${key}[[:space:]]*=" "$file" | head -n 1 | cut -d '=' -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\