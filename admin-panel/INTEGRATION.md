# Admin UI Integration Guide

## Worker Management API

The Admin Panel can manage workers through environment variables that persist across `make env` regenerations.

### Available Scripts

#### 1. `scripts/manage-workers.sh`
Manages worker configuration in `.env.core`.

**Commands:**
```bash
# List all workers
./scripts/manage-workers.sh list

# Add a worker
./scripts/manage-workers.sh add <hostname> <port>
# Example: ./scripts/manage-workers.sh add "cms-worker-1" 26001

# Remove a worker by index
./scripts/manage-workers.sh remove <index>
# Example: ./scripts/manage-workers.sh remove 1

# Update an existing worker
./scripts/manage-workers.sh update <index> <hostname> <port>
# Example: ./scripts/manage-workers.sh update 0 "new-hostname" 26000
```

**Docker Execution:**
Since the Admin UI runs in Docker with `/repo-root` mounted:
```javascript
import { exec } from 'child_process';

// Add worker
exec('cd /repo-root && ./scripts/manage-workers.sh add cms-worker-1 26001', 
  (error, stdout, stderr) => {
    if (error) {
      console.error(`Error: ${error.message}`);
      return;
    }
    console.log(stdout);
  }
);
```

### Workflow for Worker Management

1. **User adds worker through UI**
   - UI calls `manage-workers.sh add <hostname> <port>`
   - This updates `.env.core` file

2. **Regenerate configuration**
   - UI shows notification: "Click 'Regenerate Config' to apply changes"
   - When clicked, UI executes: `cd /repo-root && make env`
   - This runs `scripts/inject_config.sh` which reads `WORKER_N` env vars and injects them into `cms.toml`

3. **Restart services**
   - UI prompts: "Changes applied. Restart core services?"
   - On confirm, executes:
     - For image deployment: `cd /repo-root && make core-img`
     - For source deployment: `cd /repo-root && make core`
   - Or simpler: `docker restart cms-log-service`

### Environment Variables Available

The Admin UI has access to these environment variables (see `docker-compose.admin.yml`):

```yaml
environment:
  VITE_API_URL: http://localhost:8889
  SERVER_BASE_URL: http://localhost
  PUBLIC_IP: ${PUBLIC_IP}
  DATABASE_URL: postgresql://...
  REPO_ROOT: /repo-root
  DEPLOYMENT_TYPE: img  # or 'src'
  IS_DOCKER: "true"
```

**Usage:**
- `REPO_ROOT`: Working directory for executing scripts
- `DEPLOYMENT_TYPE`: Determines whether to use `make {service}-img` or `make {service}`
- `PUBLIC_IP`: For constructing worker connection URLs
- `SERVER_BASE_URL`: Base URL for all services

### Example: Full Worker Add Flow (React/Next.js)

```typescript
// types/worker.ts
export interface Worker {
  index: number;
  hostname: string;
  port: number;
}

// actions/worker-actions.ts
'use server';

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function addWorker(hostname: string, port: number) {
  try {
    const { stdout, stderr } = await execAsync(
      `cd /repo-root && ./scripts/manage-workers.sh add "${hostname}" ${port}`
    );
    
    if (stderr) {
      throw new Error(stderr);
    }
    
    return { success: true, message: stdout };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function regenerateConfig() {
  const deploymentType = process.env.DEPLOYMENT_TYPE || 'img';
  
  try {
    // Step 1: Regenerate config
    await execAsync('cd /repo-root && make env');
    
    // Step 2: Restart services based on deployment type
    if (deploymentType === 'img') {
      await execAsync('cd /repo-root && docker compose -f docker-compose.core.yml -f docker-compose.core.img.yml up -d --no-build');
    } else {
      await execAsync('cd /repo-root && docker restart cms-log-service');
    }
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function listWorkers(): Promise<Worker[]> {
  try {
    const { stdout } = await execAsync(
      'cd /repo-root && ./scripts/manage-workers.sh list'
    );
    
    // Parse output
    const lines = stdout.split('\n').filter(line => line.startsWith('WORKER_'));
    return lines.map(line => {
      const match = line.match(/WORKER_(\d+)=(.+):(\d+)/);
      if (match) {
        return {
          index: parseInt(match[1]),
          hostname: match[2],
          port: parseInt(match[3])
        };
      }
      return null;
    }).filter(Boolean);
  } catch (error) {
    console.error('Error listing workers:', error);
    return [];
  }
}

export async function removeWorker(index: number) {
  try {
    await execAsync(
      `cd /repo-root && ./scripts/manage-workers.sh remove ${index}`
    );
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
```

### UI Component Example

```tsx
// components/WorkerManager.tsx
'use client';

import { useState } from 'react';
import { addWorker, listWorkers, regenerateConfig } from '@/actions/worker-actions';

export function WorkerManager() {
  const [hostname, setHostname] = useState('');
  const [port, setPort] = useState(26000);
  const [needsRegenerate, setNeedsRegenerate] = useState(false);

  const handleAddWorker = async () => {
    const result = await addWorker(hostname, port);
    if (result.success) {
      setNeedsRegenerate(true);
      alert('Worker added! Click "Apply Changes" to regenerate configuration.');
    } else {
      alert(`Error: ${result.error}`);
    }
  };

  const handleRegenerate = async () => {
    const result = await regenerateConfig();
    if (result.success) {
      setNeedsRegenerate(false);
      alert('Configuration regenerated and services restarted!');
    } else {
      alert(`Error: ${result.error}`);
    }
  };

  return (
    <div>
      <h2>Worker Management</h2>
      
      {needsRegenerate && (
        <div className="alert alert-warning">
          <button onClick={handleRegenerate}>
            ⚠️ Apply Changes (Regenerate Config)
          </button>
        </div>
      )}

      <div className="form">
        <input
          placeholder="Hostname"
          value={hostname}
          onChange={(e) => setHostname(e.target.value)}
        />
        <input
          type="number"
          placeholder="Port"
          value={port}
          onChange={(e) => setPort(Number(e.target.value))}
        />
        <button onClick={handleAddWorker}>Add Worker</button>
      </div>
    </div>
  );
}
```

## Testing

Test the integration locally:

```bash
# 1. Add a worker manually
./scripts/manage-workers.sh add "test-worker" 26099

# 2. Verify it's in .env.core
grep WORKER_ .env.core

# 3. Regenerate config
make env

# 4. Verify it was injected into cms.toml
grep -A 5 "^Worker = " config/cms.toml

# 5. Clean up
./scripts/manage-workers.sh remove 99
```
