# CMS Docker Quick Reference Card

## Initial Setup
```bash
git clone https://github.com/champyod/cms-docker.git
cd cms-docker
git submodule update --init --recursive
cp .env.*.example .env.*
make env
```

## Daily Operations

### Start Services
```bash
make pull              # Pull latest images
make core-img          # Start core services
make admin-img         # Start admin panel
make contest-img       # Start contest interface
make worker-img        # Start workers
make infra-img         # Start monitoring
```

### Stop Services
```bash
make core-stop         # Stop core
make admin-stop        # Stop admin
make contest-stop      # Stop contest
make infra-stop        # Stop monitoring
```

### Database Operations
```bash
make cms-init          # Initialize database
make admin-create      # Create admin account
make db-clean          # FULL RESET (deletes all data!)
```

## Service URLs
- **Modern Admin**: http://localhost:8891
- **Classic Admin**: http://localhost:8889
- **Contest**: http://localhost:8888
- **Scoreboard**: http://localhost:8890

## Worker Management
```bash
# Add worker to .env.core
echo "WORKER_1=hostname:26001" >> .env.core

# Regenerate config
make env

# Restart services
make core-img

# Helper script
./scripts/manage-workers.sh add "hostname" 26001
./scripts/manage-workers.sh list
./scripts/manage-workers.sh remove 1
```

## Batch Contest Creation
```bash
# Create multiple contests
./scripts/create-contests.sh -f examples/contests.yaml

# Preview without creating
./scripts/create-contests.sh -f contests.yaml --dry-run
```

## Monitoring & Logs
```bash
# View logs
docker logs cms-log-service -f
docker logs cms-worker-0 -f
docker logs cms-contest-web-server-1 -f

# Check status
docker ps
docker compose ps

# Restart specific service
docker restart cms-log-service
```

## Troubleshooting

### Worker Not Connecting
```bash
docker logs cms-worker-0 -f
docker restart cms-worker-0
grep -A 10 "Worker =" config/cms.toml
```

### Database Issues
```bash
# Check database
docker logs cms-database -f

# Reset database (WARNING: Deletes all data!)
make db-clean
make core-img
make cms-init
```

### Port Conflicts
Edit `.env.core`:
```ini
POSTGRES_PORT_EXTERNAL=5433  # Change from 5432
```
Then: `make env && make core-img`

### Submissions Stuck
```bash
# Check worker
docker logs cms-worker-0 -f

# Restart worker
docker restart cms-worker-0

# Check sandbox
docker exec cms-worker-0 isolate --version
```

## Backup & Restore

### Backup
```bash
# Database
docker exec cms-database pg_dump -U cmsuser cmsdb > backup.sql

# Configuration
tar -czf config-backup.tar.gz .env* config/
```

### Restore
```bash
# Database
cat backup.sql | docker exec -i cms-database psql -U cmsuser cmsdb

# Configuration
tar -xzf config-backup.tar.gz
make env
```

## Configuration Files

- `.env.core` - **Main config** (DB, IP, Workers)
- `.env.admin` - Admin panel settings
- `.env.contest` - Contest interface settings  
- `.env.worker` - Worker resource limits
- `.env.infra` - Monitoring settings
- `config/cms.toml` - Generated CMS config
- `config/cms_ranking.toml` - Ranking config

## Important Commands

```bash
make env               # Regenerate all configs
make pull              # Update all images
make db-clean          # Full reset
make cms-init          # Init database
make admin-create      # Create admin
docker ps              # List containers
docker logs <name>     # View logs
docker restart <name>  # Restart container
```

## Emergency Recovery

1. **Full Reset**:
   ```bash
   make db-clean
   make pull
   make core-img
   sleep 10
   make cms-init
   make admin-create
   make admin-img contest-img worker-img
   ```

2. **Config Corruption**:
   ```bash
   rm config/cms.toml config/cms_ranking.toml
   make env
   docker restart cms-log-service
   ```

3. **Service Won't Start**:
   ```bash
   docker compose down
   docker system prune -f
   make core-img
   ```

## Documentation

- **Tutorial**: [TUTORIAL.md](TUTORIAL.md)
- **Full README**: [README.md](README.md)
- **Admin UI Integration**: [admin-panel/INTEGRATION.md](admin-panel/INTEGRATION.md)
- **CMS Docs**: https://cms.readthedocs.io/

## Support

- GitHub Issues: https://github.com/champyod/cms-docker/issues
- CMS Forum: https://github.com/cms-dev/cms/discussions
