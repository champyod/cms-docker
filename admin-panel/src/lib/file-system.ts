import fs from 'fs/promises';

/** Whether a path exists, folding every access refusal into a plain no. */
export async function fileExists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(
    () => true,
    () => false,
  );
}
