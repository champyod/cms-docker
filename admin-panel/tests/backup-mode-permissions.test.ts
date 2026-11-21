import { describe, expect, it } from 'vitest';

import { BACKUP_MODES, BACKUP_MODE_PERMISSION_KEYS } from '@/lib/backup/modes';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteDescriptor } from '@/lib/navigation/types';

const BACKUP_ROUTE_ID = 'system.backup-restore';

function enabledBackupRoute(): RouteDescriptor {
  const descriptor = ROUTE_REGISTRY.find((route) => route.id === BACKUP_ROUTE_ID);
  if (!descriptor) throw new Error(`Missing test route: ${BACKUP_ROUTE_ID}`);
  return { ...descriptor, enabled: true };
}

function declaredKeys(route: RouteDescriptor): readonly string[] {
  return [...(route.permission.any ?? [])].sort();
}

describe('Backup & Restore route gate', () => {
  // The inner tabs admit settle and delete, so a gate without them 404s an admin whose tab rendered.
  it('reaches an admin holding only a key the inner tabs admit', () => {
    const route = enabledBackupRoute();
    for (const key of ['backup:settle', 'backup:delete']) {
      expect(isRoutePermitted(route, new Set([key])), key).toBe(true);
    }
  });

  it('opens for every key any mode filter admits', () => {
    const route = enabledBackupRoute();
    for (const mode of BACKUP_MODES) {
      for (const key of mode.anyOf) {
        expect(isRoutePermitted(route, new Set([key])), `${mode.id} / ${key}`).toBe(true);
      }
    }
  });

  it('declares exactly the keys the mode filters admit', () => {
    expect(declaredKeys(enabledBackupRoute())).toEqual([...BACKUP_MODE_PERMISSION_KEYS].sort());
  });
});
