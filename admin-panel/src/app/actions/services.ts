'use server';

import fs from 'fs/promises';
import path from 'path';
import { revalidatePath } from 'next/cache';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

export async function switchContest(contestId: number) {
  try {
    // 1. Update .env.contest
    const envPath = path.join(process.cwd(), '../.env.contest');
    
    // Check if file exists, if not maybe we are in a container and path is different?
    // User said "admin-panel" is the CWD for nextjs. Root is ../.
    
    // We'll try to read it first. configuration file might be .env.contest
    let content = '';
    try {
      content = await fs.readFile(envPath, 'utf-8');
    } catch (e) {
      // If we can't read it, maybe we can't write it either.
      console.error('Failed to read .env.contest', e);
      return { success: false, error: 'Could not read configuration file' };
    }

    // Replace CONTEST_ID
    const newContent = content.replace(/^CONTEST_ID=\d+/m, `CONTEST_ID=${contestId}`);
    
    // If no match found, append it?
    if (content === newContent && !content.includes('CONTEST_ID=')) {
        // Append
        await fs.writeFile(envPath, content + `\nCONTEST_ID=${contestId}\n`);
    } else {
        await fs.writeFile(envPath, newContent);
    }

    // 2. Restart Services
    // We execute docker compose restart. 
    // This assumes the admin panel container has docker socket mounted or permissions, 
    // OR we are running on host.
    
    // Command from Makefile: docker compose -f docker-compose.contest.yml up -d --build
    // We'll run the same, relative to root.
    
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

export async function getServiceStatus() {
    // Mock status for now, or check docker ps if possible
    return { status: 'ok' };
}
