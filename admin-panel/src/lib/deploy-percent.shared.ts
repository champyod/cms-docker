export type DeployStatus = 'running' | 'completed' | 'failed' | 'not_found' | 'timeout';

export { DEPLOY_IDLE_TIMEOUT_MS } from '@/lib/constants/deploy';

export function parseDeployPercent(log: string): number | null {
  if (!log) return null;
  const matches = log.match(/(\d{1,3})%/g);
  if (!matches || matches.length === 0) return null;
  let maximum = 0;
  for (const match of matches) {
    const value = parseInt(match.replace('%', ''), 10);
    if (!Number.isNaN(value) && value >= 0 && value <= 100 && value > maximum) maximum = value;
  }
  return maximum > 0 ? maximum : null;
}
