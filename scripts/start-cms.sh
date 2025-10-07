#!/bin/bash
set -e

# Wait for database to be ready
echo "Waiting for database..."
until pg_isready -h $CMS_DB_HOST -p $CMS_DB_PORT -U $CMS_DB_USER; do
    sleep 2
done

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

[admin_web_server]
listen_address = "${CMS_ADMIN_LISTEN_ADDRESS}"
listen_port = ${CMS_ADMIN_LISTEN_PORT}
cookie_duration = ${CMS_ADMIN_COOKIE_DURATION}
num_proxies_used = 1

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

# Initialize database if needed
if ! cmsInitDB --check 2>/dev/null; then
    echo "Initializing CMS database..."
    cmsInitDB
fi

# Create required directories
mkdir -p "${CMS_LOG_DIR}" "${CMS_CACHE_DIR}" "${CMS_DATA_DIR}" "${CMS_RUN_DIR}"
mkdir -p "${CMS_DATA_DIR}/submissions" "${CMS_DATA_DIR}/tests"

# Start CMS services
echo "Starting CMS core services..."

# Start ResourceService first (it manages other services)
cmsResourceService &

# Start core backend services
cmsLogService &
cmsScoringService &
cmsEvaluationService &
cmsProxyService &

# Start workers
for i in $(seq 0 $((CMS_NUM_WORKERS-1))); do
    cmsWorker $i &
done

# Start web servers
cmsContestWebServer &
cmsAdminWebServer &

# Wait for all background processes
wait
