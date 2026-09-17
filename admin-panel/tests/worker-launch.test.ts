import { describe, expect, it } from 'vitest';
import { buildRestartCommand } from '../src/lib/restart-planner';
import { buildComposeCommand, buildWorkerControlCommand } from '../src/lib/compose-command';
import { readFileSync } from 'node:fs';

const files = '-f docker-compose.core.yml -f docker-compose.admin.yml -f docker-compose.contest.yml -f docker-compose.monitor.yml';

describe('fleet worker restart commands', () => {
  it('restarts existing fleet containers without compose recreation', async (): Promise<void> => {
    expect(await buildRestartCommand('worker', undefined, files)).toEqual({
      skip: false,
      command: 'bash scripts/__admin_worker_control.sh restart',
    });
  });

  it('keeps fleet workers separate from the all-services compose project', async (): Promise<void> => {
    expect(await buildRestartCommand('all', undefined, files)).toEqual({
      skip: false,
      command: `bash scripts/__admin_worker_control.sh restart && docker compose ${files} up -d --build`,
    });
  });
});
