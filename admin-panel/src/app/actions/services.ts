'use server';

import fs from 'fs/promises';
import path from 'path';
import { revalidatePath } from 'next/cache';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

const getRepoRoot = () => process.env.IS_DOCKER === 'true' ? '/repo-root' : path.resolve(process.cwd(), '..');

export async function switchContest(contestId: number) {
  try {
    // Verify path existence
    const repoRoot = getRepoRoot();
    let envPath = path.join(repoRoot, '.env.contest');
    try {
      await fs.access(envPath);
    } catch {
      // Fallback: try current directory or other typical locations
      const altPath = path.resolve(process.cwd(), '.env.contest');
      try {
        await fs.access(altPath);
        envPath = altPath;
      } catch {
        // Try one level up if in .next/server or similar
        const upUpPath = path.resolve(process.cwd(), '../../.env.contest');
        try {
          await fs.access(upUpPath);
          envPath = upUpPath;
        } catch {
          console.error('Could not find .env.contest in', process.cwd(), 'or parents');
          // Keep default and let readFile fail with precise error
        }
      }
    }

    let content = '';
    try {
      content = await fs.readFile(envPath, 'utf-8');
    } catch (e) {
      console.error(`Failed to read .env.contest at ${envPath}`, e);
      return { success: false, error: 'Could not read configuration file at ' + envPath };
    }

    const newContent = content.replace(/^CONTEST_ID=\d+/m, `CONTEST_ID=${contestId}`);

    if (content === newContent && !content.includes('CONTEST_ID=')) {
        await fs.writeFile(envPath, content + `\nCONTEST_ID=${contestId}\n`);
    } else {
        await fs.writeFile(envPath, newContent);
    }

    const rootDir = path.resolve(process.cwd(), '..');
    const cmd = `docker compose -f docker-compose.contest.yml up -d --build`;
    
    console.log(`Executing: ${cmd} in ${rootDir}`);
    const { stdout, stderr } = await execPromise(cmd, { cwd: rootDir });
    console.log('Docker output:', stdout);
    if (stderr) console.error('Docker stderr:', stderr);

    revalidatePath('/[locale]/contests');
    return { success: true, message: 'Contest switched and services restarting...' };
  } catch (error) {
    const e = error as Error;
    console.error('Switch contest error:', e);
    return { success: false, error: e.message };
  }
}

export async function restartServices(type: 'all' | 'core' | 'worker' = 'all') {
  try {
    const rootDir = getRepoRoot();
    let cmd = '';

    // Using docker compose directly as Makefile might be complex or missing specific targets
    if (type === 'core') {
      cmd = 'docker compose -f docker-compose.core.yml up -d --build';
    } else if (type === 'worker') {
      cmd = 'docker compose -f docker-compose.worker.yml up -d --build';
    } else {
      // All basic services
      cmd = 'docker compose -f docker-compose.core.yml -f docker-compose.contest.yml -f docker-compose.worker.yml up -d --build';
    }

    console.log(`Restarting services (${type}): ${cmd}`);
    const { stdout, stderr } = await execPromise(cmd, { cwd: rootDir });
    console.log('Restart output:', stdout);

    return { success: true, message: `Services (${type}) restarted.` };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function getServiceStatus() {
    return { status: 'ok' };
}
