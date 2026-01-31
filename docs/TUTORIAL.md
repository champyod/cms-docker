# CMS Docker - Getting Started Tutorial

This tutorial will guide you through setting up and running your first programming contest using CMS Docker.

## Prerequisites

- Docker and Docker Compose installed
- Basic understanding of programming contests
- Git installed

## Step 1: Initial Setup (5 minutes)

### Clone and Configure

```bash
# Clone the repository
git clone https://github.com/champyod/cms-docker.git
cd cms-docker
git submodule update --init --recursive

# Run the interactive configuration tool
./scripts/configure-env.sh
```

The configuration script will guide you through setting up credentials, public IPs, and security keys. You can press Enter to use defaults or choose to generate random secure passwords.

## Step 2: Deploy Services (5 minutes)

Run the automated setup script:

```bash
./setup.sh
```

1.  **Select Strategy**: Choose `1) PRE-BUILT IMAGES` for the fastest setup.
2.  **Confirm IP**: Verify the detected public IP address.
3.  **Deploy**: The script will automatically deploy the core services, initialize the database, apply schema patches, and start the Admin Panel and Contest interfaces.
4.  **Create Admin**: When prompted, create your first superadmin account.

## Step 3: Access the System

Open your browser:

- **Modern Admin Panel**: http://your-ip:8891 (Login with your admin account)
- **Contest Interface**: http://your-ip:8888
- **Scoreboard**: http://your-ip:8890

## Step 4: Create Your First Contest

### Using Modern Admin Panel (Port 8891)

1. Navigate to http://your-ip:8891
2. Click **"Contest"** → **"Contests"** in the sidebar.
3. Click **"Create New Contest"**
4. Fill in:
   - **Name**: "Practice Contest 2024"
   - **Description**: "A practice contest for beginners"
   - **Start/Stop Time**: Choose dates.
   - **Token Settings**: Use the **Tokens** tab to configure periodic credits.
5. Click **"Create Contest"**

### Manage Deployments

To make your contest live:
1. Navigate to **"Infrastructure"** → **"Deployments"**.
2. Ensure your contest ID is mapped to a port (e.g., ID 1 on port 8888).
3. Click **"Save & Restart Stack"**.


### Using Classic Admin Panel (Port 8889)

1. Navigate to http://your-ip:8889
2. Login with your admin credentials
3. Click **"Add Contest"**
4. Fill in the contest details
5. Submit

### Using Batch Creation Script

Create multiple contests at once:

```bash
# Create a contest definition file
./scripts/create-contests.sh --batch contests.yaml
```

See "Batch Contest Creation" section below for details.

## Step 5: Add a Programming Task

### Create Task Structure

```bash
# Create task directory
mkdir -p tasks/hello_world
cd tasks/hello_world
```

### Create Task Files

**`task.yaml`** (Task Configuration):
```yaml
name: Hello World
title: Hello World
time_limit: 1.0
memory_limit: 256
task_type: Batch

primary_language: en

statements:
  en:
    statement: |
      # Hello World
      
      Write a program that reads a name and prints "Hello, [name]!"
      
      ## Input
      A single line containing a name (string, max 100 characters).
      
      ## Output
      Print "Hello, " followed by the name and "!".

testcases:
  - input: "Alice"
    output: "Hello, Alice!"
  - input: "Bob"
    output: "Hello, Bob!"
```

**`gen/generator.py`** (Test Case Generator):
```python
#!/usr/bin/env python3
import random
import sys

def generate_testcase(seed):
    random.seed(seed)
    names = ["Alice", "Bob", "Charlie", "Diana", "Eve"]
    name = random.choice(names)
    return name, f"Hello, {name}!"

if __name__ == "__main__":
    seed = int(sys.argv[1])
    input_data, output_data = generate_testcase(seed)
    print(input_data)  # This goes to stdin
    with open("output.txt", "w") as f:
        f.write(output_data)
```

**`sol/solution.cpp`** (Reference Solution):
```cpp
#include <iostream>
#include <string>
using namespace std;

int main() {
    string name;
    getline(cin, name);
    cout << "Hello, " << name << "!" << endl;
    return 0;
}
```

### Import Task Using Script

```bash
# Use the import script
./scripts/import-task.sh hello_world "Practice Contest 2024"
```

Or manually through Admin Panel:
1. Go to Admin Panel → Tasks → Add Task
2. Fill in task details
3. Upload test cases
4. Attach to contest

## Step 6: Add Participants

### Create User Accounts

