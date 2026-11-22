import type { Dictionary } from '@/lib/dictionary';
import type { ListSortInput } from '@/lib/list-sorting';
import type { TeamSummary } from '@/lib/people-read-model-types';

import type { TeamListCopy } from './TeamListTable';

export interface TeamListProps {
  readonly initialTeams: readonly TeamSummary[];
  readonly permissionKeys: readonly string[];
  /** Labels for the edit dialog the table's row action opens. */
  readonly navigation: Dictionary['navigation'];
  readonly copy: TeamListCopy;
  readonly initialSort?: ListSortInput;
}
