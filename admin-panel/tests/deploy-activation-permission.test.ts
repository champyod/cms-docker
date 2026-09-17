import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GROUPS, PERMISSION_REGISTRY } from '@/lib/permission-registry';

/**
 * A deploy is gated on `deployment:deploy` (src/app/actions/services.ts) and ends by activating its
 * contest, which is gated on `contest:switch` (src/lib/services/contests.ts). A role that may deploy
 * but not activate therefore passes the deploy gate and fails its own last step: the containers and
 * config.toml run the contest while the panel still marks another one active.
 *
 * These tests pin both halves: the seeded deploy role holds `contest:switch`, and the real
 * `contest:switch` gate accepts an admin whose only group is that role.
 */
const DEPLOY_ROLE = 'Storage Admin';

function groupKeys(name: string): string[] {
  const group = DEFAULT_GROUPS.find((definition) => definition.name === name);
  if (group === undefined) throw new Error(`DEFAULT_GROUPS has no group named "${name}"`);
  return [...group.permissions];
}

/** The group_permissions rows the seed writes for this group, in the shape getFreshPermissions reads. */
function groupPermissionRows(name: string): Array<{ permissions: { key: string } }> {
  return groupKeys(name).map((key) => ({ permissions: { key } }));
}

describe('every role that may deploy may also activate', () => {
  it('grants contest:switch everywhere deployment:deploy is granted', () => {
    const registryKeys = new Set(PERMISSION_REGISTRY.map((definition) => definition.key));
    expect(registryKeys.has('deployment:deploy')).toBe(true);
    expect(registryKeys.has('contest:switch')).toBe(true);

    const deployers = DEFAULT_GROUPS.filter((group) => group.permissions.includes('deployment:deploy'));
    // Non-vacuous: the seeded role the deploy path is meant for must be one of them.
    expect(deployers.map((group) => group.name)).toContain(DEPLOY_ROLE);

    const withoutActivation = deployers.filter((group) => !group.permissions.includes('contest:switch'));
    expect(withoutActivation.map((group) => group.name)).toEqual([]);
  });
});

describe('the contest:switch gate accepts a deploy-holding role', () => {
  beforeEach(() => vi.resetModules());

  async function loadContestServiceAs(roleName: string) {
    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn(async () => ({
        userId: '4242',
        username: 'operator',
        expiresAt: new Date().toISOString(),
      })),
    }));
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        admins: {
          findUnique: vi.fn(async () => ({
            enabled: true,
            admin_groups: [{ groups: { group_permissions: groupPermissionRows(roleName) } }],
            permission_overrides: [],
          })),
        },
        $executeRaw: vi.fn(async () => 1),
      },
    }));
    vi.doMock('@/lib/audit', () => ({ recordAudit: vi.fn(async () => {}) }));
    return import('@/lib/services/contests');
  }

  it('activates the contest for an admin whose only group is the deploy role', async () => {
    // The premise of the defect: this identity is allowed to start a deploy.
    expect(groupKeys(DEPLOY_ROLE)).toContain('deployment:deploy');

    const { activateContest } = await loadContestServiceAs(DEPLOY_ROLE);
    await expect(activateContest(12)).resolves.toEqual({ success: true });
  });

  it('still refuses a role that holds neither key', async () => {
    // Why: without this, the test above would also pass if the gate let everything through.
    expect(groupKeys('Judge')).not.toContain('contest:switch');

    const { activateContest } = await loadContestServiceAs('Judge');
    await expect(activateContest(12)).rejects.toThrow(/contest:switch/);
  });
});
