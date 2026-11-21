import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

/** Whether a path exists, folding every access refusal into a plain no. */
export async function fileExists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(
    () => true,
    () => false,
  );
}

/**
 * Writes a file so a reader never sees a partial one and a failure never removes the file it
 * replaces: the bytes land in a sibling temp file that is renamed into place. The mode is set
 * on the temp file before the rename, so the visible file is never briefly world-readable.
 *
 * WHY: the upload surface used to delete the current asset before writing the new one, so a
 * refused write destroyed the asset it was replacing and reported the unlink it never needed.
 */
export async function writeFileAtomic(filePath: string, data: Buffer, mode: number): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, data);
    await fs.chmod(temporary, mode);
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw nameTargetFile(error, filePath);
  }
}

/** WHY the path is rewritten: the errno names the temp file, and the operator only knows the target. */
function nameTargetFile(error: unknown, filePath: string): unknown {
  return error instanceof Error && 'path' in error
    ? Object.assign(error, { path: filePath })
    : error;
}
