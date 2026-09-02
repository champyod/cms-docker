import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const MAX_CLEANUP_SCAN_FILES = 500;
const CREDS_FILE_MAX_AGE_MS = 15 * 60 * 1000;

/** Filename prefix shared by the writer (batch/bulk routes) and reader (credentials download route). */
export const CREDS_FILE_PREFIX = 'cms-creds-';

export function randomToken(length: number): string {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

/** Removes stale credential CSVs from the temp dir; best-effort by design — failures never affect requests. */
export async function cleanupExpiredCreds(): Promise<void> {
  try {
    const dir = os.tmpdir();
    const files = await fs.readdir(dir);
    if (files.length > MAX_CLEANUP_SCAN_FILES) return;
    const now = Date.now();
    await Promise.all(
      files
        .filter((f) => f.startsWith(CREDS_FILE_PREFIX) && (f.endsWith('.csv') || f.endsWith('.csv.used')))
        .map(async (f) => {
          try {
            const full = path.join(dir, f);
            const stat = await fs.stat(full);
            if (now - stat.mtimeMs > CREDS_FILE_MAX_AGE_MS) {
              await fs.unlink(full);
            }
          } catch {
          }
        })
    );
  } catch {
  }
}

export function csvEscape(value: string): string {
  const str = String(value ?? '');
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function writeCredsCsv(content: string): Promise<{ token: string; downloadUrl: string }> {
  const token = crypto.randomBytes(24).toString('hex');
  const filePath = path.join(os.tmpdir(), `${CREDS_FILE_PREFIX}${token}.csv`);
  await fs.writeFile(filePath, content, { mode: 0o600 });
  return { token, downloadUrl: `/api/users/credentials/${token}` };
}
