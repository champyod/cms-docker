import fs from 'fs/promises';

/**
 * A configuration file's content, or why it could not be read.
 *
 * WHY "absent" and "unreadable" are separate outcomes: a caller that folds a permission
 * refusal into "absent" renders a configuration problem as an empty setting, which is how
 * an unreadable .env came to look like a fleet with no workers rather than a read fault.
 */
export type ConfigFileRead =
  | { readonly kind: 'ok'; readonly content: string }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly reason: string };

/** Reads a configuration file, naming the path and errno when it exists but cannot be read. */
export async function readConfigFile(filePath: string): Promise<ConfigFileRead> {
  try {
    return { kind: 'ok', content: await fs.readFile(filePath, 'utf8') };
  } catch (error) {
    if (hasErrno(error, 'ENOENT') || hasErrno(error, 'ENOTDIR')) return { kind: 'absent' };
    return { kind: 'unreadable', reason: describeRefusal(error, filePath) };
  }
}

function hasErrno(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

function describeRefusal(error: unknown, filePath: string): string {
  const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
  return `${code ?? 'unreadable'}: ${filePath}`;
}
