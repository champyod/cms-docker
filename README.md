# CMS Docker Deployment

Docker-based deployment for [Contest Management System (CMS)](https://github.com/cms-dev/cms).

## Quick Start

### Local / VM Deployment (No Public IP)
By default, the setup binds to `0.0.0.0`, so you can access the services via:
- **Localhost:** `http://localhost:8889` (Admin), `http://localhost:8888` (Contest)
- **VM IP:** `http://<vm-ip>:8889` (Admin), `http://<vm-ip>:8888` (Contest)

You do **not** need a public IP or domain name for local testing.

### Steps
```bash
# 1. Clone and setup
git clone https://github.com/champyod/cms-docker.git
cd cms-docker
git submodule update --init --recursive

# 2. Configure environment
cp .env.core.example .env.core  # Edit with your settings
make env

# 3. Deploy
make core
docker exec -it cms-log-service cmsInitDB
docker exec -it cms-log-service cmsAddAdmin admin -p YourPassword!
make admin
make contest
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

## Remote Workers

**Current limitation:** Remote workers (on separate machines) require manual configuration:

1. Expose core service ports on the main server (26000+ for workers)
2. Edit `config/cms.toml` on the remote worker to use the main server's public IP
3. Set unique `WORKER_SHARD` (10+) in `.env.worker`

This setup is designed for **single-server** deployment. Multi-server support is planned.

## Requirements

- Docker 20.10+
- Docker Compose v2
- 1+ CPU, 2GB+ RAM (recommended: 2+ CPU, 4GB+ RAM)

## License

AGPL-3.0 (same as CMS)
