# Service Dependencies and Restart Policies

This project uses `config/restart_policies.json` to define service dependencies and environment variable triggers for the CMS Docker deployment.

## Configuration Format

The configuration file is a JSON object with two main sections:

### 1. `dependencies`
Defines the restart cascade. If a service (Key) is restarted, all services listed in the Value must also be restarted to ensure consistency (e.g., reconnecting to the database or log service).

**Example:**
```json
"dependencies": {
  "cms-database": ["cms-log-service"],
  "cms-log-service": ["cms-resource-service", "cms-scoring-service"]
}
```

### 2. `env_triggers`
Defines which services must be restarted when a specific environment variable changes.

**Example:**
```json
"env_triggers": {
  "POSTGRES_PASSWORD": ["cms-database", "cms-admin-panel-next"],
  "CONTEST_ID": ["cms-contest-web-server"]
}
```

## Admin Panel Integration

The Admin Panel (`admin-panel`) uses this configuration to:
1.  **Detect Changes:** Compare current UI values with saved `.env` files.
2.  **Analyze Impact:** Recursively determine the full list of services that need restarting based on the `env_triggers` and `dependencies`.
3.  **Dedicated Modules:**
    *   **Deployments:** Manages multi-contest port mapping and triggers full-stack contest restarts.
    *   **Maintenance:** Manages backup policies and Discord logging.
4.  **Automate Restart:** Provides a "Save & Restart" button that updates the `.env` files and restarts the specific Docker containers using `docker compose`.


## Core Service Recovery

To ensure "perfect" and orderly recovery upon reboot or restart:
*   **Healthchecks:** Core services (`cms-database`, `cms-log-service`, etc.) are configured with Docker Healthchecks to report their actual readiness.
*   **Startup Order:** Dependent services use `depends_on` with `condition: service_healthy` to wait until their prerequisites are fully operational before starting.

### Recovery Chain
1.  **Database:** Starts first. Checks `pg_isready`.
2.  **Log Service:** Starts after Database is healthy. Checks TCP port 29000.
3.  **Core Services:** (Resource, Scoring, Evaluation, Proxy, Checker) Start after Log Service is healthy. Check their respective TCP ports.
4.  **Web Servers & Workers:** Start after Core Services are available.
