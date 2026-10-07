'use client';

import { ContestCommunications } from '../ContestCommunications';

export type ContestCommunicationsTabProps = {
  contestId: number;
  adminId: number;
  permissionKeys: readonly string[];
};

// Why: permissionKeys carries the route gate the page already enforced —
// the announcements, questions, and ranking data stay client-fetched inside
// ContestCommunications, so the tab forwards the keys for action gating.
export function ContestCommunicationsTab({ contestId, adminId, permissionKeys }: ContestCommunicationsTabProps): React.JSX.Element {
  return <ContestCommunications contestId={contestId} adminId={adminId} permissionKeys={permissionKeys} />;
}
