'use server';

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import { ensurePermission } from '@/lib/permissions';
import { getRepoRoot } from '@/lib/repo-root';
import { logToDiscord } from '@/lib/discord-notifier';
import { recordAudit } from '@/lib/audit';

const execPromise = util.promisify(exec);

/**
 * The submissions-backup actions, kept apart from the service and deploy ones: they gate on the
 * `backup:*` keys rather than `service:*`, and they touch the backup directory instead of the
 * compose stack. A backup is also the one service action that leaves the box rather than
 * reconfiguring it, which is why it announces itself to Discord before it starts.
 */

export async function triggerManualBackup() {
    // Strict own key: no fallback to maintenance:enable. Re-seed
    // (prisma-sync) grants backup:create to Storage Admin and Superadmin.
    await ensurePermission('backup:create');
    try {
        const rootDir = getRepoRoot();
        await logToDiscord('Manual Backup', 'Admin triggered a manual submissions backup.', 3447003);
        const cmd = 'docker exec -d cms-monitor bash /usr/local/bin/cms-backup.sh';
        await execPromise(cmd, { cwd: rootDir });
        await recordAudit({
          verb: 'backup:create',
          entity: 'service',
          afterValues: { action: 'backup' },
          result: 'success',
        });
        return { success: true, message: 'Backup process started in background.' };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

export interface BackupArchive {
  name: string;
  sizeBytes: number;
  modifiedIso: string;
}

const MAX_ARCHIVES = 200;

// Strict own key. Names come from the filesystem and are display-only;
// no archive is ever executed or interpolated into a shell command here.
export async function listBackups(): Promise<{ success: boolean; archives?: BackupArchive[]; error?: string }> {
    await ensurePermission('backup:list');
    const dir = process.env.BACKUP_DIR ?? path.join(getRepoRoot(), 'backups');
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return { success: true, archives: [] };
    }
    const archives: BackupArchive[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!/^[A-Za-z0-9._-]+\.(tar\.gz|tgz|sql|sql\.gz|dump|gpg)$/.test(entry.name)) continue;
      try {
        const stat = await fs.stat(path.join(dir, entry.name));
        archives.push({ name: entry.name, sizeBytes: stat.size, modifiedIso: stat.mtime.toISOString() });
      } catch {
        continue;
      }
    }
    archives.sort((a, b) => (a.modifiedIso < b.modifiedIso ? 1 : -1));
    return { success: true, archives: archives.slice(0, MAX_ARCHIVES) };
}
