export type ComposeAction = 'up' | 'down' | 'restart' | 'build';
export type ComposeService = 'core' | 'admin' | 'contest' | 'worker';

export function buildWorkerControlCommand(action: 'start' | 'stop' | 'restart', shards: string[] = []): string {
  if (!shards.every(shard => /^\d+$/.test(shard))) {
    throw new Error('Invalid worker shard');
  }
  return ['bash scripts/__admin_worker_control.sh', action, ...shards].join(' ');
}

export function buildComposeCommand(action: ComposeAction, serviceType?: ComposeService): string {
  if (!['up', 'down', 'restart', 'build'].includes(action) ||
      (serviceType !== undefined && !['core', 'admin', 'contest', 'worker'].includes(serviceType))) {
    throw new Error('Invalid compose action or service');
  }
  const includesWorkers = serviceType === undefined || serviceType === 'worker';
  // The panel's repository mount is not a host path. Keep existing fleet mounts
  // and ownership rather than recreating workers from a foreign compose project.
  if (includesWorkers && action === 'build') {
    throw new Error('Build workers with make worker on the host; the panel can only start, stop, or restart existing fleet containers.');
  }
  const workerCommand = buildWorkerControlCommand(action === 'up' ? 'start' : action === 'down' ? 'stop' : 'restart');
  if (serviceType === 'worker') return workerCommand;

  const services = serviceType === undefined ? ['core', 'admin', 'contest'] : [serviceType];
  const files = services.map(service => `-f docker-compose.${service}.yml`).join(' ');
  const suffix = action === 'up' ? ' -d' : action === 'build' ? ' --no-cache' : '';
  const composeCommand = `docker compose ${files} ${action}${suffix}`;
  return includesWorkers ? `${workerCommand} && ${composeCommand}` : composeCommand;
}
