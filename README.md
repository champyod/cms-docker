# CMS Docker Deployment

Scalable, containerized deployment for the [Contest Management System (CMS)](https://github.com/cms-dev/cms).

> **📚 New to CMS?** Check out our [**Step-by-Step Tutorial**](docs/TUTORIAL.md) for a complete walkthrough!

## Quick Start (Recommended)

The easiest way to deploy or update CMS is using our automated scripts.

### 1. Initial Setup
Clone the repository and initialize the submodules.

```bash
# Clone
git clone https://github.com/champyod/cms-docker.git
cd cms-docker
git submodule update --init --recursive
```

### 2. Configure Environment
Use the interactive configuration tool to set up your `.env` files. This script will ask you for credentials or generate secure random passwords for you.

```bash
./scripts/configure-env.sh
```

### 3. Deploy
Run the comprehensive setup script. It will detect if you are performing a fresh install or an update, ask for your preferred deployment strategy (Pre-built Images vs. Source Build), and handle the entire deployment process automatically.

```bash
./scripts/setup.sh
```

---

## Access & Management

By default, services are bound to `0.0.0.0`:
*   **Modern Admin Panel (Next.js)**: [http://localhost:8891](http://localhost:8891) — **Manage everything here!**
*   **Contestant Interface**: [http://localhost:8888](http://localhost:8888)
*   **Classic Admin Panel**: [http://localhost:8889](http://localhost:8889)
*   **Ranking**: [http://localhost:8890](http://localhost:8890)

### Container Restart Control
Navigate to **Containers** in the Admin Panel to manage auto-restart policies:
- Toggle auto-restart per container (default: OFF)
- Set max restart attempts (default: 5)
- View restart counts and reset when needed
- All containers use `on-failure:5` policy to prevent infinite restart loops

### Multi-Contest Deployment
You can now run multiple contests simultaneously on different ports.
1.  Navigate to **Infrastructure** → **Deployments** in the Admin Panel.
2.  Add instances with specific Contest IDs and Ports.
3.  Click **Save & Restart Stack** to apply.

### Secure Remote Workers (Tailscale)
For maximum security, remote evaluation workers should connect over a VPN like **Tailscale**.
1.  During `./scripts/setup.sh`, choose to enable Tailscale restriction.
2.  Provide your server's Tailscale IP.
3.  The system will bind all internal RPC ports (Log, Resource, etc.) to that IP, making them invisible to the public internet.
4.  Remote workers simply need to connect to your Tailscale IP to start evaluating.

### Automated Backups
... (rest same)

The system now supports automated submission backups to CSV with smart cleanup policies.
1.  Navigate to **Infrastructure** → **Maintenance** in the Admin Panel.
2.  Configure backup intervals and retention limits (Count, Age, or Size).
3.  Backups are stored in the `./backups` directory and success/failure is logged to Discord.

---

## Advanced Manual Deployment

If you prefer manual control, you can use the following commands:

**Step 1: Configuration**
```bash
cp .env.core.example .env.core
# ... edit .env.* files ...
make env
```

**Step 2: Deploy with Images**
```bash
make pull
make core-img     # Start Core Services
make cms-init     # Initialize Database
make admin-create # Create Superadmin
make admin-img    # Start Admin Panel
make contest-img  # Start Contest Interface
```

**Step 3: Build from Source**
```bash
make core
make cms-init
make admin-create
make admin contest worker
```

---

## Worker Management
... (rest of the file)


Workers are now configured via environment variables in `.env.core`, ensuring they persist across `make env` regenerations.

### Adding Workers via Admin UI
The modern Admin Panel (port 8891) provides a UI to manage workers. When you add/remove workers through the UI:
1.  The UI calls `scripts/manage-workers.sh` to update `.env.core`
2.  Run `make env` to regenerate `cms.toml` with the new worker configuration
3.  Restart relevant services: `make core-img`

### Manual Worker Configuration
Edit `.env.core` and add workers in the format:
```ini
WORKER_0=cms-worker-0:26000
WORKER_1=192.168.1.50:26001
WORKER_2=remote-server:26000
```

Then regenerate configuration:
```bash
make env
make core-img  # or: docker restart cms-log-service
```

### Helper Script
```bash
# List workers
./scripts/manage-workers.sh list

# Add a worker
./scripts/manage-workers.sh add "cms-worker-1" 26001

# Remove worker
./scripts/manage-workers.sh remove 1

# Update worker
./scripts/manage-workers.sh update 0 "new-host" 26000
```

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

## Batch Contest Creation

Create multiple contests at once using YAML or JSON configuration files.

### Quick Start

```bash
# Create contests from YAML
./scripts/create-contests.sh -f examples/contests.yaml

# Dry run (preview without creating)
./scripts/create-contests.sh -f examples/contests.yaml --dry-run

# Using JSON
./scripts/create-contests.sh -f examples/contests.json
```

### Sample Configuration

**examples/contests.yaml:**
```yaml
contests:
  - name: "Practice Contest 2024"
    description: "A warm-up contest"
    start_time: "2024-03-01T10:00:00"
    end_time: "2024-03-01T12:00:00"
    token_mode: "disabled"
    max_submission_number: 50
    
  - name: "Advanced Challenge"
    description: "Expert problems"
    start_time: "2024-03-15T09:00:00"
    end_time: "2024-03-15T14:00:00"
    token_mode: "finite"
    token_max_number: 100
```

See [`examples/contests.yaml`](examples/contests.yaml) for more examples.

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
