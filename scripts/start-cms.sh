#!/bin/bash
set -e

# Debug: Print environment variables
echo "=== Environment Variables ==="
echo "CMS_DB_HOST: ${CMS_DB_HOST}"
echo "CMS_DB_PORT: ${CMS_DB_PORT}"
echo "CMS_DB_USER: ${CMS_DB_USER}"
echo "CMS_DB_NAME: ${CMS_DB_NAME}"
echo "CMS_DB_PASSWORD: [REDACTED]"
echo "CMS_AUTO_CREATE_CONTEST: ${CMS_AUTO_CREATE_CONTEST:-false}"
echo "CMS_CONTEST_ID: ${CMS_CONTEST_ID:-null}"
echo "CMS_CONTEST_NAME: ${CMS_CONTEST_NAME:-Default}"
echo "=============================="

# Wait for database to be ready
echo "Waiting for database..."
until pg_isready -h $CMS_DB_HOST -p $CMS_DB_PORT -U $CMS_DB_USER; do
    echo "Database not ready, waiting..."
    sleep 2
done
echo "Database is ready!"

# Generate CMS configuration
echo "Generating CMS configuration..."
cat > /opt/cms/config/cms.toml <<EOF
[global]
backdoor = false
file_log_debug = true
stream_log_detailed = false

temp_dir = "/tmp"
log_dir = "${CMS_LOG_DIR}"
cache_dir = "${CMS_CACHE_DIR}"
data_dir = "${CMS_DATA_DIR}"
run_dir = "${CMS_RUN_DIR}"

[database]
url = "postgresql+psycopg2://${CMS_DB_USER}:${CMS_DB_PASSWORD}@${CMS_DB_HOST}:${CMS_DB_PORT}/${CMS_DB_NAME}"
debug = false
twophase_commit = false

[services]
LogService = [["0.0.0.0", 29000]]
ResourceService = [["0.0.0.0", 28000]]
ScoringService = [["0.0.0.0", 28500]]
Checker = [["0.0.0.0", 22000]]
EvaluationService = [["0.0.0.0", 25000]]
ContestWebServer = [["0.0.0.0", 21000]]
AdminWebServer = [["0.0.0.0", 21100]]
ProxyService = [["0.0.0.0", 28600]]
PrintingService = [["0.0.0.0", 25123]]
PrometheusExporter = []
TelegramBot = []
EOF

# Add worker services based on CMS_NUM_WORKERS (main VPS workers only)
echo "Worker = [" >> /opt/cms/config/cms.toml
for i in $(seq 0 $((CMS_NUM_WORKERS-1))); do
    port=$((26000 + i))
    echo "    [\"0.0.0.0\", $port]," >> /opt/cms/config/cms.toml
done
echo "]" >> /opt/cms/config/cms.toml

cat >> /opt/cms/config/cms.toml <<EOF

[worker]
keep_sandbox = ${CMS_KEEP_SANDBOX:-false}

[sandbox]
sandbox_implementation = "isolate"
max_file_size = ${CMS_SANDBOX_MAX_FILE_SIZE:-1048576}
compilation_sandbox_max_processes = ${CMS_COMPILATION_MAX_PROCESSES:-1000}
compilation_sandbox_max_time_s = ${CMS_COMPILATION_MAX_TIME:-10.0}
compilation_sandbox_max_memory_kib = ${CMS_COMPILATION_MAX_MEMORY:-524288}
trusted_sandbox_max_processes = ${CMS_TRUSTED_MAX_PROCESSES:-1000}
trusted_sandbox_max_time_s = ${CMS_TRUSTED_MAX_TIME:-10.0}
trusted_sandbox_max_memory_kib = ${CMS_TRUSTED_MAX_MEMORY:-4194304}

[web_server]
secret_key = "${CMS_SECRET_KEY}"
tornado_debug = ${CMS_TORNADO_DEBUG}