**Via Admin Panel:**
1. Admin Panel → Users → Add User
2. Fill in username and password
3. Add to contest

**Via Batch Script:**
```bash
./scripts/create-users.sh --batch users.csv
```

`users.csv`:
```csv
username,password,first_name,last_name,email
alice,alice123,Alice,Smith,alice@example.com
bob,bob123,Bob,Jones,bob@example.com
```

## Step 7: Test the Contest

### As a Contestant

1. Navigate to http://your-ip:8888
2. Login with a contestant account (e.g., alice/alice123)
3. Select "Practice Contest 2024"
4. Click on "Hello World" task
5. Submit a solution:

```cpp
#include <iostream>
#include <string>
using namespace std;

int main() {
    string name;
    cin >> name;
    cout << "Hello, " << name << "!" << endl;
    return 0;
}
```

6. Wait for evaluation
7. Check score on scoreboard

## Step 8: Monitor and Manage

### View Logs

```bash
# View all logs
docker logs cms-log-service -f

# View worker logs
docker logs cms-worker-0 -f

# View contest server logs
docker logs cms-contest-web-server-1 -f
```

### Check Service Status

```bash
docker ps
```

### Restart Services

```bash
# Restart specific service
docker restart cms-contest-web-server-1

# Restart all core services
make core-img

# Restart everything
docker compose down
make pull
make core-img admin-img contest-img worker-img
```

## Common Tasks

### Add More Workers

```bash
# Edit .env.core
nano .env.core

# Add workers
WORKER_1=cms-worker-1:26001
WORKER_2=192.168.1.50:26000

# Regenerate configuration
make env

# Restart core services
make core-img
```

### Backup Database

```bash
docker exec cms-database pg_dump -U cmsuser cmsdb > backup.sql
```

### Restore Database

```bash
cat backup.sql | docker exec -i cms-database psql -U cmsuser cmsdb
```

### Scale Workers

```bash
# Add more worker containers
docker compose -f docker-compose.worker.yml up -d --scale worker=3
```

## Troubleshooting

### Worker Not Connecting

**Problem:** Worker shows "Not connected" in logs

**Solution:**
1. Check worker configuration in `cms.toml`:
   ```bash
   grep -A 10 "Worker =" config/cms.toml
   ```
2. Verify worker is listed and accessible
3. Restart log service:
   ```bash
   docker restart cms-log-service
   ```

### Submissions Stuck in "Compiling"

**Problem:** Submissions never finish evaluation

**Solution:**
1. Check worker logs:
   ```bash
   docker logs cms-worker-0 -f
   ```
2. Restart worker:
   ```bash
   docker restart cms-worker-0
   ```
3. Verify sandbox is working:
   ```bash
   docker exec cms-worker-0 isolate --version
   ```

### Database Connection Errors

**Problem:** Services can't connect to database

**Solution:**
1. Check database is running:
   ```bash
   docker ps | grep database
   ```
2. Verify password in `.env.core` matches database
3. If needed, reset database:
   ```bash
   make db-clean
   make core-img
   make cms-init
   ```

### Port Already in Use

**Problem:** "port is already allocated"

**Solution:**
1. Edit `.env.core` to change ports:
   ```ini
   POSTGRES_PORT_EXTERNAL=5433  # Instead of 5432
   ```
2. Regenerate and restart:
   ```bash
   make env
   make core-img
   ```

## Next Steps

- **Read the full documentation**: [README.md](../README.md)
- **Join the CMS community**: [CMS GitHub](https://github.com/cms-dev/cms)
- **Explore advanced features**: Worker distribution, custom graders, special tasks

## Quick Reference

```bash
# Daily Operations
make env              # Regenerate configuration
make core-img         # Start/restart core services
make admin-img        # Start/restart admin panel
make contest-img      # Start/restart contest interface
make worker-img       # Start/restart workers

# Maintenance
make pull             # Pull latest images
make db-clean         # Full reset (DELETES DATA!)
make cms-init         # Initialize database

# Monitoring
docker ps             # List running containers
docker logs <name>    # View logs
make infra-img        # Start monitoring (Discord alerts)

# Service Control
make {service}-stop   # Stop service
make {service}-clean  # Stop and remove volumes
```

## Support

- **Issues**: https://github.com/champyod/cms-docker/issues
- **CMS Documentation**: https://cms.readthedocs.io/
- **CMS Forum**: https://github.com/cms-dev/cms/discussions

---

**Congratulations!** You now have a fully functional CMS deployment. Happy contest hosting! 🎉
