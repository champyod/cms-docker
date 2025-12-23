# CMS Docker Deployment

Docker-based deployment for [Contest Management System (CMS)](https://github.com/cms-dev/cms).

## Prerequisites

- **Docker** 20.10+
- **Docker Compose** v2+
- **Git** (with submodule support)
- **System**: 1+ CPU, 2GB+ RAM (recommended: 2+ CPU, 4GB+ RAM)

## Quick Start

### Step 1: Clone Repository

```bash
git clone --recursive https://github.com/cms-dev/cms-docker.git
cd cms-docker

# If you already cloned, initialize submodules:
git submodule update --init --recursive
```

### Step 2: Configure Environment

```bash
# Copy example environment files
cp .env.core.example .env.core
cp .env.admin.example .env.admin  # Optional
cp .env.contest.example .env.contest  # Optional
cp .env.worker.example .env.worker  # Optional

# Edit .env.core with your settings (database password, etc.)
nano .env.core

# Generate combined .env and config/cms.toml
make env
```

### Step 3: Deploy Core Services

```bash
# Start core services (database, log, resource, evaluation, etc.)
make core

# Wait for database to be healthy (check with 'docker ps')
# Then initialize database schema
docker exec -it cms-log-service cmsInitDB

# Create initial admin user
docker exec -it cms-log-service cmsAddAdmin admin -p YourSecurePassword123!
```

### Step 4: Deploy Web Interfaces

```bash
# Start admin interface (port 8889) and ranking (port 8890)
make admin

# Start contest interface for participants (port 8888)
make contest
```

### Step 5: Deploy Worker

```bash
# Start worker for evaluating submissions
make worker
```

### Step 6: Access the System

| Interface | URL | Description |
|-----------|-----|-------------|
| Admin | `http://localhost:8889` | Administration panel |
| Contest | `http://localhost:8888` | Participant interface |
| Ranking | `http://localhost:8890` | Public scoreboard |

> **Note:** Replace `localhost` with your server IP if accessing remotely.

## Build Configuration

This repository uses the **Thai Ubuntu mirror** (`th.archive.ubuntu.com`) by default. To use a different mirror:

**Option 1: Set in environment**
```bash
export APT_MIRROR=mirrors.digitalocean.com/ubuntu
make core
```

**Option 2: Build command**
```bash
docker compose build --build-arg APT_MIRROR=archive.ubuntu.com
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Relation 'contests' does not exist" | Run `docker exec -it cms-log-service cmsInitDB` |
| Stuck at "Compiling" | Worker failed to connect. Run `docker restart cms-worker-0` |
| "Unable to invalidate" / "Service not connected" | Run `docker restart cms-evaluation-service` |
| Config changes not applying | Delete `config/cms.toml` then run `make env` again |
| "No space left on device" | Run `docker system prune -a --volumes` to free space |

## Commands Reference

```bash
# Deploy stacks
make core      # Core services (database, log, resource, etc.)
make admin     # Admin interface + Ranking scoreboard
make contest   # Contest web interface
make worker    # Worker for judging submissions

# Admin management
docker exec -it cms-log-service cmsAddAdmin <username> -p <password>

# View logs
docker logs cms-log-service -f
docker logs cms-admin-web-server -f
docker logs cms-worker-0 -f
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

### Custom Logo

Replace the default placeholder logo with your own:

```bash
# Copy your logo to the ranking server
docker cp your_logo.png cms-ranking-web-server:/var/local/lib/cms/ranking/logo.png

# Restart to apply
docker restart cms-ranking-web-server

# IMPORTANT: Resync ranking data
docker restart cms-proxy-service
```

> **Note:** Always restart `cms-proxy-service` after restarting `cms-ranking-web-server` to resync users, teams, and submissions.

**Remove white background** (optional):
```bash
convert your_logo.png -fuzz 10% -transparent white your_logo_transparent.png
```

### Team Flags

Upload flags for teams (displayed next to team names):

```bash
# Upload flag for team "myteam"
docker cp myteam_flag.png cms-ranking-web-server:/var/local/lib/cms/ranking/flags/myteam.png
```

Supported formats: PNG, JPG, GIF.

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