[contest_web_server]
listen_address = ["${CMS_CONTEST_LISTEN_ADDRESS}"]
listen_port = [${CMS_CONTEST_LISTEN_PORT}]
cookie_duration = ${CMS_CONTEST_COOKIE_DURATION}
num_proxies_used = ${CMS_NUM_PROXIES:-1}
submit_local_copy = ${CMS_SUBMIT_LOCAL_COPY:-true}
submit_local_copy_path = "${CMS_DATA_DIR}/submissions/"
tests_local_copy = ${CMS_TESTS_LOCAL_COPY:-true}
tests_local_copy_path = "${CMS_DATA_DIR}/tests/"
max_submission_length = ${CMS_MAX_SUBMISSION_LENGTH}
max_input_length = ${CMS_MAX_INPUT_LENGTH}
docs_path = "${CMS_DOCS_PATH:-/usr/share/cms/docs}"
# Auto-select contest if specified
contest = ${CMS_CONTEST_ID:-null}

[admin_web_server]
listen_address = "${CMS_ADMIN_LISTEN_ADDRESS}"
listen_port = ${CMS_ADMIN_LISTEN_PORT}
cookie_duration = ${CMS_ADMIN_COOKIE_DURATION}
num_proxies_used = ${CMS_NUM_PROXIES:-1}
# Auto-select contest if specified  
contest = ${CMS_CONTEST_ID:-null}

[proxy_service]
rankings = ["http://${CMS_RANKING_USERNAME}:${CMS_RANKING_PASSWORD}@cms-ranking:8890/"]

[printing]
max_print_length = ${CMS_PRINT_MAX_LENGTH:-10000000}
paper_size = "${CMS_PRINT_PAPER_SIZE:-A4}"
max_pages_per_job = ${CMS_PRINT_MAX_PAGES:-10}
max_jobs_per_user = ${CMS_PRINT_MAX_JOBS:-10}
pdf_printing_allowed = ${CMS_PRINT_PDF_ALLOWED:-false}

[prometheus]
listen_address = "${CMS_PROMETHEUS_ADDRESS:-0.0.0.0}"
listen_port = ${CMS_PROMETHEUS_PORT:-8811}
EOF

# Add Telegram bot configuration if enabled
if [ "${CMS_TELEGRAM_ENABLED:-false}" = "true" ]; then
    cat >> /opt/cms/config/cms.toml <<EOF

[telegram_bot]
bot_token = "${CMS_TELEGRAM_BOT_TOKEN}"
chat_id = "${CMS_TELEGRAM_CHAT_ID}"
EOF
    echo "Telegram bot configuration added."
fi

echo "=== Generated CMS Configuration ==="
cat /opt/cms/config/cms.toml
echo "=================================="

# Test database connection with psql
echo "Testing direct database connection..."
PGPASSWORD="${CMS_DB_PASSWORD}" psql -h "${CMS_DB_HOST}" -p "${CMS_DB_PORT}" -U "${CMS_DB_USER}" -d "${CMS_DB_NAME}" -c "SELECT version();" || {
    echo "ERROR: Cannot connect to database directly!"
    echo "Connection details:"
    echo "  Host: ${CMS_DB_HOST}"
    echo "  Port: ${CMS_DB_PORT}"
    echo "  User: ${CMS_DB_USER}"
    echo "  Database: ${CMS_DB_NAME}"
    exit 1
}

# Initialize database if needed
echo "Checking if database is initialized..."
if ! CMS_CONFIG=/opt/cms/config/cms.toml cmsInitDB --check 2>/dev/null; then
    echo "Database not initialized. Initializing CMS database..."
    echo "Using configuration: /opt/cms/config/cms.toml"
    echo "Database connection string in config:"
    grep "url =" /opt/cms/config/cms.toml
    CMS_CONFIG=/opt/cms/config/cms.toml cmsInitDB
else
    echo "Database already initialized."
fi

# Handle contest setup
if [ "${CMS_AUTO_CREATE_CONTEST:-false}" = "true" ]; then
    echo "Auto-contest creation enabled..."
    
    # Wait a moment for database to be fully ready
    sleep 2
    
    # Check if any contests exist using SQL query
    contest_count=$(CMS_CONFIG=/opt/cms/config/cms.toml PGPASSWORD="${CMS_DB_PASSWORD}" psql -h "${CMS_DB_HOST}" -p "${CMS_DB_PORT}" -U "${CMS_DB_USER}" -d "${CMS_DB_NAME}" -t -c "SELECT COUNT(*) FROM contests;" 2>/dev/null | tr -d ' ' || echo "0")
    
    if [ "$contest_count" -eq 0 ]; then
        echo "No contests found. Creating sample contest..."
        
        # Create a simple SQL script to insert a basic contest
        cat > /tmp/create_contest.sql <<EOF
