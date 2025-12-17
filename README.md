# CMS Docker Deployment

Docker-based deployment for [Contest Management System (CMS)](https://github.com/cms-dev/cms).

<<<<<<< HEAD
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
=======
[![Build Status](https://github.com/cms-dev/cms/actions/workflows/main.yml/badge.svg)](https://github.com/cms-dev/cms/actions)
[![Codecov](https://codecov.io/gh/cms-dev/cms/branch/main/graph/badge.svg)](https://codecov.io/gh/cms-dev/cms)
[![Get support on Telegram](https://img.shields.io/badge/Questions%3F-Join%20the%20Telegram%20group!-%2326A5E4?style=flat&logo=telegram)](https://t.me/contestms)
[![Translation status](https://hosted.weblate.org/widget/cms/svg-badge.svg)](https://hosted.weblate.org/engage/cms/)

[🌍 Help translate CMS in your language using Weblate!](https://hosted.weblate.org/engage/cms/)

Introduction
------------

CMS, or Contest Management System, is a distributed system for running
and (to some extent) organizing a programming contest.

CMS has been designed to be general and to handle many different types
of contests, tasks, scorings, etc. Nonetheless, CMS has been
explicitly build to be used in the 2012 International Olympiad in
Informatics, held in September 2012 in Italy.


Download
--------

**For end-users it's best to download the latest stable version of CMS,
which can be found already packaged at <http://cms-dev.github.io/>.**

This git repository, which contains the development version in its
main branch, is intended for developers and everyone interested in
contributing or just curious to see how the code works and wanting to
hack on it.

>>>>>>> upstream/main

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
