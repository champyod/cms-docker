'use client';

import { ContestCommunications } from '../ContestCommunications';

export type ContestCommunicationsTabProps = {
  contestId: number;
  adminId: number;
  permissionKeys: readonly string[];
};

// Why: permissionKeys documents the route gate the page already enforced —
// the announcements, questions, and ranking data stay client-fetched inside
// ContestCommunications, so the tab passes only the two IDs it renders.
export function ContestCommunicationsTab({ contestId, adminId }: ContestCommunicationsTabProps): React.JSX.Element {
  return <ContestCommunications contestId={contestId} adminId={adminId} />;
}
