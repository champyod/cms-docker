import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoLeak, loadAuditedActions, verbOfSingleRow } from './audit-payload-harness';

/**
 * Every sensitive read in the panel writes one row, and that row may name keys, ids, counts and
 * states but never the values it read. These tests drive the real actions against canary secrets:
 * a payload that grows a value field fails here on the string it grew, before it reaches the table.
 */

describe('audited read rows carry names, ids, counts and flags only', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('records the env file read as keys, not values', async () => {
    const { entries } = await loadAuditedActions();
    const { readEnvFile } = await import('@/app/actions/env');

    const verb = await verbOfSingleRow(() => readEnvFile('.env'), entries);

    expect(verb).toBe('env:view');
    expect(entries[0].afterValues).toEqual({
      filename: '.env',
      requestedKeys: ['DISCORD_WEBHOOK_URL', 'POSTGRES_PASSWORD'],
    });
  });

  it('records the config.toml read as the sections asked for', async () => {
    const { entries } = await loadAuditedActions();
    const { readConfigTomlValues } = await import('@/app/actions/configTomlActions');

    const verb = await verbOfSingleRow(
      () => readConfigTomlValues([{ section: 'core', key: 'POSTGRES_PASSWORD' }]),
      entries,
    );

    expect(verb).toBe('config:view');
    expect(entries[0].afterValues).toEqual({ file: 'config.toml', requestedKeys: ['core.POSTGRES_PASSWORD'] });
  });

  it('records the container config read as container ids', async () => {
    const { entries } = await loadAuditedActions();
    const { getContainerConfig } = await import('@/app/actions/containerConfig');

    const verb = await verbOfSingleRow(() => getContainerConfig(), entries);

    expect(verb).toBe('container:view');
    expect(entries[0].afterValues).toEqual({ containerIds: ['abc123'] });
  });

  it('records the container log read without the log text', async () => {
    const { entries } = await loadAuditedActions();
    const { getContainerLogs } = await import('@/app/actions/docker');

    const verb = await verbOfSingleRow(() => getContainerLogs('abc123', 50), entries);

    expect(verb).toBe('container:view');
    expect(entries[0].entityId).toBe('abc123');
    expect(entries[0].afterValues).toEqual({ containerId: 'abc123', tail: 50 });
  });

  it('records the deploy operation read as ids only', async () => {
    const { entries } = await loadAuditedActions();
    const { getActiveDeployOperation } = await import('@/app/actions/deployActions');

    const verb = await verbOfSingleRow(() => getActiveDeployOperation(), entries);

    expect(verb).toBe('deployment:view');
    expect(entries[0].afterValues).toEqual({ operationId: 'op-1', contestId: 7 });
  });

  it('records the worker read as a count, never the host or port', async () => {
    const { entries } = await loadAuditedActions();
    const { getWorkers } = await import('@/app/actions/workerConfig');

    const verb = await verbOfSingleRow(() => getWorkers(), entries);

    expect(verb).toBe('worker_config:view');
    expect(entries[0].afterValues).toEqual({ count: 1 });
  });

  it('records the test alert without the webhook url', async () => {
    const { entries } = await loadAuditedActions();
    const { sendTestDiscordAlert } = await import('@/app/actions/notifications');

    const verb = await verbOfSingleRow(() => sendTestDiscordAlert(undefined, 'en'), entries);

    expect(verb).toBe('notification:test');
    expect(entries[0].afterValues).toEqual({
      delivered: true,
      usedConfiguredWebhook: true,
      hasRoleId: false,
      status: 204,
    });
  });

  it('records a rejected test alert as a failure carrying no url', async () => {
    const { entries } = await loadAuditedActions();
    const { sendTestDiscordAlert } = await import('@/app/actions/notifications');

    const result = await sendTestDiscordAlert({ webhookUrl: 'not-a-discord-url', roleId: '' }, 'en');

    expect(result.success).toBe(false);
    expect(entries).toHaveLength(1);
    expectNoLeak(entries);
    expect(entries[0].verb).toBe('notification:test');
    expect(entries[0].result).toBe('failure');
    expect(entries[0].afterValues).toEqual({
      delivered: false,
      usedConfiguredWebhook: false,
      hasRoleId: false,
      status: 0,
    });
  });
});
