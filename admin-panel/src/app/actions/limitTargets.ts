'use server';

import * as contestService from '@/lib/services/contests';
import * as taskService from '@/lib/services/tasks';
import type { TargetKind } from '@/components/core/ApplyToTargetsDialog';
import type { TargetOption } from '@/components/core/TargetMultiSelect';

/**
 * The selectable targets for one kind, for the apply-to-targets picker.
 *
 * Why one action for both kinds: the picker asks per kind and the two reads carry their own list
 * gates (`contest:list` / `task:list`), so the caller needs neither a second action nor a cast.
 */
export async function listLimitTargets(kind: TargetKind): Promise<TargetOption[]> {
  if (kind === 'contest') {
    const result = await contestService.getAvailableContests();
    return result.contests.map((contest) => ({ id: contest.id, label: contest.name }));
  }
  const tasks = await taskService.listTaskTargets();
  return tasks.map((task) => ({ id: task.id, label: task.name }));
}
