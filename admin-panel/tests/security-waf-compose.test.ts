import { describe, expect, it } from 'vitest';

import {
  WAF_COMPOSE_FILE,
  WAF_DOMAIN_COMPOSE_FILE,
  WAF_SERVICE,
  buildWafRecreateCommand,
  buildWafRestartCommand,
} from '@/lib/security/waf-compose';

const FILES = '-f docker-compose.yml';

describe('buildWafRecreateCommand', () => {
  it('mirrors the make waf file and profile set, scoped to the one service', () => {
    const command = buildWafRecreateCommand(FILES, 'img', null);

    expect(command).toContain(`-f ${WAF_DOMAIN_COMPOSE_FILE}`);
    expect(command).toContain(`-f ${WAF_COMPOSE_FILE}`);
    expect(command).toContain('--profile core');
    expect(command).toContain('--profile waf');
    expect(command).toContain('--no-build');
    expect(command).toContain(`--force-recreate ${WAF_SERVICE}`);
    expect(command).toContain(`pull ${WAF_SERVICE} || true`);
    expect(command).not.toContain('--profile contest');
  });

  it('builds from source without pulling when the deployment mode is src', () => {
    const command = buildWafRecreateCommand(FILES, 'src', null);

    expect(command).toContain('--build');
    expect(command).not.toContain('pull');
    expect(command).not.toContain('--no-build');
  });

  it('carries the host project directory when the panel runs in its own container', () => {
    const command = buildWafRecreateCommand(FILES, 'img', {
      projectDirectory: '/host/repo',
      envFile: '/host/repo/.env',
    });

    expect(command).toContain("--project-directory '/host/repo'");
  });
});

describe('buildWafRestartCommand', () => {
  it('restarts the waf container by name', () => {
    expect(buildWafRestartCommand()).toBe(`docker restart ${WAF_SERVICE}`);
  });
});
