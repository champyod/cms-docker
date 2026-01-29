# CMS Docker Deployment

Scalable, containerized deployment for the [Contest Management System (CMS)](https://github.com/cms-dev/cms).

## Quick Start

### 1. Build & Setup
Clone the repository and initialize the configuration.

```bash
# Clone
git clone https://github.com/champyod/cms-docker.git
cd cms-docker
git submodule update --init --recursive

# Initialize Configuration
cp .env.core.example .env.core
cp .env.admin.example .env.admin
cp .env.contest.example .env.contest
cp .env.worker.example .env.worker
cp .env.infra.example .env.infra   # Infrastructure Monitoring

# Generate Environment
# This compiles all .env files and configurations
make env
```

### 2. Deploy Services
You can choose to deploy using pre-built images (recommended) or build from source.

**Option A: Pre-built Images (Recommended)**
Uses Optimized images from GitHub Container Registry.

```bash
# Login (Required for private packages, optionally skip if public)
# echo "TOKEN" | docker login ghcr.io -u USER --password-stdin

make pull
make core-img     # Start Core Services (DB, Log, Resource)
make cms-init     # Initialize Database (Run once)
make admin-create # Create Superadmin
make admin-img    # Start Admin Panel
make contest-img  # Start Contest Interface
```

**Option B: Build from Source**
Builds everything locally.

```bash
make core
make cms-init
make admin-create
make admin contest worker
```

### 3. Access
By default, services are bound to `0.0.0.0`:
*   **Modern Admin Panel (Next.js by CCYod)**: [http://localhost:8891](http://localhost:8891)
*   **Classic Admin Panel (Original CMS)**: [http://localhost:8889](http://localhost:8889)
*   **Contestant Interface**: [http://localhost:8888](http://localhost:8888)
*   **Ranking**: [http://localhost:8890](http://localhost:8890)

---

## Infrastructure Monitoring

This repository includes a lightweight monitoring service that tracks CPU, Memory, Disk, and Docker status, alerting via Discord.

### Configuration
1.  Copy the example config: `cp .env.infra.example .env.infra`
2.  Edit `.env.infra`:
    ```ini
    DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
    DISCORD_USER_ID=123456789...
    MONITOR_INTERVAL=10
    ```
3.  Deploy: `make infra`

### Management
```bash
make infra        # Start monitoring
make infra-stop   # Stop monitoring
```

---

## Command Reference

The `Makefile` provides a standardized interface for managing the stack.

| Command | Action |
| :--- | :--- |
| `make env` | Generates `.env` and `config/cms.toml` from templates. |
| `make core` / `admin` / `contest` | Build and start specific stacks. |
| `make {service}-img` | Start specific stacks using pre-built images. |
| `make {service}-stop` | Stop specific stacks (`core`, `admin`, `contest`, `infra`). |
| `make {service}-clean` | Stop and **delete volumes** for specific stacks. |
| `make db-clean` | **FULL RESET**: Deletes all services and data. |
| `make cms-init` | Initialize or patch the database schema. |
| `make admin-create` | Interactive utility to create a new admin. |

---

## Architecture

This deployment isolates CMS components into four logical stacks for scalability.

### Core Stack (`docker-compose.core.yml`)
*   **PostgreSQL**: Main database.
*   **LogService**: Central logging RPC.
*   **ResourceService**: File storage RPC.
*   **ScoringService**: Calculates scores.
*   **ProxyService**: Balances worker connections.
*   **Checker**: Runs solutions (Internal).

### Admin Stack (`docker-compose.admin.yml`)
*   **AdminPanel (Next.js by CCYod)**: The modern, responsive administration interface (Port 8891).
*   **AdminWebServer (Classic)**: The original CMS admin interface (Port 8889).
*   **RankingWebServer**: Real-time scoreboard.

### Contest Stack (`docker-compose.contest.yml`)
*   **ContestWebServer**: The interface for contestants to submit solutions.

### Worker Stack (`docker-compose.worker.yml`)
*   **Worker**: Distributed sandboxed execution environments.

### Monitor Stack (`docker-compose.monitor.yml`)
*   **Monitor**: Lightweight resource tracking and alerting.

---

## Configuration Details

### Environment Files
*   **`.env.core`**: The **Source of Truth**. Contains DB credentials, external application URL/IP, and secrets. Start configuration here.
*   **`.env.admin`**: Admin panel ports and auth settings.
*   **`.env.contest`**: Contest interface ports.
*   **`.env.worker`**: Worker resource limits.

### Advanced: Distributed Workers
To scale the system, you can run Workers on separate machines.

#### 1. Server Setup (Main Machine)
1.  **Expose RPC Services**:
    Edit `docker-compose.core.yml` to expose ports `29000` (LogService) and `28000` (ResourceService):
    ```yaml
    # LogService
    ports:
      - "29000:29000"
    
    # ResourceService
    ports:
      - "28000:28000"
    ```
2.  **Allow Connection**:
    Edit `config/cms.toml` (or `config/cms.sample.toml` if regenerating) to whitelist the Worker's IP.
    ```toml
    Worker = [
        ["127.0.0.1", 26000],      # Local Worker
        ["192.168.1.50", 26001],   # Remote Worker IP and Port
    ]
    ```
3.  **Restart Core**: `make core-img` (or `make core`)

#### 2. Worker Setup (Remote Machine)
1.  **Configure Network**:
    Edit `docker-compose.worker.yml` to use Host Networking. This bypasses Docker's bridge network and is often required for the Worker to correctly communicate back to the Core.
    ```yaml
    services:
      worker:
        network_mode: "host"
        # remove 'networks' and 'ports' sections
    ```
2.  **Configure Environment**:
    Edit `.env.worker`:
    ```ini
    WORKER_SHARD=1                    # Unique ID (0, 1, 2...)
    CORE_SERVICES_HOST=192.168.1.10   # IP of the Main Server
    ```
3.  **Configure Config**:
    On the worker machine, `config/cms.toml` needs to know where the LogService is.
    *   Update `LogService` and `ResourceService` addresses to point to the Main Server IP.
    *   Update `database` connection string if needed.
    *   *Tip*: You can mostly copy `config/cms.toml` from the main server, but ensure the `Worker` section reflects the local binding.
4.  **Firewall (Important)**
    If your worker is on a VM (e.g., KVM/Libvirt), open the port:
    ```bash
    sudo firewall-cmd --zone=libvirt --add-port=26001/tcp --permanent
    sudo firewall-cmd --reload
    ```
5.  **Deploy**:
    ```bash
    make worker-img
    ```

---

## Troubleshooting

*   **Database Errors ("DuplicateObject")**:
    This means the DB is already initialized. Use `make db-clean` if you want a complete reset.
*   **Worker Not Connecting**:
    Check `docker logs cms-worker-0`. Ensure `config/cms.toml` has the correct `LogService` IP if running distributed.
*   **Changes Not Applying**:
    `make env` does not overwrite existing config files to prevent data loss. Delete `config/cms.toml` separately if you want to force regeneration.

## License

AGPL-3.0 (Derived from CMS)
