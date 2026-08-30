import path from 'path';

export const getRepoRoot = (): string =>
  process.env.IS_DOCKER === 'true' ? '/repo-root' : path.resolve(process.cwd(), '..');
