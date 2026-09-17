export type DeployStatus = 'running' | 'completed' | 'failed' | 'not_found' | 'timeout';

export { DEPLOY_IDLE_TIMEOUT_MS } from '@/lib/constants/deploy';

export function parseDeployPercent(log: string): number | null {
  if (!log) return null;
  // Why the latest figure and not a running maximum: docker and apt-get emit per-step bars (a layer
  // export, a package download) whose "100%" marks that one step, not the deploy. Taking the maximum
  // over the whole accumulated log lets one such line pin the bar at 100 for the rest of the run.
  const matches = log.match(/(\d{1,3})%/g);
  if (!matches || matches.length === 0) return null;
  const latest = parseInt(matches[matches.length - 1].replace('%', ''), 10);
  // 100 is only ever real once the terminal status says so, never from an in-flight log line.
  if (Number.isNaN(latest) || latest <= 0 || latest >= 100) return null;
  return latest;
}
