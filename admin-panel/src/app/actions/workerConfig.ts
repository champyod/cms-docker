'use server';

import fs from 'fs/promises';
import path from 'path';

// Helper to find cms.toml
async function getCmsConfigPath() {
  const repoRoot = process.env.IS_DOCKER === 'true' ? '/repo-root' : path.resolve(process.cwd(), '..');
  const possiblePaths = [
    path.join(repoRoot, 'config/cms.toml'),
    path.join(process.cwd(), 'config', 'cms.toml'),
    '/usr/local/etc/cms.toml'
  ];

  for (const p of possiblePaths) {
    try {
      await fs.access(p);
      return p;
    } catch {}
  }
  return null;
}

export async function getWorkers() {
  const configPath = await getCmsConfigPath();
  if (!configPath) return [];

  try {
    const content = await fs.readFile(configPath, 'utf-8');
    // Regex to find Worker = [...] pattern
    // Handling multi-line arrays
    const workerMatch = content.match(/Worker\s*=\s*\[([\s\S]*?)\]/);
    
    if (workerMatch && workerMatch[1]) {
      const inner = workerMatch[1];
      // inner looks like:
      // ["host", port],
      // ["host2", port2]
      
      const workers: { host: string; port: number }[] = [];
      const lines = inner.split('\n');
      for (const line of lines) {
        // Match ["host", port]
        const match = line.match(/\[\s*"([^"]+)"\s*,\s*(\d+)\s*\]/);
        if (match) {
          workers.push({ host: match[1], port: parseInt(match[2]) });
        }
      }
      return workers;
    }
  } catch (error) {
    console.error('Failed to parse workers from cms.toml', error);
  }
  return [];
}

export async function updateWorkers(workers: { host: string; port: number }[]) {
  const configPath = await getCmsConfigPath();
  if (!configPath) return { success: false, error: 'cms.toml not found' };

  try {
    let content = await fs.readFile(configPath, 'utf-8');
    
    // Construct new Worker array string
    const workerString = 'Worker = [\n' + workers.map(w => `    ["${w.host}", ${w.port}],`).join('\n') + '\n]';
    
    // Replace existing block
    // We assume 'Worker = [...]' exists.
    if (/Worker\s*=\s*\[[\s\S]*?\]/.test(content)) {
        content = content.replace(/Worker\s*=\s*\[[\s\S]*?\]/, workerString);
    } else {
        // Append if not found? Or insert in [core]?
        // If not found, it's safer to append to top or after known keys, but let's assume it exists as we verified.
        return { success: false, error: 'Worker configuration block not found in cms.toml' };
    }
    
    await fs.writeFile(configPath, content);
    return { success: true };
  } catch (error) {
    console.error('Failed to update workers', error);
    return { success: false, error: 'Failed to write cms.toml' };
  }
}
