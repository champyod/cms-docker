#!/bin/bash
# Batch Contest Creation Script
# Creates multiple contests from a YAML or JSON configuration file

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Create multiple CMS contests from a batch file"
    echo ""
    echo "Options:"
    echo "  -f, --file FILE        Input file (YAML or JSON)"
    echo "  -t, --type TYPE        File type: yaml or json (auto-detected if not specified)"
    echo "  -d, --dry-run          Show what would be created without creating"
    echo "  -h, --help             Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 --file contests.yaml"
    echo "  $0 -f contests.json --dry-run"
    echo ""
    echo "Sample YAML format (contests.yaml):"
    echo "---"
    echo "contests:"
    echo "  - name: Practice Contest 2024"
    echo "    description: A practice contest for beginners"
    echo "    start_time: 2024-03-01T10:00:00"
    echo "    end_time: 2024-03-01T12:00:00"
    echo "    token_mode: disabled"
    echo "    max_submission_number: 50"
    echo "    min_submission_interval: 60"
    echo "    "
    echo "  - name: Advanced Contest 2024"
    echo "    description: Expert level problems"
    echo "    start_time: 2024-03-08T14:00:00"
    echo "    end_time: 2024-03-08T17:00:00"
    echo "    token_mode: finite"
    echo "    token_max_number: 100"
    echo "    token_gen_time: 30"
    exit 1
}

# Parse arguments
FILE=""
TYPE=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -f|--file)
            FILE="$2"
            shift 2
            ;;
        -t|--type)
            TYPE="$2"
            shift 2
            ;;
        -d|--dry-run)
            DRY_RUN=true
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            usage
            ;;
    esac
done

# Validate file
if [ -z "$FILE" ]; then
    echo -e "${RED}Error: Input file required${NC}"
    usage
fi

if [ ! -f "$FILE" ]; then
    echo -e "${RED}Error: File not found: $FILE${NC}"
    exit 1
fi

# Auto-detect file type
if [ -z "$TYPE" ]; then
    case "$FILE" in
        *.yaml|*.yml)
            TYPE="yaml"
            ;;
        *.json)
            TYPE="json"
            ;;
        *)
            echo -e "${RED}Error: Cannot detect file type. Please specify with --type${NC}"
            exit 1
            ;;
    esac
fi

echo -e "${GREEN}Batch Contest Creator${NC}"
echo "File: $FILE"
echo "Type: $TYPE"
echo ""

# Check if running in Docker
if [ -f "/.dockerenv" ]; then
    DOCKER_EXEC=""
else
    DOCKER_EXEC="docker exec -i cms-log-service"
fi

# Function to create a single contest
create_contest() {
    local name="$1"
    local description="$2"
    local start_time="$3"
    local end_time="$4"
    local token_mode="${5:-disabled}"
    local token_max="${6:-100}"
    local token_gen="${7:-30}"
    local max_sub="${8:-50}"
    local min_interval="${9:-60}"
    
    echo -e "${YELLOW}Creating contest: $name${NC}"
    
    if [ "$DRY_RUN" = true ]; then
        echo "  [DRY RUN] Would create:"
        echo "    Name: $name"
        echo "    Description: $description"
        echo "    Start: $start_time"
        echo "    End: $end_time"
        echo "    Token Mode: $token_mode"
        return 0
    fi
    
    # Create Python script to add contest
    local python_script=$(cat <<EOF
import datetime
from cms.db import Contest, SessionGen
from cms.db.filecacher import FileCacher

with SessionGen() as session:
    contest = Contest(
        name="$name",
        description="$description",
        start="${start_time}",
        stop="${end_time}",
        token_mode="$token_mode",
        token_max_number=$token_max,
        token_min_interval=0,
        token_gen_time=$token_gen,
        token_gen_number=0,
        max_submission_number=$max_sub,
        max_user_test_number=$max_sub,
        min_submission_interval=$min_interval,
        min_user_test_interval=$min_interval,
        score_precision=2
    )
    session.add(contest)
    session.commit()
    print(f"✓ Created contest: {contest.name} (ID: {contest.id})")
EOF
    )
    
    # Execute via CMS
    if [ -z "$DOCKER_EXEC" ]; then
        echo "$python_script" | python3
    else
        echo "$python_script" | $DOCKER_EXEC python3
    fi
}

