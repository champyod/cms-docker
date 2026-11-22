'use client';

import { ContestCommunications } from '../ContestCommunications';
import type { CommTab } from '../contest-communications/useContestCommunications';

export type ContestCommunicationsTabProps = {
  contestId: number;
  adminId: number;
  permissionKeys: readonly string[];
  /** Which of the contest's two message lists this section renders. */
  panel: CommTab;
};

// Why: permissionKeys carries the route gate the page already enforced —
// the announcements and questions data stay client-fetched inside
// ContestCommunications, so the tab forwards the keys for action gating.
export function ContestCommunicationsTab({ contestId, adminId, permissionKeys, panel }: ContestCommunicationsTabProps): React.JSX.Element {
  return <ContestCommunications contestId={contestId} adminId={adminId} permissionKeys={permissionKeys} panel={panel} />;
}
