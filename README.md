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
```

## Configuration

Environment files:
- `.env.core` - Database and core settings
- `.env.admin` - Admin interface settings
- `.env.contest` - Contest settings
- `.env.worker` - Worker settings

Run `make env` to generate the combined `.env` and `config/cms.toml`.

## Deployment Reference

### Option A: Pre-built Images (Recommended)
This method is faster and saves disk space on the VM as it pulls images from GitHub Container Registry.

```bash
# 1. Login to GitHub Container Registry (One time setup)
# Use your GitHub Username and a Personal Access Token (Classic) with 'read:packages' scope
echo "YOUR_PAT_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

# 2. Deploy
make pull         # Pull latest images
make core-img     # Start Core services

# 3. Initialize Database (First time only)
# This will run cmsInitDB followed by Prisma synchronization
make cms-init

# 4. Create Admin User
# Use the official CMS command to create your first superadmin
make admin-create

# 5. Start the rest of the stacks
make admin-img contest-img worker-img
```

### Option B: Build from Source (Manual)
Use these commands if you are modifying the source code and need to rebuild locally.

```bash
# 1. Build and Deploy
make core      # Build and deploy Core
make admin     # Build and deploy Admin
make contest   # Build and deploy Contest
make worker    # Build and deploy Worker

# 2. Initialize Database (First time only)
make cms-init

# 3. Create Admin User
make admin-create
```

### Maintenance

#### Updating Deployment
To update your deployment with the latest images:

```bash
# 1. Pull the latest images
make pull

# 2. Update and restart Core services
make core-img

# 3. Update and restart other services
make admin-img contest-img worker-img

# 4. (Optional) Remove old unused images
docker image prune -f
```

#### Full System Reset
If you encounter "DuplicateObject" or "Relation does not exist" errors, perform a full reset:
```bash
make db-reset   # Deletes volumes, restarts core
make cms-init    # Re-initializes everything
```

#### Automatic Updates (Optional)
To enable automatic updates (checking every 60 seconds):
1.  Open `docker-compose.core.img.yml`.
2.  Uncomment the `watchtower` service block.
3.  Run `make core-img`.

### Troubleshooting

- **"Type codename already exists"**: This happens if database initialization was interrupted or partially run.
  If you want a fresh start, run: `docker compose down -v` to clear volumes, then start again from `make core-img`.
- **"Relation 'contests' does not exist"**: Run `make db-init`.
- **Stuck at "Compiling"**: The Worker failed to connect. Run `docker restart cms-worker-0`.
- **Config changes not applying**: `make env` does not overwrite. Delete `config/cms.toml` then run `make env` again.

## Services

| Stack | Services | Port |
|-------|----------|------|
| Core | Database, LogService, ResourceService, ScoringService, EvaluationService, ProxyService, CheckerService | - |
| Admin | AdminWebServer, RankingWebServer | 8889, 8890 |
| Contest | ContestWebServer | 8888 |
| Worker | Worker | - |

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

### Server Setup (Main Machine)

1.  **Expose Ports**: Edit `docker-compose.core.yml` to expose LogService (29000), ResourceService (28000), and Database (5432).
    ```yaml
    # Example for LogService
    ports:
      - "29000:29000"
    ```
2.  **Allow Connection**: Update `config/cms.toml` to recognize the Worker's IP.
    ```toml
    Worker = [
        ...
        ["192.168.122.1", 26002],  # IP of the remote worker machine
    ]
    ```
3.  **Restart**: Run `make core`.

### Worker Setup (Remote Machine)

1.  **Configure Network**: Edit `docker-compose.worker.yml` to use Host Networking (bypasses Docker bridge issues).
    ```yaml
    network_mode: "host"
    # Remove 'networks' and 'ports' sections
    ```
2.  **Configure Environment**: Edit `.env.worker`:
    ```bash
    WORKER_SHARD=2                  # Unique shard ID
    CORE_SERVICES_HOST=192.168.122.79  # IP of the Main Server
    ```
3.  **Configure Config**: Update `config/cms.sample.toml` (and regenerate `cms.toml` via `make env`):
    - Point `LogService`, `ResourceService`, and `database` URL to the Main Server IP (`192.168.122.79`).
    - Bind the Worker to the *Host Machine's IP*:
      ```toml
      Worker = [ ... ["192.168.122.1", 26002] ... ]
      ```
4.  **Deploy**:
    
    **Option 1: Pre-built Images (Recommended)**
    ```bash
    rm config/cms.toml && make env
    make pull
    make worker-img
    ```
    
    **Option 2: Build from Source**
    ```bash
    rm config/cms.toml && make env
    make worker
    ```

    **Important**: If your worker is on the host machine and the server is in a VM (KVM/Libvirt), you may need to open the port on the `libvirt` zone:
    ```bash
    sudo firewall-cmd --zone=libvirt --add-port=26002/tcp --permanent
    sudo firewall-cmd --reload
    ```

## Requirements

- Docker 20.10+
- Docker Compose v2
- 1+ CPU, 2GB+ RAM (recommended: 2+ CPU, 4GB+ RAM)

## License

AGPL-3.0 (same as CMS)
