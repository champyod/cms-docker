# CMS Docker Deployment

Docker-based deployment for [Contest Management System (CMS)](https://github.com/cms-dev/cms) with an enhanced Admin Panel.

## Quick Start

### 1. Setup Environment
```bash
git clone https://github.com/champyod/cms-docker.git
cd cms-docker
git submodule update --init --recursive

# Generate config files
cp .env.core.example .env.core  # Edit with your settings
make env  # Generates .env and config/cms.toml
```

### 2. Deploy (Recommended: Pre-built Images)
```bash
# Pull latest images
make pull

# Start Core services
make core-img

# Initialize Database (First time only)
docker exec -it cms-log-service cmsInitDB 

# Bootstrap First Superadmin
./scripts/bootstrap-admin.sh admin yourpassword "Root Admin"

# Start the rest of the stack
make admin-img contest-img worker-img
```

## Admin Panel Features

Access the enhanced admin panel at `http://localhost:8889`.

### 🛡️ Role-Based Access Control (RBAC)
The system supports granular permissions with predefined roles:
- **Superadmin**: Full control over infrastructure, settings, and users.
- **Committee**: Focused role for exam authors. Access to Tasks, Contests, and Messaging only.
- **Bootstrapping**: Use `./scripts/bootstrap-admin.sh` to create high-privileged accounts from CLI.

### 📦 Container Control Center
Manage your CMS stack directly from the browser:
- View status of all Docker containers.
- Start, stop, or restart services.
- **Real-time Logs**: View live container output for debugging.

### 🔧 Worker & Resource Management
No more editing `cms.toml` manually for worker nodes.
- **Manage Workers**: Add, edit, or remove worker nodes via the **Resources** page.
- **Auto-Sync**: The UI automatically updates `config/cms.toml` and notifies you when a service restart is needed.

## Configuration & Stacks

| Stack | Description | Port |
|-------|-------------|------|
| **Core** | Database, Logging, and Backend Logic | - |
| **Admin** | Management Panel & Ranking Scoreboard | 8889, 8890 |
| **Contest** | Contestant Interface | 8888 |
| **Worker** | Judging Service | - |

## Commands Reference

```bash
# Deployment
make core-img    # Start/Update Core
make admin-img   # Start/Update Admin
make pull        # Pull all images

# Management
./scripts/bootstrap-admin.sh <user> <pass>  # Create full admin

# Development
make core        # Build from source
make admin
```

## Troubleshooting

- **Login Failed (Unexpected Error)**: Your database schema is likely out of sync. Run:
  `docker exec -it cms-admin-panel npx prisma db push`
- **Blank Sidebar**: Your account has no permissions. Create a Superadmin via the bootstrap script.
- **Worker "Compiling" Forever**: Connection issue. Check the **Containers** status in the Admin Panel.
- **Config Not Applying**: Delete `config/cms.toml` and run `make env` again.

## Requirements
- Docker 20.10+ & Compose v2
- 2+ CPU, 4GB+ RAM (Recommended)

## License
AGPL-3.0 (same as CMS)
