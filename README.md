# CMS Docker Deployment

Docker-based deployment for [Contest Management System (CMS)](https://github.com/cms-dev/cms).

## Quick Start

### Local / VM Deployment (No Public IP)
By default, the setup binds to `0.0.0.0`, so you can access the services via:
- **Localhost:** `http://localhost:8889` (Admin), `http://localhost:8888` (Contest)
- **VM IP:** `http://<vm-ip>:8889` (Admin), `http://<vm-ip>:8888` (Contest)

You do **not** need a public IP or domain name for local testing.

### Build Configuration (Optional)
This repository uses the **Thai Ubuntu mirror** (`th.archive.ubuntu.com`) by default for faster builds. If you are in another region, you can change this:

**Option 1: Build command**
```bash
docker compose build --build-arg APT_MIRROR=archive.ubuntu.com
```

**Option 2: Docker Compose (Permanent)**
Add `args: { APT_MIRROR: archive.ubuntu.com }` to the `build` section of your services in `docker-compose.yml`.

### Steps
```bash
# 1. Clone and setup
git clone https://github.com/champyod/cms-docker.git
cd cms-docker
git submodule update --init --recursive

# 2. Configure environment (Critical Step)
cp .env.core.example .env.core  # Edit with your settings
make env  # Generates .env and config/cms.toml

# 3. Deploy
make core
# Wait for services to be healthy (check 'docker ps')
docker exec -it cms-log-service cmsInitDB  # Create database schema
docker exec -it cms-log-service cmsAddAdmin admin -p YourPassword! # Create admin
make admin
make contest
make worker

### Troubleshooting

- **"Relation 'contests' does not exist"**: Run `docker exec -it cms-log-service cmsInitDB`.
- **Stuck at "Compiling"**: The Worker failed to connect. Run `docker restart cms-worker-0`.
- **"Unable to invalidate" / "Service not connected"**: Core services mesh is broken. Run `docker restart cms-evaluation-service` or restart the whole stack.
- **Config changes not applying**: `make env` does not overwrite. Delete `config/cms.toml` then run `make env` again.
- **"No space left on device"**: 
  1. **Prune**: Run `docker system prune -a --volumes` to free space.
  2. **Sequential Build**: Parallel builds can exhaust disk/inodes. Build services one by one:
     ```bash
     docker compose build log-service
     docker compose build resource-service
     docker compose build scoring-service
     docker compose build checker-service
     docker compose build evaluation-service
     docker compose build proxy-service
     docker compose build worker
     make core
     ```

## Services

| Stack | Services | Port |
|-------|----------|------|
| Core | Database, LogService, ResourceService, ScoringService, EvaluationService, ProxyService, CheckerService | - |
| Admin | AdminWebServer, RankingWebServer | 8889, 8890 |
| Contest | ContestWebServer | 8888 |
| Worker | Worker | - |

## Configuration

Environment files:
- `.env.core` - Database and core settings
- `.env.admin` - Admin interface settings
- `.env.contest` - Contest settings
- `.env.worker` - Worker settings

Run `make env` to generate the combined `.env` and `config/cms.toml`.

## Commands

```bash
# Deploy stacks
make core      # Core services
make admin     # Admin + Ranking
make contest   # Contest web server
make worker    # Worker

# Admin management
docker exec -it cms-log-service cmsAddAdmin <username> -p <password>
docker exec -it cms-database psql -U cmsuser -d cmsdb -c "DELETE FROM admins WHERE username = '<username>';"

# View logs
docker logs cms-log-service -f
docker logs cms-admin-web-server -f
```

## Worker

Deploy workers to judge submissions:

```bash
make worker
# Check worker logs
docker logs cms-worker-0 -f
```

## Scoreboard (Ranking)

Deployed with Admin stack at `http://YOUR_IP:8890`.
Credentials: Set `RANKING_USERNAME` and `RANKING_PASSWORD` in `.env.admin`.

### Secure Remote Worker Setup (e.g., Raspberry Pi via Tailscale)
This guide assumes you are using **Tailscale** for a secure private network between your VPS and Worker.

### 1. VPS Setup (Main Server)
The VPS needs to allow the worker to connect to its internal services via the VPN.

1.  **Expose Ports to Tailscale**:
    - Add your **VPS Tailscale IP** to `.env.core`:
      ```bash
      TAILSCALE_IP=100.x.y.z
      ```
    - Run `make core` to apply changes. This updates `docker-compose.core.yml` to bind ports 29000 (Log), 28000 (Resource), 28001 (File), and 5432 (DB) **only** to your VPN IP. Secure! 🛡️

2.  **Allow Worker Connection**:
    - Edit `config/cms.toml` (or `cms.sample.toml` then `make env`):
      ```toml
      Worker = [
          ["cms-worker-0", 26000],        # Local worker (optional)
          ["100.a.b.c", 26000],           # REMOTE WORKER (Your Pi's Tailscale IP)
      ]
      ```
    - Restart services: `docker compose -f docker-compose.core.yml up -d`

### 2. Worker Setup (Raspberry Pi / Remote Machine)

1.  **Clone Repo**:
    ```bash
    git clone https://github.com/champyod/cms-docker.git
    cd cms-docker
    ```

2.  **Configure Environment**:
    - Copy `.env.worker.example` to `.env.worker`.
    - Set `BASE_IMAGE=debian:bookworm` (for Raspberry Pi, has native arm64 isolate packages).

3.  **Configure CMS**:
    - Copy `config/cms.sample.toml` to `config/cms.toml`.
    - **Manually Edit** `config/cms.toml`:
      - **Database**: `url = "postgresql+psycopg2://cmsuser:YOUR_PASSWORD@100.x.y.z:5432/cmsdb"` (VPS Tailscale IP)
      - **Services**: Change `cms-log-service`, `cms-resource-service` etc. to **VPS Tailscale IP** (`100.x.y.z`).
      - **Worker Bind**: Allow Docker to bind locally:
        ```toml
        Worker = [ ["0.0.0.0", 26000] ]
        ```
    - *Note: Do NOT run `make env` on the worker, as it lacks the core .env credentials.*

4.  **Enable Cgroups (Raspberry Pi Only)**:
    - Pi OS disables memory cgroups by default. Adding this is **mandatory** for sandbox to work.
    - Edit `/boot/firmware/cmdline.txt` and append to the end of the line:
      ```text
      cgroup_enable=cpuset cgroup_enable=memory cgroup_memory=1
      ```
    - Reboot: `sudo reboot`

5.  **Running**:
    ```bash
    # Build and start
    docker compose -f docker-compose.worker.yml build worker
    docker compose -f docker-compose.worker.yml up -d
    ```

### Troubleshooting Remote Workers
- **"Connection refused"**: Check if VPS exposed ports (28000/29000/5432) on the correct Tailscale IP. Run `netstat -tunlp | grep 5432` on VPS.
- **"Sandbox error"**:
  - Did you reboot the Pi after adding cgroups?
  - Are `isolate-N` users created? (The Dockerfile now handles this automatically).
- **Stuck at "Executing"**:
  - The VPS ResourceService can't reach the Pi. Check if Pi's `docker-compose.worker.yml` exposes port 26000.
  - Check if VPS `cms.toml` has the correct Pi Tailscale IP in `Worker` list.

## Requirements

- Docker 20.10+
- Docker Compose v2
- 1+ CPU, 2GB+ RAM (recommended: 2+ CPU, 4GB+ RAM)

## License

AGPL-3.0 (same as CMS)