# Process YAML file
if [ "$TYPE" = "yaml" ]; then
    # Check if yq is available
    if ! command -v yq &> /dev/null; then
        echo -e "${RED}Error: 'yq' is required for YAML processing${NC}"
        echo "Install with: sudo wget -qO /usr/local/bin/yq https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64"
        echo "             sudo chmod +x /usr/local/bin/yq"
        exit 1
    fi
    
    # Get number of contests
    CONTEST_COUNT=$(yq '.contests | length' "$FILE")
    echo "Found $CONTEST_COUNT contest(s) to create"
    echo ""
    
    # Process each contest
    for i in $(seq 0 $((CONTEST_COUNT - 1))); do
        NAME=$(yq ".contests[$i].name" "$FILE")
        DESC=$(yq ".contests[$i].description" "$FILE")
        START=$(yq ".contests[$i].start_time" "$FILE")
        END=$(yq ".contests[$i].end_time" "$FILE")
        TOKEN_MODE=$(yq ".contests[$i].token_mode // \"disabled\"" "$FILE")
        TOKEN_MAX=$(yq ".contests[$i].token_max_number // 100" "$FILE")
        TOKEN_GEN=$(yq ".contests[$i].token_gen_time // 30" "$FILE")
        MAX_SUB=$(yq ".contests[$i].max_submission_number // 50" "$FILE")
        MIN_INT=$(yq ".contests[$i].min_submission_interval // 60" "$FILE")
        
        create_contest "$NAME" "$DESC" "$START" "$END" "$TOKEN_MODE" "$TOKEN_MAX" "$TOKEN_GEN" "$MAX_SUB" "$MIN_INT"
    done
    
# Process JSON file
elif [ "$TYPE" = "json" ]; then
    # Check if jq is available
    if ! command -v jq &> /dev/null; then
        echo -e "${RED}Error: 'jq' is required for JSON processing${NC}"
        echo "Install with: sudo apt-get install jq"
        exit 1
    fi
    
    # Get number of contests
    CONTEST_COUNT=$(jq '.contests | length' "$FILE")
    echo "Found $CONTEST_COUNT contest(s) to create"
    echo ""
    
    # Process each contest
    for i in $(seq 0 $((CONTEST_COUNT - 1))); do
        NAME=$(jq -r ".contests[$i].name" "$FILE")
        DESC=$(jq -r ".contests[$i].description" "$FILE")
        START=$(jq -r ".contests[$i].start_time" "$FILE")
        END=$(jq -r ".contests[$i].end_time" "$FILE")
        TOKEN_MODE=$(jq -r ".contests[$i].token_mode // \"disabled\"" "$FILE")
        TOKEN_MAX=$(jq -r ".contests[$i].token_max_number // 100" "$FILE")
        TOKEN_GEN=$(jq -r ".contests[$i].token_gen_time // 30" "$FILE")
        MAX_SUB=$(jq -r ".contests[$i].max_submission_number // 50" "$FILE")
        MIN_INT=$(jq -r ".contests[$i].min_submission_interval // 60" "$FILE")
        
        create_contest "$NAME" "$DESC" "$START" "$END" "$TOKEN_MODE" "$TOKEN_MAX" "$TOKEN_GEN" "$MAX_SUB" "$MIN_INT"
    done
fi

echo ""
if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}Dry run complete. No contests were created.${NC}"
else
    echo -e "${GREEN}✓ All contests created successfully!${NC}"
    echo ""
    echo "Access the contests at:"
    echo "  Admin Panel: http://your-server:8891"
    echo "  Classic Admin: http://your-server:8889"
fi
