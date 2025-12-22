# CMS-Docker Repository Overview

## What This Repository Does

This is a **Dockerized Contest Management System (CMS)** - an open-source platform for running programming contests (like IOI, ICPC). Based on [cms-dev/cms](https://github.com/cms-dev/cms), this fork adds Docker containerization for easier deployment.

## Main Purpose

Deploy and manage competitive programming contests with:
- Web interfaces for contestants and admins
- Automated submission evaluation
- Real-time scoring and ranking
- Support for distributed workers (including Raspberry Pi)

---

## Repository Structure

```
cms-docker/
├── .agent/                    # Agent documentation (you are here)
├── config/                    # Configuration files
│   ├── cms.toml              # Main CMS configuration (ACTIVE)
│   ├── cms.sample.toml       # Sample configuration
│   └── cms.ranking.sample.toml # Ranking service config
│
├── docker-compose.*.yml      # Docker Compose stacks
│   ├── docker-compose.core.yml    # Core services (DB, Log, Scoring, Evaluation, Proxy)
│   ├── docker-compose.admin.yml   # Admin + Ranking web servers
│   ├── docker-compose.contest.yml # Contest web server
│   └── docker-compose.worker.yml  # Worker service (for Raspberry Pi)
│
├── .env.*                    # Environment configurations
│   ├── .env                  # Global settings
│   ├── .env.core             # Core services settings
│   ├── .env.admin            # Admin/Ranking settings
│   ├── .env.contest          # Contest settings
│   └── .env.worker           # Worker settings
│
├── src/                      # CMS Python source code (submodule from cms-dev/cms)
│   ├── cms/                  # Core CMS modules
│   ├── cmsranking/           # Ranking web server
│   └── cmscontrib/           # Contribution tools
│
├── scripts/                  # CMS service scripts
│   ├── cmsAdminWebServer     # Admin web interface
│   ├── cmsContestWebServer   # Contestant web interface
│   ├── cmsRankingWebServer   # Public scoreboard
│   ├── cmsEvaluationService  # Submission evaluation
│   ├── cmsScoringService     # Score calculation
│   ├── cmsProxyService       # Sends scores to ranking
│   ├── cmsWorker             # Evaluates submissions
│   └── worker-connect.sh     # Remote worker connection helper
│
├── Dockerfile                # Build CMS Docker image
├── Makefile                  # Build automation
└── README.md                 # Public documentation
```

---

## Key Services

| Service | Port | Description |
|---------|------|-------------|
| **AdminWebServer** | 8889 | Contest administration |
| **ContestWebServer** | 8888 | Contestant interface |
| **RankingWebServer** | 8890 | Public scoreboard |
| **ProxyService** | - | Sends scores to ranking |
| **EvaluationService** | - | Manages evaluation queue |
| **ScoringService** | - | Calculates scores |
| **Worker** | 26000+ | Executes submissions in sandbox |
| **Database** | 5432 | PostgreSQL database |

---

## Configuration Flow

1. **cms.toml** - Main config defining all service addresses and settings
2. **.env.*** files - Environment variables for Docker Compose
3. **docker-compose.*.yml** - Service definitions using env vars

### Important Config Locations

| Setting | File | Description |
|---------|------|-------------|
| `CONTEST_ID` | `.env` / `.env.core` | Which contest ProxyService serves |
| `rankings` URL | `cms.toml → [proxy_service]` | RankingWebServer address |
| `hidden` flag | AdminWebServer UI | User visibility on ranking |
| Database URL | `cms.toml → [database]` | PostgreSQL connection |
| Worker list | `cms.toml → [services].Worker` | Available workers |

---

## Quick Reference

### Start Services
```bash
make core     # Core backend services
make admin    # Admin + Ranking web servers
make contest  # Contestant web server
```

### Check Status
```bash
docker ps
docker logs <service-name>
```

### Key Files to Edit
- `config/cms.toml` - Service addresses, workers, database
- `.env.*` - Environment-specific settings
- `Dockerfile` - Build customization
