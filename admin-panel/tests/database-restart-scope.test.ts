import { describe, expect, it } from 'vitest';

import { buildRestartCommand } from '@/lib/restart-planner';

const FILES = '-f docker-compose.yml';

// The list analyzeRestartRequirements hands the planner for a database-key change on a real
// deployment: the policy's dependency graph pulls in the contest web server, which is what used to
// send the planner down its contest-stack branch and drop the admin panel from the restart.
const DB_CHANGE_LIST = [
  'cms-database',
  'cms-admin-panel-next',
  'cms-log-service',
  'cms-resource-service',
  'cms-scoring-service',
  'cms-evaluation-service',
  'cms-proxy-service',
  'cms-checker-service',
  'cms-worker',
  'cms-contest-web-server',
  'cms-nginx-contest',
];

describe('a database change recreates the admin panel too', () => {
  it('keeps the panel off a stale DATABASE_URL when the plan also touches the contest stack', async () => {
    const plan = await buildRestartCommand('custom', DB_CHANGE_LIST, FILES, 'img', null);

    expect(plan.skip).toBe(false);
    const command = plan.skip ? '' : plan.command;
    expect(command).toContain('admin-panel-next');
    expect(command).toContain('contest-web-server');
  });

  it('still leaves the admin stack alone for a contest-only change', async () => {
    const plan = await buildRestartCommand('custom', ['contest-stack'], FILES, 'img', null);

    expect(plan.skip).toBe(false);
    const command = plan.skip ? '' : plan.command;
    expect(command).not.toContain('admin-panel-next');
  });
});
