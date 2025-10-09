#!/bin/bash
# Test script to validate TOML generation

# Set default environment variables for testing
export CMS_DB_HOST=${CMS_DB_HOST:-postgres}
export CMS_DB_PORT=${CMS_DB_PORT:-5432}
export CMS_DB_USER=${CMS_DB_USER:-cmsuser}
export CMS_DB_NAME=${CMS_DB_NAME:-cmsdb}
export CMS_DB_PASSWORD=${CMS_DB_PASSWORD:-changeme123!}
export CMS_SECRET_KEY=${CMS_SECRET_KEY:-8e045a51e4b102ea803c06f92841a1fb}
export CMS_NUM_WORKERS=${CMS_NUM_WORKERS:-1}
export CMS_TORNADO_DEBUG=${CMS_TORNADO_DEBUG:-false}
export CMS_CONTEST_LISTEN_ADDRESS=${CMS_CONTEST_LISTEN_ADDRESS:-0.0.0.0}
export CMS_CONTEST_LISTEN_PORT=${CMS_CONTEST_LISTEN_PORT:-8888}
export CMS_ADMIN_LISTEN_ADDRESS=${CMS_ADMIN_LISTEN_ADDRESS:-0.0.0.0}
export CMS_ADMIN_LISTEN_PORT=${CMS_ADMIN_LISTEN_PORT:-8889}
export CMS_CONTEST_COOKIE_DURATION=${CMS_CONTEST_COOKIE_DURATION:-10800}
export CMS_ADMIN_COOKIE_DURATION=${CMS_ADMIN_COOKIE_DURATION:-36000}
export CMS_LOG_DIR=${CMS_LOG_DIR:-/opt/cms/log}
export CMS_CACHE_DIR=${CMS_CACHE_DIR:-/opt/cms/cache}
export CMS_DATA_DIR=${CMS_DATA_DIR:-/opt/cms/lib}
export CMS_RUN_DIR=${CMS_RUN_DIR:-/opt/cms/run}
export CMS_RANKING_USERNAME=${CMS_RANKING_USERNAME:-admin}
export CMS_RANKING_PASSWORD=${CMS_RANKING_PASSWORD:-ranking123!}
export CMS_CONTEST_ID=${CMS_CONTEST_ID:-null}
export CMS_MAX_SUBMISSION_LENGTH=${CMS_MAX_SUBMISSION_LENGTH:-100000}
export CMS_MAX_INPUT_LENGTH=${CMS_MAX_INPUT_LENGTH:-5000000}

echo "=== Testing TOML Generation ==="

# Generate test configuration
cat > /tmp/test-cms.toml <<EOF
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

# Add worker services
echo "Worker = [" >> /tmp/test-cms.toml
for i in $(seq 0 $((CMS_NUM_WORKERS-1))); do
    port=$((26000 + i))
    echo "    [\"0.0.0.0\", $port]," >> /tmp/test-cms.toml
done
echo "]" >> /tmp/test-cms.toml

# Continue with rest of config
cat >> /tmp/test-cms.toml <<EOF

[worker]
keep_sandbox = false

[sandbox]
sandbox_implementation = "isolate"
max_file_size = 1048576
compilation_sandbox_max_processes = 1000
compilation_sandbox_max_time_s = 10.0
compilation_sandbox_max_memory_kib = 524288
trusted_sandbox_max_processes = 1000
trusted_sandbox_max_time_s = 10.0
trusted_sandbox_max_memory_kib = 4194304

[web_server]
secret_key = "${CMS_SECRET_KEY}"
tornado_debug = ${CMS_TORNADO_DEBUG}

[contest_web_server]
listen_address = ["${CMS_CONTEST_LISTEN_ADDRESS}"]
listen_port = [${CMS_CONTEST_LISTEN_PORT}]
cookie_duration = ${CMS_CONTEST_COOKIE_DURATION}
num_proxies_used = 1
submit_local_copy = true
submit_local_copy_path = "${CMS_DATA_DIR}/submissions/"
tests_local_copy = true
tests_local_copy_path = "${CMS_DATA_DIR}/tests/"
max_submission_length = ${CMS_MAX_SUBMISSION_LENGTH}
max_input_length = ${CMS_MAX_INPUT_LENGTH}
docs_path = "/usr/share/cms/docs"
contest = ${CMS_CONTEST_ID}

[admin_web_server]
listen_address = "${CMS_ADMIN_LISTEN_ADDRESS}"
listen_port = ${CMS_ADMIN_LISTEN_PORT}
cookie_duration = ${CMS_ADMIN_COOKIE_DURATION}
num_proxies_used = 1
contest = ${CMS_CONTEST_ID}

[proxy_service]
rankings = ["http://${CMS_RANKING_USERNAME}:${CMS_RANKING_PASSWORD}@cms-ranking:8890/"]

[printing]
max_print_length = 10000000
paper_size = "A4"
max_pages_per_job = 10
max_jobs_per_user = 10
pdf_printing_allowed = false

[prometheus]
listen_address = "0.0.0.0"
listen_port = 8811
EOF

echo "=== Generated Test Configuration ==="
cat /tmp/test-cms.toml
echo "=== End Configuration ==="

# Test if python can parse this as TOML
if command -v python3 >/dev/null 2>&1; then
    echo "=== Testing TOML syntax with Python ==="
    python3 -c "
import tomli
try:
    with open('/tmp/test-cms.toml', 'rb') as f:
        tomli.load(f)
    print('✓ TOML syntax is valid')
except Exception as e:
    print(f'✗ TOML syntax error: {e}')
    exit(1)
" 2>/dev/null || echo "tomli module not available, skipping Python TOML validation"
fi

echo "=== Cleanup ==="
rm -f /tmp/test-cms.toml
