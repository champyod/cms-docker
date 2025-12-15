# CMS Docker Deployment

Docker-based deployment for [Contest Management System (CMS)](https://github.com/cms-dev/cms).

## Quick Start

```bash
# 1. Clone and setup
git clone https://github.com/champyod/cms-docker.git
cd cms-docker
git submodule update --init --recursive

# 2. Configure environment
cp .env.core.example .env.core  # Edit with your settings
make env

# 3. Deploy
docker compose -f docker-compose.core.yml up -d
docker exec -it cms-log-service cmsInitDB
docker exec -it cms-log-service cmsAddAdmin admin -p YourPassword!
docker compose -f docker-compose.admin.yml up -d
docker compose -f docker-compose.contest.yml up -d
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

Run `make env` to generate the combined `.env` and `config/cms.conf`.

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
docker compose -f docker-compose.worker.yml up -d

# Check worker logs
docker logs cms-worker-0 -f
```

## Scoreboard (Ranking)

Deployed with Admin stack at `http://YOUR_IP:8890`.
Credentials: Set `RANKING_USERNAME` and `RANKING_PASSWORD` in `.env.admin`.

## Remote Workers

**Current limitation:** Remote workers (on separate machines) require manual configuration:

1. Expose core service ports on the main server (26000+ for workers)
2. Edit `config/cms.conf` on the remote worker to use the main server's public IP
3. Set unique `WORKER_SHARD` (10+) in `.env.worker`

This setup is designed for **single-server** deployment. Multi-server support is planned.

## Requirements

- Docker 20.10+
- Docker Compose v2
- 1+ CPU, 2GB+ RAM (recommended: 2+ CPU, 4GB+ RAM)

## License

AGPL-3.0 (same as CMS)