INSERT INTO contests (
    name, 
    description, 
    start, 
    stop, 
    timezone,
    languages,
    token_mode,
    token_max_number,
    token_min_interval,
    token_gen_initial,
    token_gen_number,
    token_gen_interval,
    max_submission_number,
    max_user_test_number,
    score_precision
) VALUES (
    '${CMS_CONTEST_NAME:-Sample Programming Contest}',
    '${CMS_CONTEST_DESCRIPTION:-A sample contest for testing CMS deployment}',
    '${CMS_CONTEST_START_TIME:-2024-01-01 00:00:00}',
    '${CMS_CONTEST_END_TIME:-2024-12-31 23:59:59}',
    '${CMS_CONTEST_TIMEZONE:-UTC}',
    '${CMS_CONTEST_LANGUAGES:-["C++17 / g++", "C11 / gcc", "Python 3 / CPython", "Java / JDK"]}',
    '${CMS_CONTEST_TOKEN_MODE:-finite}',
    ${CMS_CONTEST_TOKEN_MAX:-100},
    ${CMS_CONTEST_TOKEN_MIN_INTERVAL:-60},
    ${CMS_CONTEST_TOKEN_INITIAL:-2},
    ${CMS_CONTEST_TOKEN_GEN_NUMBER:-1},
    ${CMS_CONTEST_TOKEN_GEN_INTERVAL:-600},
    ${CMS_CONTEST_MAX_SUBMISSIONS:-100},
    ${CMS_CONTEST_MAX_USER_TESTS:-100},
    ${CMS_CONTEST_SCORE_PRECISION:-2}
);
EOF

        # Execute the SQL to create the contest
        CMS_CONFIG=/opt/cms/config/cms.toml PGPASSWORD="${CMS_DB_PASSWORD}" psql -h "${CMS_DB_HOST}" -p "${CMS_DB_PORT}" -U "${CMS_DB_USER}" -d "${CMS_DB_NAME}" -f /tmp/create_contest.sql
        
        if [ $? -eq 0 ]; then
            echo "Sample contest created successfully!"
            # Set the contest ID to 1 (first contest)
            export CMS_CONTEST_ID=1
        else
            echo "Warning: Failed to create sample contest. You can create contests manually via admin panel."
        fi
        
        # Clean up
        rm -f /tmp/create_contest.sql
    else
        echo "Found $contest_count existing contest(s). Using existing contests."
        if [ "${CMS_CONTEST_ID:-null}" = "null" ]; then
            echo "No specific contest ID set. First contest will be auto-selected."
            export CMS_CONTEST_ID=1
        fi
    fi
else
    echo "Auto-contest creation disabled. Use admin panel to create contests manually."
fi

# Create required directories
mkdir -p "${CMS_LOG_DIR}" "${CMS_CACHE_DIR}" "${CMS_DATA_DIR}" "${CMS_RUN_DIR}"
mkdir -p "${CMS_DATA_DIR}/submissions" "${CMS_DATA_DIR}/tests"

# Start CMS services
echo "Starting CMS core services..."

# Start ResourceService first (it manages other services)
CMS_CONFIG=/opt/cms/config/cms.toml cmsResourceService &

# Start core backend services
CMS_CONFIG=/opt/cms/config/cms.toml cmsLogService &
CMS_CONFIG=/opt/cms/config/cms.toml cmsScoringService &
CMS_CONFIG=/opt/cms/config/cms.toml cmsEvaluationService &
CMS_CONFIG=/opt/cms/config/cms.toml cmsProxyService &

# Start workers
for i in $(seq 0 $((CMS_NUM_WORKERS-1))); do
    CMS_CONFIG=/opt/cms/config/cms.toml cmsWorker $i &
done

# Start web servers
CMS_CONFIG=/opt/cms/config/cms.toml cmsContestWebServer &
CMS_CONFIG=/opt/cms/config/cms.toml cmsAdminWebServer &

# Wait for all background processes
wait
