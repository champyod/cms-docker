'use server';

import fs from 'fs/promises';
import path from 'path';
import { ensurePermission } from '@/lib/permissions';

export async function readEnvFile(filename: string) {
  await ensurePermission('all');
  try {
    const repoRoot = process.env.IS_DOCKER === 'true' ? '/repo-root' : path.resolve(process.cwd(), '..');
    const envPath = path.join(repoRoot, filename);
    const content = await fs.readFile(envPath, 'utf-8');
    
    // Parse into key-value pairs
    const lines = content.split('\n');
    const config: Record<string, string> = {};
    
    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const [key, ...values] = trimmed.split('=');
        config[key.trim()] = values.join('=').trim();
      }
    });

    return { success: true, content, config };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function updateEnvFile(filename: string, updates: Record<string, string>) {
  await ensurePermission('all');
  try {
    const repoRoot = process.env.IS_DOCKER === 'true' ? '/repo-root' : path.resolve(process.cwd(), '..');
    const envPath = path.join(repoRoot, filename);
    let content = await fs.readFile(envPath, 'utf-8');
    
    // Update or append
    Object.entries(updates).forEach(([key, value]) => {
      const regex = new RegExp(`^${key}=.*`, 'm');
      if (regex.test(content)) {
        content = content.replace(regex, `${key}=${value}`);
      } else {
        content += `\n${key}=${value}`;
      }
    });

    await fs.writeFile(envPath, content);
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
