'use server';

import { ensurePermission } from '@/lib/permissions';
import { collectServerStats } from '@/lib/server-stats';
import type { ServerStats } from '@/lib/server-stats';

// Why it delegates: this action and the resource stream feed the same cards, so one collector keeps their truth aligned.
export async function getServerStats(): Promise<ServerStats> {
  await ensurePermission('resource:read');
  return collectServerStats();
}
