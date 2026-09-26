import type { Dictionary } from '@/lib/dictionary';
import type { TeamSummary } from '@/lib/people-read-model-types';

import type { TeamListCopy } from './TeamListTable';

export interface TeamListProps {
  readonly initialTeams: readonly TeamSummary[];
  readonly permissionKeys: readonly string[];
  readonly navigation: Dictionary['navigation'];
  readonly copy: TeamListCopy;
  readonly docsTitle: Dictionary['docs']['title'];
}
